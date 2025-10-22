import { FastifyInstance } from 'fastify';
import { createKey, listKeys } from './keys.js';

export async function registerAdminRoutes(fastify: FastifyInstance) {
  fastify.post('/admin/keys', async (request, reply) => {
    // Diagnostic: log isAdmin and incoming headers
    fastify.log.debug({ isAdmin: (request as any).isAdmin, headers: request.headers }, 'admin: incoming');
    // Fallback check: accept header directly if it matches server ADMIN_SECRET
    const headerSecret = String((request.headers as any)['x-admin-secret'] || '').trim();
    const envSecret = process.env.ADMIN_SECRET ? String(process.env.ADMIN_SECRET).trim() : '';
    if (!((request as any).isAdmin) && headerSecret && envSecret && headerSecret === envSecret) {
      (request as any).isAdmin = true;
      fastify.log.info('admin header matched fallback check');
    }
    // Only admin secret can call this
    if (!(request as any).isAdmin) return reply.code(403).send({ error: 'admin only' });
    const body = (request as any).body || {};
    const key = createKey(body);
    return reply.code(201).send(key);
  });

  fastify.get('/admin/keys', async (request, reply) => {
    fastify.log.debug({ isAdmin: (request as any).isAdmin, headers: request.headers }, 'admin: incoming list');
    const headerSecret2 = String((request.headers as any)['x-admin-secret'] || '').trim();
    const envSecret2 = process.env.ADMIN_SECRET ? String(process.env.ADMIN_SECRET).trim() : '';
    if (!((request as any).isAdmin) && headerSecret2 && envSecret2 && headerSecret2 === envSecret2) {
      (request as any).isAdmin = true;
      fastify.log.info('admin header matched fallback check');
    }
    if (!(request as any).isAdmin) return reply.code(403).send({ error: 'admin only' });
    return { keys: listKeys() };
  });
}
