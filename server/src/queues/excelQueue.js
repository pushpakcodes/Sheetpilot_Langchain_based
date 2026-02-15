import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from '../config/redis.js';

const connection = getRedisConnectionOptions();

export const excelQueue = new Queue('excel-processing', { connection });

/**
 * Adds an Excel processing job to the queue.
 * @param {Object} jobData - Data required for processing (e.g., action, previous output, file path)
 * @returns {Promise<Job>} - The created Job object
 */
export const addExcelJob = async (data) => {
    return excelQueue.add('process-excel', data, {
        removeOnComplete: false, // Keep job so we can read the return value!
        removeOnFail: false // Keep on failure for debugging
    });
};
