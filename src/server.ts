import 'dotenv/config';
import Fastify from 'fastify';
import { authPlugin } from './auth.js';
import { registerAdminRoutes } from './admin.js';
import { getCache, setCache } from './cache.js';

const PORT = Number(process.env.PORT || 8080);

const logLevel = process.env.LOG_LEVEL || 'info';
const app = Fastify({ logger: { level: logLevel } });

app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

app.register(authPlugin);
app.register(async (fastify) => {
  await registerAdminRoutes(fastify);
  // cache endpoints
  fastify.get('/cache/:key', async (request, reply) => {
    const key = (request.params as any).key;
    const v = getCache(key);
    if (v === undefined) return reply.code(404).send({ found: false });
    return { found: true, key, value: v };
  });

  fastify.post('/cache/:key', async (request, reply) => {
    const key = (request.params as any).key;
    const body = (request as any).body;
    const ttl = request.query && (request.query as any).ttl ? Number((request.query as any).ttl) : (request as any).apiKey?.ttlSeconds || 0;
    setCache(key, body, ttl);
    return reply.code(201).send({ ok: true, key });
  });
});

const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`wilcache listening on ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') start();
