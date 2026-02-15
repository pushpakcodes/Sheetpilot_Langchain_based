
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log file path: server/application.log
// Go up two levels from src/utils -> src -> server root
const LOG_FILE = path.join(__dirname, '..', '..', 'application.log');

const formatMessage = (level, message, meta) => {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? (typeof meta === 'object' ? JSON.stringify(meta) : String(meta)) : '';
    return `[${timestamp}] [${level}] ${message} ${metaStr}\n`;
};

const appendLog = (msg) => {
    try {
        fs.appendFileSync(LOG_FILE, msg);
    } catch (err) {
        console.error('Failed to write to log file:', err);
    }
};

export const logger = {
    info: (message, meta) => {
        const msg = formatMessage('INFO', message, meta);
        console.log(message, meta || '');
        appendLog(msg);
    },
    error: (message, meta) => {
        const msg = formatMessage('ERROR', message, meta);
        console.error(message, meta || '');
        appendLog(msg);
    },
    warn: (message, meta) => {
        const msg = formatMessage('WARN', message, meta);
        console.warn(message, meta || '');
        appendLog(msg);
    }
};
