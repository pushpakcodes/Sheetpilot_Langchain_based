import { Redis } from 'ioredis';

const redis = new Redis({
    host: '127.0.0.1',
    port: 6379,
    connectTimeout: 2000,
    lazyConnect: true
});

console.log('Attempting to connect to Redis at 127.0.0.1:6379...');

try {
    await redis.connect();
    console.log('✅ Connected to Redis successfully!');
    await redis.set('test', 'Hello from SheetPilot');
    const val = await redis.get('test');
    console.log('Redis Response:', val);
    await redis.quit();
    process.exit(0);
} catch (err) {
    console.error('❌ Connection Failed:', err.message);
    process.exit(1);
}
