import { excelWorker } from './workers/excelWorker.js';

console.log('[Worker] Excel Processing Worker Started...');
console.log('[Worker] Waiting for jobs...');

// Keep process alive
process.on('SIGINT', async () => {
    console.log('[Worker] Shutting down...');
    await excelWorker.close();
    process.exit(0);
});
