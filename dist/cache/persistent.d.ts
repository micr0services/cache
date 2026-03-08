export declare function initPersistent(path?: string): any;
export declare function pGet(key: string): Promise<any>;
export declare function pPut(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
export declare function pClose(): Promise<void>;
export declare function pDel(key: string): Promise<void>;
