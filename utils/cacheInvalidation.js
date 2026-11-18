const { redis, isConnected } = require('../config/redis');

/**
 * Safely purges cached keys matching patterns using non-blocking SCAN.
 */
const purgeKeysByPattern = async (pattern) => {
  if (!isConnected() || !redis) return 0;

  let totalDeleted = 0;
  return new Promise((resolve) => {
    const stream = redis.scanStream({
      match: pattern,
      count: 100,
    });

    const pipeline = redis.pipeline();

    stream.on('data', (keys = []) => {
      if (keys.length > 0) {
        keys.forEach((key) => {
          pipeline.del(key);
          totalDeleted += 1;
        });
      }
    });

    stream.on('end', async () => {
      try {
        if (totalDeleted > 0) {
          await pipeline.exec();
        }
      } catch (err) {
        console.warn('Redis pipeline purge execution warning:', err.message);
      }
      resolve(totalDeleted);
    });

    stream.on('error', (err) => {
      console.warn(`Redis scan stream warning for pattern "${pattern}":`, err.message);
      resolve(totalDeleted);
    });
  });
};

/**
 * Purges all property-related Redis caches:
 * - Property catalogs and filter listings
 * - Latest/Home screen feeds
 * - Filter options dropdown metadata
 * - Individual property detail caches
 *
 * @param {string|null} propertyId - Optional ID of the specific mutated property
 */
const clearPropertyCaches = async (propertyId = null) => {
  if (!isConnected()) return;

  try {
    const p1 = purgeKeysByPattern('klever:cache:*properties*');
    const p2 = purgeKeysByPattern('klever:cache:*filter-options*');
    const p3 = propertyId ? purgeKeysByPattern(`*${propertyId}*`) : Promise.resolve(0);

    const [c1, c2, c3] = await Promise.all([p1, p2, p3]);
    const total = c1 + c2 + c3;
    if (total > 0) {
      console.log(`✓ Redis Cache Invalidation: Purged ${total} keys (Property Mutation Event).`);
    }
  } catch (err) {
    console.warn('Redis cache invalidation warning:', err.message);
  }
};

/**
 * Purges metadata caches (amenities, tiers, agencies)
 */
const clearMetadataCaches = async () => {
  if (!isConnected()) return;
  try {
    const p1 = purgeKeysByPattern('klever:cache:*amenities*');
    const p2 = purgeKeysByPattern('klever:cache:*tiers*');
    const p3 = purgeKeysByPattern('klever:cache:*agencies*');
    const [c1, c2, c3] = await Promise.all([p1, p2, p3]);
    const total = c1 + c2 + c3;
    if (total > 0) {
      console.log(`✓ Redis Cache Invalidation: Purged ${total} metadata keys.`);
    }
  } catch (err) {
    console.warn('Redis metadata cache invalidation warning:', err.message);
  }
};

module.exports = {
  clearPropertyCaches,
  clearMetadataCaches,
  purgeKeysByPattern,
};

