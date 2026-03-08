import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { deflateSync, inflateSync } from 'zlib';
import level from 'level';
import { encode as msgpackEncode, decode as msgpackDecode } from 'msgpackr';
const maxItems = parseInt(process.env.CACHE_MAX_ITEMS || '1000', 10);
const defaultTtlMs = parseInt(process.env.CACHE_DEFAULT_TTL || '0', 10) * 1000;
const maxEntrySize = parseInt(process.env.CACHE_MAX_ENTRY_SIZE || '0', 10);
const compressionThreshold = parseInt(process.env.CACHE_COMPRESSION_THRESHOLD || '10240', 10);
let _evictions = 0;
const lruOpts = {
    max: maxItems > 0 ? maxItems : Infinity,
    ttl: defaultTtlMs > 0 ? defaultTtlMs : 0,
    updateAgeOnGet: true,
    dispose: () => { _evictions++; },
};
if (maxEntrySize > 0) {
    lruOpts.maxEntrySize = maxEntrySize;
    lruOpts.sizeCalculation = (v) => {
        try {
            const val = v.value;
            if (typeof val === 'string')
                return Buffer.byteLength(val, 'utf8');
            if (Buffer.isBuffer(val))
                return val.length;
            if (val && typeof val === 'object') {
                try {
                    return Object.keys(val).length * 40;
                }
                catch (_) {
                    return 64;
                }
            }
            const s = String(val ?? '');
            return Buffer.byteLength(s, 'utf8');
        }
        catch (e) {
            return 1;
        }
    };
}
const cache = new LRUCache(lruOpts);
export function l1Set(key, value, ttlSeconds) {
    const entry = { value };
    if (typeof ttlSeconds === 'number' && ttlSeconds > 0)
        cache.set(key, entry, { ttl: ttlSeconds * 1000 });
    else
        cache.set(key, entry);
}
export function l1Get(key) { const e = cache.get(key); return e ? e.value : undefined; }
export function l1Peek(key) { return cache.peek(key); }
export function l1Del(key) { cache.delete(key); }
export function l1Stats() { return { size: cache.size ?? cache.length ?? 0, evictions: _evictions }; }
// --- L2 (Redis) ---
const namespace = process.env.CACHE_NAMESPACE || 'wilcache';
const redisOpTimeoutMs = parseInt(process.env.REDIS_OP_TIMEOUT_MS || '100', 10);
const maxWriteQueue = parseInt(process.env.CACHE_MAX_WRITE_QUEUE || '1000', 10);
let redis = null;
let redisFailureCount = 0;
let redisFailureThreshold = parseInt(process.env.REDIS_FAIL_THRESHOLD || '5', 10);
let redisCooldownMs = parseInt(process.env.REDIS_COOLDOWN_MS || '15000', 10);
let redisDownSince = null;
// metrics
let metrics = {
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
    writeQueueDrops: 0,
};
function redisKey(key) { return `${namespace}:${key}`; }
// singleflight map to coalesce concurrent reads/rehydrates
const inflight = new Map();
function validateConfig() {
    if (maxItems <= 0)
        console.warn('CACHE_MAX_ITEMS is <= 0: L1 will be unbounded');
    if (maxWriteQueue <= 0)
        console.warn('CACHE_MAX_WRITE_QUEUE <= 0: write queue disabled');
    if (compressionThreshold <= 0)
        console.warn('CACHE_COMPRESSION_THRESHOLD <= 0: compression disabled');
}
export async function initRedis(redisUrl) {
    const url = redisUrl || process.env.REDIS_URL;
    if (!url)
        return null;
    try {
        // request buffers from redis client for binary performance
        redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1000, returnBuffers: true });
        await redis.ping();
        redisFailureCount = 0;
        redisDownSince = null;
        return redis;
    }
    catch (e) {
        console.error('redis init error', e);
        redis = null;
        redisDownSince = Date.now();
        return null;
    }
}
const writeQueue = [];
let writeScheduled = false;
function scheduleFlush() {
    if (writeScheduled)
        return;
    writeScheduled = true;
    setTimeout(flushQueue, 25); // batch every 25ms
}
async function flushQueue() {
    writeScheduled = false;
    if (!redis || writeQueue.length === 0)
        return;
    const q = writeQueue.splice(0, writeQueue.length);
    const pl = redis.pipeline();
    for (const it of q) {
        const key = redisKey(it.key);
        const metaKey = key + ':meta';
        // compress at flush time to avoid doing CPU work on the hot path
        let payloadBuf = it.payload;
        const meta = { ...it.metaObj };
        if (payloadBuf.length > compressionThreshold) {
            try {
                payloadBuf = deflateSync(payloadBuf);
                meta.compressed = true;
            }
            catch (e) { /* fall through */ }
        }
        const metaBuf = msgpackEncode(meta);
        if (it.ttl && it.ttl > 0) {
            pl.set(key, payloadBuf, 'EX', Math.ceil(it.ttl));
            pl.set(metaKey, metaBuf, 'EX', Math.ceil(it.ttl));
        }
        else {
            pl.set(key, payloadBuf);
            pl.set(metaKey, metaBuf);
        }
    }
    try {
        const execPromise = pl.exec();
        await Promise.race([execPromise, new Promise((res) => setTimeout(() => res(null), redisOpTimeoutMs))]);
        redisFailureCount = 0;
    }
    catch (e) {
        console.error('redis pipeline flush error', e);
        redisFailureCount++;
        if (redisFailureCount >= redisFailureThreshold) {
            try {
                redis?.disconnect();
            }
            catch { }
            redis = null;
            redisDownSince = Date.now();
        }
    }
}
export async function l2Write(key, value, ttlSeconds) {
    if (!redis)
        return;
    try {
        // serialize with msgpack -> Buffer but defer compression to flushQueue
        const payload = msgpackEncode(value);
        const metaObj = { serializer: 'msgpackr' };
        // cap the writeQueue to avoid unbounded memory growth
        if (writeQueue.length >= maxWriteQueue) {
            writeQueue.shift();
            metrics.writeQueueDrops++;
        }
        writeQueue.push({ key, payload: Buffer.from(payload), metaObj, ttl: ttlSeconds });
        scheduleFlush();
    }
    catch (e) {
        console.error('l2 write serialize error', e);
    }
}
export async function l2Read(key) {
    if (!redis)
        return undefined;
    try {
        const metaKey = redisKey(key) + ':meta';
        const pl = redis.pipeline().get(redisKey(key)).get(metaKey);
        const res = await Promise.race([pl.exec(), new Promise((res) => setTimeout(() => res(null), redisOpTimeoutMs))]);
        if (res === null)
            throw new Error('redis mget timeout');
        const getReply = res[0];
        const metaReply = res[1];
        const v = getReply && getReply[1] != null ? getReply[1] : null;
        const metaRaw = metaReply && metaReply[1] != null ? metaReply[1] : null;
        if (v == null)
            return undefined;
        let meta = null;
        if (metaRaw) {
            try {
                meta = msgpackDecode(metaRaw);
            }
            catch (_) {
                meta = null;
            }
        }
        try {
            if (meta && meta.compressed) {
                const inflated = inflateSync(v);
                return msgpackDecode(inflated);
            }
        }
        catch (_) { }
        try {
            const decoded = msgpackDecode(v);
            metrics.l2Hits++;
            return decoded;
        }
        catch (_) {
            metrics.l2Misses++;
            return v.toString('utf8');
        }
    }
    catch (e) {
        console.error('l2 read error', e);
        return undefined;
    }
}
export function isL2Enabled() { return !!redis; }
// --- Persistent (LevelDB) ---
let db = null;
export function initPersistent(path) {
    const p = path || process.env.PERSISTENT_L1_PATH;
    if (!p)
        return null;
    // persist as binary msgpack containers
    db = level(p, { valueEncoding: 'binary' });
    return db;
}
export async function pGet(key) {
    if (!db)
        return undefined;
    try {
        const raw = await db.get(key);
        if (!raw)
            return undefined;
        const container = msgpackDecode(raw);
        if (container.ttl && container.createdAt) {
            if (Date.now() > container.createdAt + (container.ttl * 1000))
                return undefined;
        }
        let payloadBuf = Buffer.from(container.payload || container.payload);
        if (container.compressed)
            payloadBuf = inflateSync(payloadBuf);
        const value = msgpackDecode(payloadBuf);
        return value;
    }
    catch (_) {
        return undefined;
    }
}
export async function pPut(key, value, ttlSeconds) {
    if (!db)
        return;
    try {
        const payload = msgpackEncode(value);
        let compressed = false;
        let payloadBuf = payload;
        if (payload.length > compressionThreshold) {
            payloadBuf = deflateSync(payload);
            compressed = true;
        }
        const container = { payload: Buffer.from(payloadBuf), compressed, ttl: ttlSeconds, createdAt: Date.now() };
        const buf = msgpackEncode(container);
        await db.put(key, buf);
    }
    catch (e) {
        console.error('pPut error', e);
    }
}
export async function pDel(key) {
    if (!db)
        return;
    try {
        await db.del(key);
    }
    catch (e) { }
}
// --- Hotkey detection ---
const hotCounts = new Map();
const HOT_THRESHOLD = parseInt(process.env.HOT_KEY_THRESHOLD || '100', 10);
const HOT_WINDOW_MS = parseInt(process.env.HOT_KEY_WINDOW_MS || '1000', 10);
export function recordHit(key) {
    const now = Date.now();
    const h = hotCounts.get(key) || { count: 0, last: now };
    if (now - h.last > HOT_WINDOW_MS) {
        h.count = 1;
        h.last = now;
    }
    else {
        h.count++;
    }
    hotCounts.set(key, h);
    return h.count > HOT_THRESHOLD;
}
export function resetHot(key) { hotCounts.delete(key); }
// periodic cleanup for hotCounts to avoid unbounded growth
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hotCounts) {
        if (now - v.last > HOT_WINDOW_MS * 5)
            hotCounts.delete(k);
    }
}, Math.max(1000, HOT_WINDOW_MS * 2));
// --- Glue API ---
export async function initAll() {
    await initRedis();
    initPersistent();
}
export async function setCache(key, value, ttlSeconds) {
    l1Set(key, value, ttlSeconds);
    void pPut(key, value, ttlSeconds);
    void l2Write(key, value, ttlSeconds);
}
export async function getCache(key) {
    // L1 fast path
    const v = l1Get(key);
    if (v !== undefined) {
        metrics.l1Hits++;
        return v;
    }
    metrics.l1Misses++;
    // dedupe in-flight rehydrates
    if (inflight.has(key)) {
        try {
            return await inflight.get(key);
        }
        catch (_) { /* fall through */ }
    }
    const isHot = recordHit(key);
    if (isHot) {
        const stale = l1Peek(key);
        if (stale)
            return stale.value;
    }
    // create singleflight promise for this key
    const p = (async () => {
        // try persistent store first (fast local disk)
        const pv = await pGet(key).catch(() => undefined);
        if (pv !== undefined) {
            l1Set(key, pv);
            return pv;
        }
        // try L2 (redis)
        const v2 = await l2Read(key);
        if (v2 !== undefined) {
            l1Set(key, v2);
            return v2;
        }
        return undefined;
    })();
    inflight.set(key, p);
    try {
        const res = await p;
        return res;
    }
    finally {
        inflight.delete(key);
    }
}
export async function delCache(key) {
    l1Del(key);
    void pDel(key);
    // delete from redis if available
    if (redis) {
        try {
            await (redis.pipeline().del(redisKey(key)).del(redisKey(key) + ':meta').exec());
        }
        catch (e) { /* ignore */ }
    }
}
export function stats() { return { l1: l1Stats(), l2: { enabled: isL2Enabled(), writeQueue: writeQueue.length, writeQueueDrops: metrics.writeQueueDrops }, metrics }; }
export function isRedisEnabled() { return isL2Enabled(); }
export async function shutdown() {
    // flush pending writes
    try {
        await flushQueue();
    }
    catch (e) { /* ignore */ }
    try {
        if (redis)
            await redis.quit();
    }
    catch (e) {
        try {
            redis?.disconnect();
        }
        catch { }
    }
    try {
        if (db && typeof db.close === 'function')
            await db.close();
    }
    catch (e) { /* ignore */ }
}
// standalone file: no re-exports to project cache folder
