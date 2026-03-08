import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { deflateSync, inflateSync } from 'zlib';
import level from 'level';
import { encode as msgpackEncode, decode as msgpackDecode } from 'msgpackr';

// --- L1 (LRU) ---
export type Entry = { value: unknown };

const maxItems = parseInt(process.env.CACHE_MAX_ITEMS || '1000', 10);
const defaultTtlMs = parseInt(process.env.CACHE_DEFAULT_TTL || '0', 10) * 1000;
const maxEntrySize = parseInt(process.env.CACHE_MAX_ENTRY_SIZE || '0', 10);
const compressionThreshold = parseInt(process.env.CACHE_COMPRESSION_THRESHOLD || '10240', 10);

let _evictions = 0;

const lruOpts: any = {
  max: maxItems > 0 ? maxItems : Infinity,
  ttl: defaultTtlMs > 0 ? defaultTtlMs : 0,
  updateAgeOnGet: true,
  dispose: () => { _evictions++; },
};
if (maxEntrySize > 0) {
  lruOpts.maxEntrySize = maxEntrySize;
  lruOpts.sizeCalculation = (v: Entry) => {
    try {
      const val = v.value as any;
      if (typeof val === 'string') return Buffer.byteLength(val, 'utf8');
      if (Buffer.isBuffer(val)) return val.length;
      if (val && typeof val === 'object') {
        try { return Object.keys(val).length * 40; } catch (_) { return 64; }
      }
      const s = String(val ?? '');
      return Buffer.byteLength(s, 'utf8');
    } catch (e) { return 1; }
  };
}
const cache = new LRUCache<string, Entry>(lruOpts);

export function l1Set(key: string, value: unknown, ttlSeconds?: number) {
  const entry: Entry = { value };
  if (typeof ttlSeconds === 'number' && ttlSeconds > 0) cache.set(key, entry, { ttl: ttlSeconds * 1000 });
  else cache.set(key, entry);
}

export function l1Get(key: string) { const e = cache.get(key); return e ? (e as Entry).value : undefined; }
export function l1Peek(key: string) { return cache.peek(key as any); }
export function l1Del(key: string) { cache.delete(key); }
export function l1Stats() { return { size: (cache as any).size ?? (cache as any).length ?? 0, evictions: _evictions } }

// --- L2 (Redis) ---
const namespace = process.env.CACHE_NAMESPACE || 'wilcache';
const redisOpTimeoutMs = parseInt(process.env.REDIS_OP_TIMEOUT_MS || '100', 10);
const maxWriteQueue = parseInt(process.env.CACHE_MAX_WRITE_QUEUE || '1000', 10);

let redis: Redis | null = null;
let redisFailureCount = 0;
let redisFailureThreshold = parseInt(process.env.REDIS_FAIL_THRESHOLD || '5', 10);
let redisCooldownMs = parseInt(process.env.REDIS_COOLDOWN_MS || '15000', 10);
let redisDownSince: number | null = null;

// metrics
let metrics = {
  l1Hits: 0,
  l1Misses: 0,
  l2Hits: 0,
  l2Misses: 0,
  writeQueueDrops: 0,
};

function redisKey(key: string) { return `${namespace}:${key}`; }
// singleflight map to coalesce concurrent reads/rehydrates
const inflight = new Map<string, Promise<unknown>>();

function validateConfig() {
  if (maxItems <= 0) console.warn('CACHE_MAX_ITEMS is <= 0: L1 will be unbounded');
  if (maxWriteQueue <= 0) console.warn('CACHE_MAX_WRITE_QUEUE <= 0: write queue disabled');
  if (compressionThreshold <= 0) console.warn('CACHE_COMPRESSION_THRESHOLD <= 0: compression disabled');
}

export async function initRedis(redisUrl?: string) {
  const url = redisUrl || process.env.REDIS_URL;
  if (!url) return null;
  try {
    // request buffers from redis client for binary performance
    redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1000, returnBuffers: true } as any);
    await redis.ping();
    redisFailureCount = 0; redisDownSince = null; return redis;
  } catch (e) { console.error('redis init error', e); redis = null; redisDownSince = Date.now(); return null; }
}

// batched write queue
type WriteItem = { key: string; payload: Buffer; metaObj: any; ttl?: number };
const writeQueue: WriteItem[] = [];
let writeScheduled = false;

function scheduleFlush() {
  if (writeScheduled) return;
  writeScheduled = true;
  setTimeout(flushQueue, 25); // batch every 25ms
}

async function flushQueue() {
  writeScheduled = false;
  if (!redis || writeQueue.length === 0) return;
  const q = writeQueue.splice(0, writeQueue.length);
  const pl = redis.pipeline();
  for (const it of q) {
    const key = redisKey(it.key);
    const metaKey = key + ':meta';
    // compress at flush time to avoid doing CPU work on the hot path
    let payloadBuf = it.payload;
    const meta = { ...it.metaObj };
    if (payloadBuf.length > compressionThreshold) {
      try { payloadBuf = deflateSync(payloadBuf); meta.compressed = true; } catch (e) { /* fall through */ }
    }
    const metaBuf = msgpackEncode(meta) as Buffer;
    if (it.ttl && it.ttl > 0) {
      (pl as any).set(key, payloadBuf as any, 'EX', Math.ceil(it.ttl));
      (pl as any).set(metaKey, metaBuf as any, 'EX', Math.ceil(it.ttl));
    } else {
      (pl as any).set(key, payloadBuf as any);
      (pl as any).set(metaKey, metaBuf as any);
    }
  }
  try {
    const execPromise = pl.exec();
    await Promise.race([execPromise, new Promise<null>((res) => setTimeout(() => res(null), redisOpTimeoutMs))]);
    redisFailureCount = 0;
  } catch (e) {
    console.error('redis pipeline flush error', e);
    redisFailureCount++;
    if (redisFailureCount >= redisFailureThreshold) { try { redis?.disconnect(); } catch {} redis = null; redisDownSince = Date.now(); }
  }
}

export async function l2Write(key: string, value: unknown, ttlSeconds?: number) {
  if (!redis) return;
  try {
    // serialize with msgpack -> Buffer but defer compression to flushQueue
    const payload = msgpackEncode(value) as Buffer;
    const metaObj = { serializer: 'msgpackr' };
    // cap the writeQueue to avoid unbounded memory growth
    if (writeQueue.length >= maxWriteQueue) {
      writeQueue.shift();
      metrics.writeQueueDrops++;
    }
    writeQueue.push({ key, payload: Buffer.from(payload), metaObj, ttl: ttlSeconds });
    scheduleFlush();
  } catch (e) { console.error('l2 write serialize error', e); }
}

export async function l2Read(key: string) {
  if (!redis) return undefined;
  try {
    const metaKey = redisKey(key) + ':meta';
    const pl = redis.pipeline().get(redisKey(key)).get(metaKey);
    const res = await Promise.race([pl.exec(), new Promise<null>((res) => setTimeout(() => res(null), redisOpTimeoutMs))]);
    if (res === null) throw new Error('redis mget timeout');
  const getReply = (res as any)[0]; const metaReply = (res as any)[1];
  const v = getReply && getReply[1] != null ? getReply[1] as Buffer : null;
  const metaRaw = metaReply && metaReply[1] != null ? metaReply[1] as Buffer : null;
    if (v == null) return undefined;
    let meta: any = null;
    if (metaRaw) {
      try { meta = msgpackDecode(metaRaw as Buffer); } catch (_) { meta = null; }
    }
    try {
      if (meta && meta.compressed) { const inflated = inflateSync(v); return msgpackDecode(inflated as Buffer); }
    } catch (_) {}
    try { const decoded = msgpackDecode(v as Buffer); metrics.l2Hits++; return decoded; } catch (_) { metrics.l2Misses++; return v.toString('utf8'); }
  } catch (e) { console.error('l2 read error', e); return undefined; }
}

export function isL2Enabled() { return !!redis; }

// --- Persistent (LevelDB) ---
let db: any = null;
export function initPersistent(path?: string) {
  const p = path || process.env.PERSISTENT_L1_PATH;
  if (!p) return null;
  // persist as binary msgpack containers
  db = level(p, { valueEncoding: 'binary' });
  return db;
}

export async function pGet(key: string) {
  if (!db) return undefined;
  try {
    const raw: Buffer = await db.get(key);
    if (!raw) return undefined;
    const container: any = msgpackDecode(raw as Buffer);
    if (container.ttl && container.createdAt) {
      if (Date.now() > container.createdAt + (container.ttl * 1000)) return undefined;
    }
    let payloadBuf = Buffer.from(container.payload as Uint8Array || container.payload as Buffer);
    if (container.compressed) payloadBuf = inflateSync(payloadBuf);
    const value = msgpackDecode(payloadBuf as Buffer);
    return value;
  } catch (_) { return undefined; }
}

export async function pPut(key: string, value: unknown, ttlSeconds?: number) {
  if (!db) return;
  try {
    const payload = msgpackEncode(value) as Buffer;
    let compressed = false; let payloadBuf = payload;
    if (payload.length > compressionThreshold) { payloadBuf = deflateSync(payload); compressed = true; }
    const container = { payload: Buffer.from(payloadBuf), compressed, ttl: ttlSeconds, createdAt: Date.now() };
    const buf = msgpackEncode(container) as Buffer;
    await db.put(key, buf);
  } catch (e) { console.error('pPut error', e); }
}

export async function pDel(key: string) {
  if (!db) return;
  try { await db.del(key); } catch (e) { }
}

// --- Hotkey detection ---
const hotCounts = new Map<string, { count: number; last: number }>();
const HOT_THRESHOLD = parseInt(process.env.HOT_KEY_THRESHOLD || '100', 10);
const HOT_WINDOW_MS = parseInt(process.env.HOT_KEY_WINDOW_MS || '1000', 10);

export function recordHit(key: string) {
  const now = Date.now();
  const h = hotCounts.get(key) || { count: 0, last: now };
  if (now - h.last > HOT_WINDOW_MS) { h.count = 1; h.last = now; }
  else { h.count++; }
  hotCounts.set(key, h);
  return h.count > HOT_THRESHOLD;
}

export function resetHot(key: string) { hotCounts.delete(key); }

// periodic cleanup for hotCounts to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hotCounts) {
    if (now - v.last > HOT_WINDOW_MS * 5) hotCounts.delete(k);
  }
}, Math.max(1000, HOT_WINDOW_MS * 2));

// --- Glue API ---
export async function initAll() {
  await initRedis();
  initPersistent();
}

export async function setCache(key: string, value: unknown, ttlSeconds?: number) {
  l1Set(key, value, ttlSeconds);
  void pPut(key, value, ttlSeconds);
  void l2Write(key, value, ttlSeconds);
}

export async function getCache(key: string) {
  // L1 fast path
  const v = l1Get(key);
  if (v !== undefined) { metrics.l1Hits++; return v; }
  metrics.l1Misses++;

  // dedupe in-flight rehydrates
  if (inflight.has(key)) {
    try { return await inflight.get(key) as unknown; } catch (_) { /* fall through */ }
  }

  const isHot = recordHit(key);
  if (isHot) {
    const stale = l1Peek(key);
    if (stale) return (stale as any).value;
  }

  // create singleflight promise for this key
  const p = (async () => {
    // try persistent store first (fast local disk)
    const pv = await pGet(key).catch(() => undefined);
    if (pv !== undefined) { l1Set(key, pv); return pv; }
    // try L2 (redis)
    const v2 = await l2Read(key);
    if (v2 !== undefined) { l1Set(key, v2); return v2; }
    return undefined;
  })();
  inflight.set(key, p as Promise<unknown>);
  try {
    const res = await p;
    return res;
  } finally { inflight.delete(key); }
}

export async function delCache(key: string) {
  l1Del(key); void pDel(key);
  // delete from redis if available
  if (redis) {
    try { await (redis.pipeline().del(redisKey(key)).del(redisKey(key) + ':meta').exec()); } catch (e) { /* ignore */ }
  }
}

export function stats() { return { l1: l1Stats(), l2: { enabled: isL2Enabled(), writeQueue: writeQueue.length, writeQueueDrops: metrics.writeQueueDrops }, metrics } }
export function isRedisEnabled() { return isL2Enabled(); }

export async function shutdown() {
  // flush pending writes
  try { await flushQueue(); } catch (e) { /* ignore */ }
  try { if (redis) await redis.quit(); } catch (e) { try { redis?.disconnect(); } catch {} }
  try { if (db && typeof db.close === 'function') await db.close(); } catch (e) { /* ignore */ }
}
// standalone file: no re-exports to project cache folder
