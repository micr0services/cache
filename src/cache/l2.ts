import Redis from 'ioredis';
import { deflateSync, inflateSync } from 'zlib';
import { encode as msgpackEncode, decode as msgpackDecode } from 'msgpackr';

const namespace = process.env.CACHE_NAMESPACE || 'wilcache';
const compressionThreshold = parseInt(process.env.CACHE_COMPRESSION_THRESHOLD || '10240', 10);
const redisOpTimeoutMs = parseInt(process.env.REDIS_OP_TIMEOUT_MS || '100', 10);

let redis: Redis | null = null;
let redisFailureCount = 0;
let redisFailureThreshold = parseInt(process.env.REDIS_FAIL_THRESHOLD || '5', 10);
let redisCooldownMs = parseInt(process.env.REDIS_COOLDOWN_MS || '15000', 10);
let redisDownSince: number | null = null;

function redisKey(key: string) { return `${namespace}:${key}`; }

export async function initRedis(redisUrl?: string) {
  const url = redisUrl || process.env.REDIS_URL;
  if (!url) return null;
  try {
    // ioredis doesn't declare returnBuffers on RedisOptions typings; cast to any to enable it.
    // This causes Redis replies to be Buffers which is faster for binary data.
    redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1000, returnBuffers: true } as any);
    await redis.ping();
    redisFailureCount = 0; redisDownSince = null; return redis;
  } catch (e) { console.error('redis init error', e); redis = null; redisDownSince = Date.now(); return null; }
}

// batched write queue (stores raw msgpack payload Buffers; compression applied at flush)
type WriteItem = { key: string; payload: Buffer; ttl?: number };
const writeQueue: WriteItem[] = [];
const WRITE_QUEUE_MAX = parseInt(process.env.CACHE_L2_WRITE_QUEUE_MAX || '1000', 10);
let writeQueueDropped = 0;
let writeScheduled = false;

function scheduleFlush() {
  if (writeScheduled) return;
  writeScheduled = true;
  setTimeout(flushQueue, 25); // batch every 25ms
}

async function flushQueue() {
  writeScheduled = false;
  if (writeQueue.length === 0) return;
  // if redis down, attempt to persist to disk (persistent pPut) or drop
  if (!redis) {
    // try dynamic import of persistent and write items there (best-effort)
    try {
      const P = await import('./persistent.js');
      const q2 = writeQueue.splice(0, writeQueue.length);
      for (const it of q2) {
        // container stored in persistent will include compressed=false (we avoid extra compression here)
        void P.pPut(it.key, msgpackEncode({ payload: it.payload, compressed: false }), undefined).catch(() => {});
      }
    } catch (e) {
      // couldn't persist - drop queue and record
      writeQueueDropped += writeQueue.length;
      writeQueue.splice(0, writeQueue.length);
    }
    return;
  }
  const q = writeQueue.splice(0, writeQueue.length);
  const pl = redis.pipeline();
  for (const it of q) {
    const key = redisKey(it.key);
    const metaKey = key + ':meta';
    // apply compression at flush-time to avoid doing it on the hot path
    let compressed = false;
    let payloadBuf = it.payload;
    try {
      if (it.payload.length > compressionThreshold) { payloadBuf = deflateSync(it.payload); compressed = true; }
    } catch (_) { payloadBuf = it.payload; compressed = false; }
    const metaBuf = msgpackEncode({ compressed, serializer: 'msgpackr' }) as Buffer;
    if (it.ttl && it.ttl > 0) {
      (pl as any).set(key, payloadBuf, 'EX', Math.ceil(it.ttl));
      (pl as any).set(metaKey, metaBuf, 'EX', Math.ceil(it.ttl));
    } else {
      (pl as any).set(key, payloadBuf);
      (pl as any).set(metaKey, metaBuf);
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
  try {
    // serialize with msgpack -> Buffer and push to queue; actual compression occurs at flush
    const payload = msgpackEncode(value) as Buffer;
    if (writeQueue.length >= WRITE_QUEUE_MAX) {
      // drop oldest
      writeQueue.shift();
      writeQueueDropped++;
    }
    writeQueue.push({ key, payload: Buffer.from(payload), ttl: ttlSeconds });
    scheduleFlush();
  } catch (e) { console.error('l2 write serialize error', e); }
}

export async function l2Del(key: string) {
  if (!redis) return;
  try {
    const rkey = redisKey(key);
    const metaKey = rkey + ':meta';
    await redis.del(rkey, metaKey);
  } catch (e) { console.error('l2 del error', e); }
}

export function l2Stats() { return { queueLen: writeQueue.length, dropped: writeQueueDropped, redisFailures: redisFailureCount } }

export async function l2Close() {
  // flush remaining queue synchronously
  if (writeQueue.length > 0) {
    await flushQueue();
  }
  try { redis?.disconnect(); } catch (e) { }
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
    // metaRaw and v are Buffers (because returnBuffers=true)
    let meta: any = null;
    if (metaRaw) {
      try { meta = msgpackDecode(metaRaw as Buffer); } catch (_) { meta = null; }
    }
    try {
      if (meta && meta.compressed) {
        const payload = Buffer.from(v as Buffer);
        const inflated = inflateSync(payload);
        return msgpackDecode(inflated as Buffer);
      }
    } catch (_) {}
    try { return msgpackDecode(v as Buffer); } catch (_) { return v as Buffer; }
  } catch (e) { console.error('l2 read error', e); return undefined; }
}

export function isL2Enabled() { return !!redis; }
