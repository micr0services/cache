import { createKey, listKeys } from './keys.js';
export async function registerAdminRoutes(fastify) {
    fastify.post('/admin/keys', async (request, reply) => {
        // Diagnostic: log isAdmin and incoming headers
        fastify.log.debug({ isAdmin: request.isAdmin, headers: request.headers }, 'admin: incoming');
        // Fallback check: accept header directly if it matches server ADMIN_SECRET
        const headerSecret = String(request.headers['x-admin-secret'] || '').trim();
        const envSecret = process.env.ADMIN_SECRET ? String(process.env.ADMIN_SECRET).trim() : '';
        if (!(request.isAdmin) && headerSecret && envSecret && headerSecret === envSecret) {
            request.isAdmin = true;
            fastify.log.info('admin header matched fallback check');
        }
        // Only admin secret can call this
        if (!request.isAdmin)
            return reply.code(403).send({ error: 'admin only' });
        const body = request.body || {};
        const key = createKey(body);
        return reply.code(201).send(key);
    });
    fastify.get('/admin/keys', async (request, reply) => {
        fastify.log.debug({ isAdmin: request.isAdmin, headers: request.headers }, 'admin: incoming list');
        const headerSecret2 = String(request.headers['x-admin-secret'] || '').trim();
        const envSecret2 = process.env.ADMIN_SECRET ? String(process.env.ADMIN_SECRET).trim() : '';
        if (!(request.isAdmin) && headerSecret2 && envSecret2 && headerSecret2 === envSecret2) {
            request.isAdmin = true;
            fastify.log.info('admin header matched fallback check');
        }
        if (!request.isAdmin)
            return reply.code(403).send({ error: 'admin only' });
        return { keys: listKeys() };
    });
}
