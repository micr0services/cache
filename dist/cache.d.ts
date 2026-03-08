import Redis from 'ioredis';
export type Entry = {
    value: unknown;
};
export declare function l1Set(key: string, value: unknown, ttlSeconds?: number): void;
export declare function l1Get(key: string): unknown;
export declare function l1Peek(key: string): Entry | undefined;
export declare function l1Del(key: string): void;
export declare function l1Stats(): {
    size: any;
    evictions: number;
};
export declare function initRedis(redisUrl?: string): Promise<Redis | null>;
export declare function l2Write(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
export declare function l2Read(key: string): Promise<any>;
export declare function isL2Enabled(): boolean;
export declare function initPersistent(path?: string): any;
export declare function pGet(key: string): Promise<any>;
export declare function pPut(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
export declare function pDel(key: string): Promise<void>;
export declare function recordHit(key: string): boolean;
export declare function resetHot(key: string): void;
export declare function initAll(): Promise<void>;
export declare function setCache(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
export declare function getCache(key: string): Promise<any>;
export declare function delCache(key: string): Promise<void>;
export declare function stats(): {
    l1: {
        size: any;
        evictions: number;
    };
    l2: {
        enabled: boolean;
        writeQueue: number;
        writeQueueDrops: number;
    };
    metrics: {
        l1Hits: number;
        l1Misses: number;
        l2Hits: number;
        l2Misses: number;
        writeQueueDrops: number;
    };
};
export declare function isRedisEnabled(): boolean;
export declare function shutdown(): Promise<void>;
