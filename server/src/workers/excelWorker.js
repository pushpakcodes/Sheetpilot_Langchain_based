import { Worker } from 'bullmq';
import { getRedisConnectionOptions } from '../config/redis.js';
import { processExcelAction } from '../services/excelService.js';
import { logger } from '../utils/logger.js';

const connection = getRedisConnectionOptions();

export const excelWorker = new Worker('excel-processing', async (job) => {
    logger.info(`[Worker] Processing Job ${job.id}:`, job.name);
    logger.info(`[Worker] Payload:`, job.data);

    try {
        const { filePath, actions, sheetId } = job.data;

        // Execute the CPU-intensive Excel task
        // processExcelAction returns the new file path
        const resultFilePath = await processExcelAction(filePath, actions, sheetId);

        logger.info(`[Worker] Job ${job.id} Completed. Result: ${resultFilePath}`);
        return { success: true, newFilePath: resultFilePath };
    } catch (error) {
        logger.error(`[Worker] Job ${job.id} Failed:`, error.message);
        // Instead of throwing (which marks job as failed and makes it hard to get return value),
        // we return a success: false result with the error message.
        return { success: false, error: error.message };
    }
}, {
    connection,
    concurrency: 1 // Process one sheet at a time per worker instance to avoid CPU thrashing
});

excelWorker.on('completed', (job, returnvalue) => {
    console.log(`[Worker] Job ${job.id} finished!`);
});

excelWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} failed with ${err.message}`);
});
