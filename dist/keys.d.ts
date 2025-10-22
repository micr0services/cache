import type { ApiKey } from './types';
export declare function listKeys(): ApiKey[];
export declare function createKey(opts?: Partial<ApiKey>): ApiKey;
export declare function getByKey(keyStr: string): ApiKey | undefined;
