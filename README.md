wilcache — lightweight caching service

# Wilcache

Wilcache is a high-performance, multi-layered caching microservice designed for modern applications. It provides a simple HTTP(S) API for storing and retrieving cached data with advanced features like multi-tier caching, API key management, rate limiting, and automatic compression.

## Overview

Wilcache implements a sophisticated caching architecture with three layers:

- **L1 Cache**: In-memory LRU (Least Recently Used) cache for ultra-fast access
- **L2 Cache**: Optional Redis-backed distributed cache for scalability
- **Persistent Storage**: LevelDB-based disk persistence for durability

Key features include:
- RESTful HTTP API with JSON support
- API key authentication with per-key TTL and rate limiting
- Automatic data compression for large values
- Hotkey detection and stale-while-revalidate for high-traffic scenarios
- Batched Redis writes for performance
- Singleflight requests to prevent cache stampedes
- Admin endpoints for key management
- Comprehensive metrics and health monitoring
- TLS/HTTPS support
- Configurable via environment variables

## Quick Start

1. Copy `.env.example` to `.env` and configure your settings
2. Install dependencies: `npm install`
3. Start Redis locally or set `REDIS_URL` for distributed caching
4. Start the server: `npm start`

The service will be available at `http://localhost:8080` (or configured port).

## Architecture

### Caching Layers

**L1 (Memory)**: Fast in-process LRU cache using the `lru-cache` library. Configurable size limits and TTL.

**L2 (Redis)**: Optional distributed cache with batched writes, compression, and automatic failure handling. Uses MessagePack for efficient serialization.

**Persistent (LevelDB)**: Disk-based storage for data durability across restarts. Uses MessagePack containers with TTL support.

### Data Flow

1. Read requests check L1 first (fast path)
2. On L1 miss, check persistent storage (local disk)
3. On persistent miss, check L2 (Redis)
4. Write requests update all layers asynchronously
5. Hotkey detection serves stale data during high load

## API Endpoints

### Public Endpoints

- `GET /health` — Health check endpoint
- `GET /cache/:key` — Retrieve cached value (requires `x-api-key` header)
- `POST /cache/:key` — Store cached value (requires `x-api-key` header)
  - Query param: `?ttl=seconds` (optional, overrides key default)
  - Body: JSON value to cache

### Admin Endpoints

- `POST /admin/keys` — Create new API key (requires `x-admin-secret` header)
  - Body: `{ name?, categories?, ttlSeconds?, rateLimit? }`
- `GET /admin/keys` — List all API keys (requires `x-admin-secret` header)
- `GET /admin/metrics` — Get cache statistics and metrics (requires `x-admin-secret` header)

## Configuration

Configure Wilcache using environment variables in a `.env` file:

### Server Configuration
- `PORT`: Server port (default: 8080)
- `HOST`: Host to bind (default: 0.0.0.0)
- `LOG_LEVEL`: Logging level (default: info)

### Cache Configuration
- `CACHE_MAX_ITEMS`: Maximum L1 cache items (default: 1000)
- `CACHE_DEFAULT_TTL`: Default TTL in seconds (default: 0, no expiry)
- `CACHE_MAX_ENTRY_SIZE`: Maximum entry size in bytes (default: 0, unlimited)
- `CACHE_COMPRESSION_THRESHOLD`: Compress values larger than this (default: 10240 bytes)
- `CACHE_MAX_WRITE_QUEUE`: Maximum Redis write queue size (default: 1000)

### Redis Configuration
- `REDIS_URL`: Redis connection URL (optional)
- `REDIS_OP_TIMEOUT_MS`: Redis operation timeout (default: 100ms)
- `REDIS_FAIL_THRESHOLD`: Redis failure threshold (default: 5)
- `REDIS_COOLDOWN_MS`: Redis cooldown period (default: 15000ms)
- `CACHE_NAMESPACE`: Redis key namespace (default: wilcache)

### Security Configuration
- `ADMIN_SECRET`: Secret for admin operations
- `DEV_HTTPS`: Enable HTTPS in development (default: false)
- `DEV_TLS_KEY`: Path to TLS private key
- `DEV_TLS_CERT`: Path to TLS certificate

### Advanced Configuration
- `PERSISTENT_L1_PATH`: Path for LevelDB storage (optional)
- `HOT_KEY_THRESHOLD`: Hotkey detection threshold (default: 100)
- `HOT_KEY_WINDOW_MS`: Hotkey detection window (default: 1000ms)

## API Key Management

API keys are stored in `data/keys.json` and support:
- **TTL Control**: Per-key maximum TTL for cached items
- **Rate Limiting**: Per-key request rate limits (planned feature)
- **Categories**: Grouping keys by categories for ACLs (planned feature)
- **Name**: Human-readable key names

Create keys via the admin API:
```bash
curl -X POST http://localhost:8080/admin/keys \
  -H "x-admin-secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app", "ttlSeconds": 3600, "rateLimit": 100}'
```

## Usage Examples

### Basic Caching
```bash
# Store a value
curl -X POST http://localhost:8080/cache/mykey \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, World!"}'

# Retrieve a value
curl http://localhost:8080/cache/mykey \
  -H "x-api-key: your-api-key"
```

### With TTL
```bash
# Store with custom TTL
curl -X POST "http://localhost:8080/cache/tempkey?ttl=300" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"expires": "in 5 minutes"}'
```

## Performance Features

- **Singleflight**: Prevents duplicate requests for the same key
- **Batched Writes**: Groups Redis writes for efficiency
- **Compression**: Automatic gzip compression for large values
- **Hotkey Protection**: Serves stale data during cache misses for frequently accessed keys
- **Async Writes**: Non-blocking writes to persistent and L2 layers

## Monitoring

Access metrics at `/admin/metrics`:
```json
{
  "stats": {
    "l1": { "size": 150, "evictions": 5 },
    "l2": { "enabled": true, "writeQueue": 0, "writeQueueDrops": 0 },
    "metrics": {
      "l1Hits": 1250,
      "l1Misses": 150,
      "l2Hits": 100,
      "l2Misses": 50,
      "writeQueueDrops": 0
    }
  },
  "redis": { "enabled": true }
}
```

## Security Considerations

- API keys are stored in plaintext in `data/keys.json` for simplicity
- Use strong `ADMIN_SECRET` for production
- Enable TLS/HTTPS in production environments
- Consider using a secure database for key storage in production
- Rotate API keys regularly

## Development

- `npm run dev`: Start development server with hot reload
- `npm run build`: Build TypeScript to JavaScript
- `npm run lint`: Run ESLint
- `npm run format`: Format code with Prettier

## Dependencies

- **Fastify**: High-performance web framework
- **ioredis**: Redis client with connection pooling
- **level**: LevelDB for persistent storage
- **lru-cache**: In-memory LRU cache
- **msgpackr**: Fast MessagePack serialization
- **uuid**: UUID generation for keys

## Roadmap

- [ ] Per-key rate limiting
- [ ] Category-based access control (ACLs)
- [ ] Key revocation endpoints
- [ ] Cache invalidation patterns
- [ ] Metrics export (Prometheus)
- [ ] Clustering support
- [ ] Backup/restore functionality
