wilcache — lightweight caching service

Overview
- Small HTTP(S) caching service that stores values in Redis.
- API keys are file-backed (data/keys.json) and limit TTL and rate behavior per key.
- Admin endpoint to create keys (protected by ADMIN_SECRET).

Quick start
1. Copy .env.example to .env and edit values.
2. Install deps: npm install
3. Start Redis locally or set REDIS_URL.
4. Start server: npm start

Environment variables (.env)
- PORT: server port (default 8443)
- HOST: host to bind (default 0.0.0.0)
- REDIS_URL: redis://host:port
- ADMIN_SECRET: secret string used to protect key creation
- DEV_HTTPS: set to 'true' to enable HTTPS using files in ./certs
- DEV_TLS_KEY / DEV_TLS_CERT: paths to TLS key/cert

Endpoints
- GET /health — returns ok
- POST /admin/keys — create a new API key. Requires header x-admin-secret matching ADMIN_SECRET. Body: { name, categories, ttlSeconds, rateLimit }
- GET /cache/:key — read cached value. Requires x-api-key header.
- POST /cache/:key — set cached value (JSON body). Optional ?ttl=seconds. Requires x-api-key header.

Security notes
- API keys are stored in plaintext in data/keys.json for simplicity. For production, use a secure DB and rotate keys.
- TLS: In dev you can create a self-signed cert and set DEV_HTTPS=true. For production use a real certificate.

Next steps
- Add key revocation endpoint.
- Add per-key rate limiter backed by Redis.
- Add role-based categories/ACLs for read/write.
