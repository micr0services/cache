import Redis from 'ioredis';
export declare function initRedis(redisUrl?: string): Promise<Redis | null>;
export declare function l2Write(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
export declare function l2Del(key: string): Promise<void>;
export declare function l2Stats(): {
    queueLen: number;
    dropped: number;
    redisFailures: number;
};
export declare function l2Close(): Promise<void>;
export declare function l2Read(key: string): Promise<any>;
export declare function isL2Enabled(): boolean;
