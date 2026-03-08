import * as L2 from './l2.js';
export declare function initAll(): Promise<void>;
export declare const initRedis: typeof L2.initRedis;
export declare function setCache(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
export declare function getCache(key: string): Promise<any>;
export declare function delCache(key: string): void;
export declare function stats(): {
    l1: {
        size: any;
        evictions: number;
    };
    l2: {
        queueLen: number;
        dropped: number;
        redisFailures: number;
        enabled: boolean;
    };
};
export declare function isRedisEnabled(): boolean;
export declare function shutdown(): Promise<void>;
