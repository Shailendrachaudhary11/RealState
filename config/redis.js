const Redis = require('ioredis');

let redisClient = null;
let isRedisConnected = false;

const initRedis = () => {
  if (redisClient) return redisClient;

  const redisOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 5000,
    retryStrategy(times) {
      if (times > 10) {
        console.warn('Redis retry limit reached. Falling back to MongoDB.');
        return null; // Stop retrying after 10 attempts
      }
      return Math.min(times * 100, 2000);
    },
  };

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && redisUrl.startsWith('redis')) {
    redisClient = new Redis(redisUrl, {
      ...redisOptions,
      lazyConnect: true,
    });
  } else {
    redisClient = new Redis(redisOptions);
  }

  redisClient.on('connect', () => {
    isRedisConnected = true;
    console.log('✓ Redis connected successfully.');
  });

  redisClient.on('ready', () => {
    isRedisConnected = true;
  });

  redisClient.on('error', (err) => {
    isRedisConnected = false;
    console.warn(`⚠ Redis Notice (${err.code || err.message}). Bypassing cache to MongoDB.`);
  });

  redisClient.on('close', () => {
    isRedisConnected = false;
  });

  // Attempt non-blocking initial connection
  redisClient.connect().catch((err) => {
    isRedisConnected = false;
    console.warn(`⚠ Redis Initial Connection failed: ${err.message}. Operating in direct MongoDB mode.`);
  });

  return redisClient;
};

const getRedisClient = () => {
  if (!redisClient) {
    return initRedis();
  }
  return redisClient;
};

const isConnected = () => {
  return isRedisConnected && redisClient && redisClient.status === 'ready';
};

module.exports = {
  redis: getRedisClient(),
  getRedisClient,
  isConnected,
};

