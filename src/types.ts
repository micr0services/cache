export type ApiKey = {
  id: string;
  key: string;
  name?: string;
  categories?: string[];
  ttlSeconds?: number;
  rateLimit?: number;
  createdAt: string;
};

export type CacheValue = any;
