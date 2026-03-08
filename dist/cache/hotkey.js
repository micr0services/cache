const hotCounts = new Map();
const HOT_THRESHOLD = parseInt(process.env.HOT_KEY_THRESHOLD || '100', 10);
const HOT_WINDOW_MS = parseInt(process.env.HOT_KEY_WINDOW_MS || '1000', 10);
const HOT_CLEANUP_MS = parseInt(process.env.HOT_KEY_CLEANUP_MS || String(HOT_WINDOW_MS * 10), 10);
// periodic cleanup to avoid unbounded memory growth
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hotCounts.entries()) {
        if (now - v.last > HOT_CLEANUP_MS)
            hotCounts.delete(k);
    }
}, HOT_CLEANUP_MS);
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
