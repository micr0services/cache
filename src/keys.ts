import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ApiKey } from './types';

const DATA_FILE = path.join(process.cwd(), 'data', 'keys.json');

function ensureData() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ keys: [] }, null, 2));
}

function load(): { keys: ApiKey[] } {
  ensureData();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as { keys: ApiKey[] };
}

function save(obj: { keys: ApiKey[] }) {
  ensureData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

export function listKeys() {
  return load().keys;
}

export function createKey(opts: Partial<ApiKey> = {}): ApiKey {
  const keys = load();
  const key: ApiKey = {
    id: uuidv4(),
    key: uuidv4().replace(/-/g, ''),
    name: opts.name || 'unnamed',
    categories: opts.categories || [],
    ttlSeconds: opts.ttlSeconds || 0,
    rateLimit: opts.rateLimit || 0,
    createdAt: new Date().toISOString(),
  };
  keys.keys.push(key);
  save(keys);
  return key;
}

export function getByKey(keyStr: string) {
  return listKeys().find(k => k.key === keyStr);
}
