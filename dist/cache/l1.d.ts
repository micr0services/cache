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
