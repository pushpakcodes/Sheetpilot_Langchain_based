import { orchestratePrompt } from './services/promptOrchestrator.js';
import fs from 'fs';

const logFile = 'debug_output.log';
const log = (msg) => {
    fs.appendFileSync(logFile, msg + '\n');
    console.log(msg);
};

// Capture console.error too
console.error = (msg, ...args) => {
    const formatted = [msg, ...args].join(' ');
    fs.appendFileSync(logFile, `ERROR: ${formatted}\n`);
    // process.stderr.write(formatted + '\n');
};

const runTest = async () => {
    log("Starting Debug Script...");

    const command = "at the end of sheet1 write name of all the users whose attendance is there in sheet1";

    // Mocking context with NO columns to see if it hallucinates text or fails
    const context = {
        sheetName: "Sheet1",
        columns: []
    };


    try {
        const result = await orchestratePrompt(command, context);
        log("Result: " + JSON.stringify(result, null, 2));

    } catch (error) {
        log("❌ Execution Failed with error: " + error);
    }
};

runTest();
