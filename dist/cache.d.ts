export declare function setCache(key: string, value: unknown, ttlSeconds?: number): void;
export declare function getCache(key: string): unknown;
export declare function delCache(key: string): void;
export declare function stats(): {
    size: number;
    max: number;
};
