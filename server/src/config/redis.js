import { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Patch ioredis-mock for BullMQ compatibility
if (!RedisMock.prototype.client) {
    console.log('[Redis Mock] Patching "client" command for BullMQ');
    RedisMock.prototype.client = () => Promise.resolve();
}

// Robustly load .env from the server root, regardless of where the process started
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// We are in server/src/config, so .env is in ../../.env (relative to this file)
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

console.log(`[Redis Config] Loaded env from: ${envPath}`);
console.log(`[Redis Config] USE_MOCK_REDIS: ${process.env.USE_MOCK_REDIS}`);

let useMock = (process.env.USE_MOCK_REDIS || '').trim().toLowerCase() === 'true';

// If no Redis Host is configured, fallback to Mock for safety
if (!process.env.REDIS_HOST) {
    console.log('[Redis Config] No REDIS_HOST found. Defaulting to In-Memory Mock.');
    useMock = true;
}

const redisConfig = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
    // Short retry strategy to fail fast if real redis is down (but we prefer Mock via env)
    retryStrategy: (times) => Math.min(times * 50, 2000)
};

if (useMock) {
    console.log('⚠️  [Redis] Using In-Memory Mock Redis (configured via .env)');
} else {
    console.log('🔌 [Redis] Attempting connection to', redisConfig.host, redisConfig.port);
}

// Factory for BullMQ
export const getRedisConnectionOptions = () => {
    if (useMock) {
        return new RedisMock();
    }
    return redisConfig;
};

// Singleton for general use
export const redisConnection = useMock ? new RedisMock() : new Redis(redisConfig);

redisConnection.on('error', (err) => {
    if (!useMock) {
        console.error('[Redis Error]', err.message);
        if (err.code === 'ECONNREFUSED') {
            console.error('👉 Tip: Set USE_MOCK_REDIS=true in server/.env if you do not have Redis installed.');
        }
    }
});
