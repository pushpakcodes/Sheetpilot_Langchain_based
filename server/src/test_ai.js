
import { orchestratePrompt } from './services/promptOrchestrator.js';
import fs from 'fs';

const logFile = 'test_output.log';

const log = (msg) => {
    fs.appendFileSync(logFile, msg + '\n');
    console.log(msg);
};

console.error = (msg, ...args) => {
    const formatted = [msg, ...args].join(' ');
    fs.appendFileSync(logFile, `ERROR: ${formatted}\n`);
    // process.stderr.write(formatted + '\n'); // Optional
};


log("Starting test script...");

const runTest = async () => {
    log("Testing orchestratePrompt...");

    const command = "Add a profit column which is Revenue - Cost";
    const context = {
        sheetName: "Sheet1",
        columns: ["Date", "Revenue", "Cost", "Region"]
    };

    try {
        const result = await orchestratePrompt(command, context);
        log("Result: " + JSON.stringify(result, null, 2));

        if (result.actions || result.action === 'ADD_COLUMN') {
            log("✅ Test Passed");
        } else {
            log("❌ Test Failed: Unexpected output format");
        }

    } catch (error) {
        log("❌ Test Failed with error: " + error);
    }
};

runTest();

