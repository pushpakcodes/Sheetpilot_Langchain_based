import { ChatGroq } from "@langchain/groq";
import { z } from "zod";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

const MODEL_NAME = "llama-3.1-8b-instant";

// Define Zod schemas for each action's params
const AddColumnSchema = z.object({
   action: z.literal("ADD_COLUMN"),
   params: z.object({
      columnName: z.string().describe("Name of the new column"),
      formula: z.string().optional().describe("Excel formula, e.g., 'Revenue - Cost'"),
   }),
});

const HighlightRowsSchema = z.object({
   action: z.literal("HIGHLIGHT_ROWS"),
   params: z.object({
      condition: z.string().describe("Condition, e.g., 'Revenue > 5000'"),
      color: z.string().default("FFFF00").describe("Hex code for color"),
   }),
});

const SortDataSchema = z.object({
   action: z.literal("SORT_DATA"),
   params: z.object({
      column: z.string().describe("Column name to sort by"),
      order: z.enum(["asc", "desc"]).describe("Sort order"),
   }),
});

const UpdateColumnValuesSchema = z.object({
   action: z.literal("UPDATE_COLUMN_VALUES"),
   params: z.object({
      column: z.string().describe("Column name to update"),
      operation: z.enum(["SET", "+", "-", "*", "/"]).default("SET").describe("Operation type"),
      value: z.union([z.string(), z.number()]).describe("Value or amount to apply"),
   }),
});

const UpdateRowValuesSchema = z.object({
   action: z.literal("UPDATE_ROW_VALUES"),
   params: z.object({
      filterColumn: z.string().describe("Column to search in for identifying rows"),
      filterValue: z.union([z.string(), z.number()]).describe("Value to identify the row"),
      operation: z.enum(["SET", "+", "-", "*", "/"]).default("SET").describe("Operation type"),
      value: z.union([z.string(), z.number()]).describe("New value or amount to apply"),
      targetColumn: z.string().describe("Specific column to update"),
   }),
});

const UpdateKeyValueSchema = z.object({
   action: z.literal("UPDATE_KEY_VALUE"),
   params: z.object({
      keyColumn: z.string().describe("Header of key column or key label"),
      keyValue: z.union([z.string(), z.number()]).describe("Key/label to search for"),
      valueColumn: z.string().optional().describe("Header of value column if exists"),
      newValue: z.union([z.string(), z.number()]).describe("New value to set"),
   }),
});

const SetCellSchema = z.object({
   action: z.literal("SET_CELL"),
   params: z.object({
      cell: z.string().describe("Cell address, e.g., 'A1'"),
      value: z.union([z.string(), z.number()]).describe("New value"),
   }),
});

const FindAndReplaceSchema = z.object({
   action: z.literal("FIND_AND_REPLACE"),
   params: z.object({
      findValue: z.union([z.string(), z.number()]).describe("Value to search for"),
      replaceValue: z.union([z.string(), z.number()]).describe("New value"),
      column: z.string().optional().describe("Restrict search to this column"),
   }),
});

const AddRowSchema = z.object({
   action: z.literal("ADD_ROW"),
   params: z.object({
      data: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).describe("Key-value pair of Column Header -> Value"),
   }),
});

const ErrorSchema = z.object({
   action: z.literal("ERROR"),
   message: z.string().describe("Reason for error or clarification request"),
});

// Single Action Schema
const ActionSchema = z.discriminatedUnion("action", [
   AddColumnSchema,
   HighlightRowsSchema,
   SortDataSchema,
   UpdateColumnValuesSchema,
   UpdateRowValuesSchema,
   UpdateKeyValueSchema,
   SetCellSchema,
   FindAndReplaceSchema,
   AddRowSchema,
   ErrorSchema,
]);

// ... (rest of file)

// Main Output Schema
const OutputSchema = z.object({
   actions: z.array(ActionSchema).optional().describe("List of actions to execute"),
   action: z.string().optional().describe("Legacy support"),
   params: z.record(z.any()).optional().describe("Legacy support"),
});

// Initialize Parser
const parser = StructuredOutputParser.fromZodSchema(OutputSchema);

// Initialize Model
const model = new ChatGroq({
   apiKey: process.env.GROQ_API_KEY,
   model: MODEL_NAME,
   temperature: 0,
});

const SYSTEM_TEMPLATE = `You are an AI spreadsheet command parser.
Your job is to convert a user’s natural language instruction into a structured JSON command that can be executed on an Excel workbook.

Rules:
- You must ONLY output valid JSON.
- Do NOT output any conversational text, apologies, or explanations outside the JSON.
- Do NOT hallucinate columns or sheets. If a column name is not provided in the context or the command, return an ERROR.
- Never leave required params empty.
- If the command is unclear, ambiguous, or you are unsure, return an ERROR action with a clarifying question.
- If the user asks to modify existing values, never create a new column unless explicitly asked.
- If a command requires multiple steps, output multiple actions in the 'actions' array.
- STRICTLY follow the schema. Do not add extra fields.

{format_instructions}

Supported Actions:
1. ADD_COLUMN: Add new column with formula/value.
2. HIGHLIGHT_ROWS: Highlight rows based on condition.
3. SORT_DATA: Sort data by column.
4. UPDATE_COLUMN_VALUES: Update entire column.
5. UPDATE_ROW_VALUES: Update values in a row identified by filter.
6. UPDATE_KEY_VALUE: Update values in Key-Value table structure.
7. SET_CELL: Update specific cell.
8. FIND_AND_REPLACE: Find value and replace with new value.
9. ADD_ROW: Append a new row of data. Use this when the user says "add entry", "fill data", or "insert row".
   - If the user asks to "fill" or "add" values without specifying them, YOU MUST GENERATE REALISTIC FICTITIOUS DATA (e.g., names, locations, random numbers). DO NOT use null or empty strings unless explicitly asked.
10. ERROR: Invalid or unclear command.
`;


export const orchestratePrompt = async (userCommand, context = {}) => {
   if (!process.env.GROQ_API_KEY) {
      logger.error("Missing GROQ_API_KEY");
      return {
         action: "ERROR",
         message: "AI service unavailable: Missing API configuration"
      };
   }

   try {
      const contextLines = [];
      if (context?.sheetName) contextLines.push(`Active sheet: ${context.sheetName}`);
      if (Array.isArray(context?.columns) && context.columns.length > 0) {
         contextLines.push(`Columns in this sheet: ${context.columns.join(', ')}`);
         contextLines.push(`Only use column names from the provided list when a column is required.`);
      }
      const contextString = contextLines.length > 0 ? `\nContext:\n${contextLines.join('\n')}` : "";

      const prompt = await parser.getFormatInstructions();

      const messages = [
         {
            role: "system",
            content: SYSTEM_TEMPLATE.replace("{format_instructions}", prompt)
         },
         {
            role: "user",
            content: contextString + "\nUser Command: " + userCommand
         }
      ];

      const response = await model.invoke(messages);
      logger.info("DEBUG: Raw LLM Response:", response.content);

      // Parse the output
      try {
         const parsedOutput = await parser.parse(response.content);

         // Normalize output
         if (parsedOutput.actions && parsedOutput.actions.length > 0) {
            return { actions: parsedOutput.actions };
         } else if (parsedOutput.action && parsedOutput.action !== 'ERROR') {
            return { action: parsedOutput.action, params: parsedOutput.params };
         } else if (parsedOutput.action === 'ERROR') {
            // For ErrorSchema, message is in parsedOutput directly? 
            // ErrorSchema: { action: 'ERROR', message }
            // ActionSchema union contains ErrorSchema.
            // If legacy support was matched (action/params), then use it.
            // If Actions array is populated, check if it's error?

            return { action: 'ERROR', message: parsedOutput.message || 'Error executing command' };
         }

         // If we parsed successfully but got nothing useful (likely schema definition matched as optional empty object)
         // THROW to trigger the manual fallback below which is smarter about multiple blocks
         throw new Error("Parsed JSON was empty (schema match?)");

      } catch (parseError) {
         logger.error("LangChain Parse Error:", parseError);
         logger.error("Raw Content:", response.content);
         // Try manual fallback to find the valid JSON response
         try {
            // Strategy 1: Look for markdown code blocks
            const codeBlockRegex = /```json\s*([\s\S]*?)\s*```/g;
            let match;
            while ((match = codeBlockRegex.exec(response.content)) !== null) {
               try {
                  const potentialJson = JSON.parse(match[1]);
                  if (potentialJson.actions || potentialJson.action) {
                     return potentialJson;
                  }
               } catch (e) {
                  // Continue to next block
               }
            }

            // Strategy 2: Look for the LAST valid JSON object in the text (often the response comes last)
            // We use a non-greedy approach finding the last complete object structure is hard with regex, 
            // so we try to find the last occurring "actions" and parse around it? 
            // Simpler: Split by empty lines and try to parse chunks? 
            // Or just try to match the last pair of braces?

            // Let's try to extract top-level objects
            const objectRegex = /\{[\s\S]*?\}/g;
            // This is still risky with nested objects.

            // Fallback: Just return generic error if logic 1 failed. The LLM usually uses code blocks.
            // But let's try strict json match for the last block if it exists without markdown
            const lastOpenBrace = response.content.lastIndexOf('{');
            const lastCloseBrace = response.content.lastIndexOf('}');
            if (lastOpenBrace !== -1 && lastCloseBrace > lastOpenBrace) {
               const potentialJsonString = response.content.substring(lastOpenBrace, lastCloseBrace + 1);
               const manualJson = JSON.parse(potentialJsonString);
               if (manualJson.actions || manualJson.action) {
                  return manualJson;
               }
            }
         } catch (e) {
            logger.error("Manual Fallback Parse Error:", e);
         }

         return {
            action: "ERROR",
            message: "Could not interpret command: Invalid response format"
         };
      }
   } catch (error) {
      logger.error("AI Orchestration Error FULL OBJECT:", JSON.stringify(error, null, 2));
      logger.error("AI Orchestration Error:", error.message);
      if (error.response) {
         logger.error("AI Provider Response Status:", error.response.status);
         logger.error("AI Provider Response Data:", JSON.stringify(error.response.data));
      }
      return {
         action: "ERROR",
         message: `AI service unavailable: ${error.message}`
      };
   }
};
