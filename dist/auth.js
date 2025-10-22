import { getByKey } from './keys.js';
export const authPlugin = (fastify, _opts, done) => {
    fastify.log.info('auth plugin registered');
    fastify.addHook('onRequest', async (request, reply) => {
        const req = request;
        // health is open
        if (req.routerPath === '/health')
            return;
        // admin secret bypass
        const rawAdminHeader = req.headers['x-admin-secret'];
        const adminHeader = rawAdminHeader ? String(rawAdminHeader).trim() : '';
        const envAdmin = process.env.ADMIN_SECRET ? String(process.env.ADMIN_SECRET).trim() : '';
        // always log the header/env so we can diagnose admin auth problems
        fastify.log.info({ adminHeader, envAdmin }, 'auth: admin header check');
        // Also print to stdout to make sure the info is visible in all run modes
        console.log('AUTH_CHECK', { adminHeader, envAdmin });
        if (adminHeader) {
            if (!envAdmin) {
                fastify.log.warn('admin header provided but server ADMIN_SECRET is not configured');
                reply.code(500).send({ error: 'server misconfigured: ADMIN_SECRET not set' });
                return;
            }
            if (adminHeader === envAdmin) {
                req.isAdmin = true;
                return;
            }
            // header present but didn't match — fall through to return invalid API-key
        }
        const ak = String(req.headers['x-api-key'] || (req.query && req.query['apiKey']) || '');
        if (!ak) {
            reply.code(401).send({ error: 'x-api-key required' });
            return;
        }
        const key = getByKey(ak);
        if (!key) {
            reply.code(403).send({ error: 'invalid api key' });
            return;
        }
        req.apiKey = key;
    });
    done();
};
export default authPlugin;
