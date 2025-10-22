import { FastifyPluginCallback } from 'fastify';
import { getByKey } from './keys.js';

export const authPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.addHook('onRequest', async (request, reply) => {
    const req: any = request;
    // health is open
    if (req.routerPath === '/health') return;

    // admin secret bypass
    const adminSecret = req.headers['x-admin-secret'];
    // debug: log header and expected value when in dev
    if (process.env.NODE_ENV === 'development') {
      fastify.log.debug({ adminHeader: adminSecret, envAdmin: process.env.ADMIN_SECRET }, 'auth: admin header check');
    }
    if (adminSecret && process.env.ADMIN_SECRET && String(adminSecret) === process.env.ADMIN_SECRET) {
      // mark request
      req.isAdmin = true;
      return;
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
