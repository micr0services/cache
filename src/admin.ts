import { FastifyInstance } from 'fastify';
import { createKey, listKeys } from './keys.js';

export async function registerAdminRoutes(fastify: FastifyInstance) {
  fastify.post('/admin/keys', async (request, reply) => {
    // Only admin secret can call this (auth plugin sets isAdmin)
    if (!(request as any).isAdmin) return reply.code(403).send({ error: 'admin only' });
    const body = (request as any).body || {};
    const key = createKey(body);
    return reply.code(201).send(key);
  });

  fastify.get('/admin/keys', async (request, reply) => {
    if (!(request as any).isAdmin) return reply.code(403).send({ error: 'admin only' });
    return { keys: listKeys() };
  });
}
