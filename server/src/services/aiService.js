import { orchestratePrompt } from './promptOrchestrator.js';
import { processExcelAction, getPreviewData } from './excelService.js';
import ExcelJS from 'exceljs';
import path from 'path';

class AICommandValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'AICommandValidationError';
    this.statusCode = 400;
    this.type = 'VALIDATION_ERROR';
    this.details = details;
  }
}

class AICommandParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AICommandParseError';
    this.statusCode = 400;
    this.type = 'AI_ERROR';
  }
}

const isBlankString = (value) => typeof value === 'string' && value.trim() === '';

const requireNonEmptyString = (obj, key) => {
  const value = obj?.[key];
  if (value === undefined || value === null || isBlankString(value)) {
    throw new AICommandValidationError(`Missing required parameter "${key}".`, { key });
  }
  if (typeof value !== 'string') {
    throw new AICommandValidationError(`Parameter "${key}" must be a string.`, { key });
  }
  return value;
};

const requireNonEmptyValue = (obj, key) => {
  const value = obj?.[key];
  if (value === undefined || value === null || isBlankString(value)) {
    throw new AICommandValidationError(`Missing required parameter "${key}".`, { key });
  }
  return value;
};

const validateNoEmptyStrings = (params) => {
  if (!params || typeof params !== 'object') return;
  for (const [k, v] of Object.entries(params)) {
    if (isBlankString(v)) {
      throw new AICommandValidationError(`Parameter "${k}" must not be an empty string.`, { key: k });
    }
  }
};

const validateActionObject = (actionObj) => {
  if (!actionObj || typeof actionObj !== 'object') {
    throw new AICommandValidationError('AI output must be an object.', {});
  }

  const action = actionObj.action;
  const params = actionObj.params;

  if (!action || typeof action !== 'string' || isBlankString(action)) {
    throw new AICommandValidationError('Missing required field "action".', {});
  }

  if (!params || typeof params !== 'object') {
    throw new AICommandValidationError('Missing required field "params".', { action });
  }

  // validateNoEmptyStrings(params); // Too strict for some actions

  switch (action) {
    case 'ADD_COLUMN':
      requireNonEmptyString(params, 'columnName');
      // Formula can be empty (defaults to empty column content)
      if (params.formula === undefined || params.formula === null) {
        params.formula = '';
      }
      break;
    case 'HIGHLIGHT_ROWS':
      requireNonEmptyString(params, 'condition');
      break;
    case 'SORT_DATA': {
      requireNonEmptyString(params, 'column');
      const order = requireNonEmptyString(params, 'order').toLowerCase();
      if (order !== 'asc' && order !== 'desc') {
        throw new AICommandValidationError('Parameter "order" must be "asc" or "desc".', { key: 'order' });
      }
      params.order = order;
      break;
    }
    case 'UPDATE_ROW_VALUES': {
      requireNonEmptyString(params, 'filterColumn');
      requireNonEmptyValue(params, 'filterValue');
      const operation = requireNonEmptyString(params, 'operation');
      const allowed = new Set(['SET', '+', '-', '*', '/']);
      if (!allowed.has(operation)) {
        throw new AICommandValidationError('Parameter "operation" must be one of: SET, +, -, *, /.', { key: 'operation' });
      }
      requireNonEmptyValue(params, 'value');
      requireNonEmptyString(params, 'targetColumn');
      break;
    }
    case 'UPDATE_COLUMN_VALUES': {
      requireNonEmptyString(params, 'column');
      const operation = requireNonEmptyString(params, 'operation');
      const allowed = new Set(['SET', '+', '-', '*', '/']);
      if (!allowed.has(operation)) {
        throw new AICommandValidationError('Parameter "operation" must be one of: SET, +, -, *, /.', { key: 'operation' });
      }
      requireNonEmptyValue(params, 'value');
      break;
    }
    case 'UPDATE_KEY_VALUE':
      requireNonEmptyString(params, 'keyColumn');
      requireNonEmptyValue(params, 'keyValue');
      requireNonEmptyValue(params, 'newValue');
      if (params.valueColumn !== undefined && params.valueColumn !== null) {
        if (typeof params.valueColumn !== 'string' || isBlankString(params.valueColumn)) {
          throw new AICommandValidationError('Parameter "valueColumn" must be a non-empty string when provided.', { key: 'valueColumn' });
        }
      }
      break;
    case 'SET_CELL': {
      const cell = requireNonEmptyString(params, 'cell');
      if (!/^[A-Za-z]+[0-9]+$/.test(cell.trim())) {
        throw new AICommandValidationError('Parameter "cell" must be a valid Excel cell address (e.g. A1, B5).', { key: 'cell' });
      }
      requireNonEmptyValue(params, 'value');
      break;
    }
    case 'FIND_AND_REPLACE':
      // findValue and replaceValue CAN be empty strings (e.g. find empty cells, or clear cells)
      // So we don't use requireNonEmptyString for them, just ensure they exist and are strings/numbers
      if (params.findValue === undefined || params.findValue === null) {
        throw new AICommandValidationError('Missing parameter "findValue".', { key: 'findValue' });
      }
      if (params.replaceValue === undefined || params.replaceValue === null) {
        throw new AICommandValidationError('Missing parameter "replaceValue".', { key: 'replaceValue' });
      }
      if (params.column !== undefined && params.column !== null) {
        if (typeof params.column !== 'string' || isBlankString(params.column)) {
          throw new AICommandValidationError('Parameter "column" must be a non-empty string when provided.', { key: 'column' });
        }
      }
      break;
    case 'ADD_ROW':
      if (!params || typeof params.data !== 'object') {
        throw new AICommandValidationError('Parameter "data" must be an object/record.', { key: 'data' });
      }
      break;
    case 'ERROR':
      requireNonEmptyString(actionObj, 'message');
      break;
    default:
      throw new AICommandValidationError(`Unsupported action "${action}".`, { action });
  }

  return { action, params };
};

const detectSheetContext = async (filePath, sheetId, scanDepth = 20) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = sheetId ? workbook.getWorksheet(sheetId) : workbook.worksheets[0];
  if (!worksheet) return { sheetName: sheetId || null, columns: [] };

  const maxRow = Math.min(worksheet.rowCount || scanDepth, scanDepth);
  let bestRowValues = [];
  let bestScore = 0;

  for (let r = 1; r <= maxRow; r++) {
    const row = worksheet.getRow(r);
    const texts = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (v === null || v === undefined) return;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t) texts.push(t);
        return;
      }
      if (typeof v === 'number') return;
      if (typeof v === 'object' && v !== null) {
        if (typeof v.text === 'string') {
          const t = v.text.trim();
          if (t) texts.push(t);
        } else if (v.result !== undefined && v.result !== null && typeof v.result === 'string') {
          const t = v.result.trim();
          if (t) texts.push(t);
        }
      }
    });

    const unique = new Set(texts.map(t => t.toLowerCase()));
    if (unique.size > bestScore) {
      bestScore = unique.size;
      bestRowValues = texts;
    }
  }

  const columns = [];
  const seen = new Set();
  for (const t of bestRowValues) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      columns.push(t);
    }
  }

  return { sheetName: worksheet.name, columns: bestScore >= 2 ? columns.slice(0, 50) : [] };
};

import { QueueEvents } from 'bullmq';
import { addExcelJob, excelQueue } from '../queues/excelQueue.js';
import { getRedisConnectionOptions } from '../config/redis.js';

const queueEvents = new QueueEvents('excel-processing', { connection: getRedisConnectionOptions() });

export const executeAICommand = async (command, filePath, sheetId) => {
  try {
    const context = await detectSheetContext(filePath, sheetId);

    const actionData = await orchestratePrompt(command, context);
    console.log('AI Action:', actionData);

    if (actionData?.action === 'ERROR') {
      throw new AICommandParseError(actionData.message || 'AI could not interpret the command.');
    }

    let actions = null;
    if (Array.isArray(actionData?.actions)) {
      actions = actionData.actions;
    } else if (actionData?.action) {
      actions = [actionData];
    } else {
      throw new AICommandParseError('AI output is missing "action" or "actions".');
    }

    if (actions.length === 0) {
      throw new AICommandParseError('AI returned an empty actions list.');
    }

    const validatedActions = actions.map(validateActionObject);

    // --- REDIS QUEUE INTEGRATION ---
    // Resolve absolute path so the Worker (running from root) can find the file (in server/uploads)
    const absoluteFilePath = path.resolve(filePath);
    console.log('[AI Service] Enqueuing Job to Redis with path:', absoluteFilePath);

    const job = await addExcelJob({
      filePath: absoluteFilePath,
      sheetId,
      actions: validatedActions
    });

    console.log(`[AI Service] Job ${job.id} enqueued. Waiting for completion...`);

    // Wait for the worker to finish processing
    await job.waitUntilFinished(queueEvents);

    // Fetch the job fresh from Redis to ensure we have the return value
    // (The local 'job' instance might not update its returnvalue property automatically)
    const completedJob = await job.constructor.fromId(excelQueue, job.id);
    const result = completedJob ? completedJob.returnvalue : null;

    console.log(`[AI Service] Job ${job.id} finished. Result:`, result);

    if (!result) {
      throw new Error(`Worker returned null result for Job ${job.id}. State: ${await job.getState()}`);
    }

    if (!result.success) {
      // Validation/Logic error from the worker (e.g. "Column not found")
      // We return this as a valid "Action" with status error, so the UI can show it gracefully.
      // Or we can throw a specific 400 error.
      // Let's return a structured response so the controller can send 200 OK with error info?
      // Actually, the controller expects a thrown error to send 400/500.
      // But the user wants to see the message. 
      // Let's throw a custom error that the controller interprets as 400.
      throw new AICommandValidationError(result.error || 'Unknown worker error');
    }

    const currentFilePath = result.newFilePath;
    const preview = await getPreviewData(currentFilePath);

    return {
      success: true,
      action: actionData,
      results: result.results,
      filePath: currentFilePath,
      preview: preview
    };

  } catch (error) {
    console.error('AI Execution Failed:', error);
    throw error;
  }
};
