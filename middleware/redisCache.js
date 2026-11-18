const { redis, isConnected } = require('../config/redis');

/**
 * Normalizes query parameters into a deterministic sorted string
 * so that ?page=1&limit=10 and ?limit=10&page=1 produce identical cache keys.
 */
const getDeterministicQueryKey = (query) => {
  if (!query || typeof query !== 'object') return '';
  const sortedKeys = Object.keys(query).sort();
  const pairs = [];
  for (const k of sortedKeys) {
    if (query[k] !== undefined && query[k] !== null && query[k] !== '') {
      pairs.push(`${k}=${String(query[k]).trim()}`);
    }
  }
  return pairs.join('&');
};

/**
 * Transparent Redis Caching Middleware
 * @param {number} durationSeconds - Cache TTL in seconds (default: 180s / 3 mins)
 * @param {string} prefix - Custom namespace prefix (default: 'klever:cache')
 */
const redisCache = (durationSeconds = 180, prefix = 'klever:cache') => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // If Redis is not connected, gracefully bypass to MongoDB
    if (!isConnected()) {
      return next();
    }

    const lang = (req.query?.lang || req.query?.language || req.headers?.['accept-language'] || 'es').toLowerCase().substring(0, 2);
    const queryString = getDeterministicQueryKey(req.query);
    const fullPath = (req.baseUrl || '') + (req.path || '');
    const cacheKey = `${prefix}:${fullPath}:${lang}:${queryString}`;

    try {
      const cachedResponse = await redis.get(cacheKey);
      if (cachedResponse) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).send(cachedResponse);
      }
    } catch (err) {
      console.warn(`Redis GET cache error (${cacheKey}): ${err.message}. Serving directly from DB.`);
    }

    // Cache MISS: Intercept res.json so we can store the response in Redis before sending
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      // Restore original res.json to avoid double intercepting
      res.json = originalJson;

      // Only cache successful 200 responses
      if (res.statusCode === 200 && body && body.success !== false && isConnected()) {
        try {
          const serialized = JSON.stringify(body);
          redis.set(cacheKey, serialized, 'EX', durationSeconds).catch((setErr) => {
            console.warn(`Redis SET cache error (${cacheKey}):`, setErr.message);
          });
        } catch (serErr) {
          console.warn(`JSON serialization error for cache (${cacheKey}):`, serErr.message);
        }
      }

      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
};

module.exports = redisCache;