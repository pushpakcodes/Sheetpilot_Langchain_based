import { addExcelJob, excelQueue } from './server/src/queues/excelQueue.js';
import { QueueEvents } from 'bullmq';
import { getRedisConnectionOptions } from './server/src/config/redis.js';

const run = async () => {
    console.log('Testing Redis Queue...');

    // Create a queue events listener
    const queueEvents = new QueueEvents('excel-processing', { connection: getRedisConnectionOptions() });

    console.log('Adding dummy job...');
    const job = await addExcelJob({
        filePath: 'test.xlsx',
        actions: [{ action: 'HIGHLIGHT_ROWS', params: { condition: 'A > 10', color: 'FF0000' } }],
        sheetId: 'Sheet1'
    });

    console.log(`Job ${job.id} added. Waiting for completion...`);

    try {
        await job.waitUntilFinished(queueEvents);
        console.log('Job completed successfully!');
        const result = await job.returnvalue;
        console.log('Result:', result);
    } catch (err) {
        console.error('Job failed:', err);
    }

    process.exit(0);
};

run();
