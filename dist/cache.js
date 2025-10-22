const store = new Map();
const maxItems = parseInt(process.env.CACHE_MAX_ITEMS || '1000', 10);
const defaultTtlSeconds = parseInt(process.env.CACHE_DEFAULT_TTL || '0', 10);
function pruneIfNeeded() {
    if (store.size <= maxItems)
        return;
    // Simple eviction: remove oldest inserted items
    const it = store.keys();
    while (store.size > maxItems) {
        const next = it.next();
        if (next.done)
            break;
        const k = next.value;
        store.delete(k);
    }
}
export function setCache(key, value, ttlSeconds) {
    const ttl = typeof ttlSeconds === 'number' && ttlSeconds > 0 ? ttlSeconds : defaultTtlSeconds;
    const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
    store.set(key, { value, expiresAt });
    pruneIfNeeded();
}
export function getCache(key) {
    const e = store.get(key);
    if (!e)
        return undefined;
    if (e.expiresAt && e.expiresAt < Date.now()) {
        store.delete(key);
        return undefined;
    }
    return e.value;
}
export function delCache(key) {
    store.delete(key);
}
export function stats() {
    return { size: store.size, max: maxItems };
}
