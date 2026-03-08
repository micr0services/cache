import { LRUCache } from 'lru-cache';
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
