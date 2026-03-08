import level from 'level';
import { encode as msgpackEncode, decode as msgpackDecode } from 'msgpackr';
import { deflateSync, inflateSync } from 'zlib';

const compressionThreshold = parseInt(process.env.CACHE_COMPRESSION_THRESHOLD || '10240', 10);

let db: any = null;
export function initPersistent(path?: string) {
  const p = path || process.env.PERSISTENT_L1_PATH;
  if (!p) return null;
  // store binary msgpack buffers
  db = level(p, { valueEncoding: 'binary' });
  return db;
}

export async function pGet(key: string) {
  if (!db) return undefined;
  try {
    const raw: Buffer = await db.get(key);
    if (!raw) return undefined;
    const container: any = msgpackDecode(raw as Buffer);
    // container: { payload: Buffer, compressed: boolean, ttl?: number, createdAt?: number }
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
    // if value already looks like a packed container (Buffer), allow direct put
    if (Buffer.isBuffer(value)) {
      await db.put(key, value as Buffer);
      return;
    }
    const payload = msgpackEncode(value) as Buffer;
    let compressed = false; let payloadBuf = payload;
    if (payload.length > compressionThreshold) { payloadBuf = deflateSync(payload); compressed = true; }
    const container = { payload: Buffer.from(payloadBuf), compressed, ttl: ttlSeconds, createdAt: Date.now() };
    const buf = msgpackEncode(container) as Buffer;
    await db.put(key, buf);
  } catch (e) { console.error('pPut error', e); }
}

export async function pClose() {
  if (!db) return;
  try { await db.close(); } catch (e) { }
}

export async function pDel(key: string) {
  if (!db) return;
  try { await db.del(key); } catch (e) { }
}
