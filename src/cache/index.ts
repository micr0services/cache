import * as L1 from './l1.js';
import * as L2 from './l2.js';
import * as P from './persistent.js';
import * as H from './hotkey.js';

// singleflight inflight map to coalesce concurrent misses/rehydrations
const inflight = new Map<string, Promise<unknown | undefined>>();

export async function initAll() {
  await L2.initRedis();
  P.initPersistent();
  // basic config validation
  const maxQ = process.env.CACHE_L2_WRITE_QUEUE_MAX || '1000';
  if (isNaN(Number(maxQ)) || Number(maxQ) <= 0) console.warn('CACHE_L2_WRITE_QUEUE_MAX is invalid');
}

// keep backwards-compatible export name
export const initRedis = L2.initRedis;

export async function setCache(key: string, value: unknown, ttlSeconds?: number) {
  L1.l1Set(key, value, ttlSeconds);
  void P.pPut(key, value, ttlSeconds);
  void L2.l2Write(key, value, ttlSeconds);
}

export async function getCache(key: string) {
  // L1 fast path
  const v = L1.l1Get(key);
  if (v !== undefined) return v;

  // hot-key check
  const isHot = H.recordHit(key);
  if (isHot) {
    const stale = L1.l1Peek(key);
    if (stale) return (stale as any).value;
  }

  // singleflight: if another fetch is in progress, wait for it
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    // persistent -> L2 (try persistent first as it's local)
    const pv = await P.pGet(key).catch(() => undefined);
    if (pv !== undefined) { L1.l1Set(key, pv); return pv; }
    const v2 = await L2.l2Read(key);
    if (v2 !== undefined) { L1.l1Set(key, v2); return v2; }
    return undefined;
  })();

  inflight.set(key, p);
  try { const res = await p; return res; } finally { inflight.delete(key); }
}

export function delCache(key: string) { L1.l1Del(key); void P.pDel(key); void L2.l2Del(key); }

export function stats() { return { l1: L1.l1Stats(), l2: { enabled: L2.isL2Enabled(), ...L2.l2Stats() } } }
export function isRedisEnabled() { return L2.isL2Enabled(); }

export async function shutdown() {
  // flush and close L2 and persistent
  try { await L2.l2Close(); } catch (e) {}
  try { await P.pClose(); } catch (e) {}
}
