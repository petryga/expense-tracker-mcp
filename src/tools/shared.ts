import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ApiError } from '../api.js';

export const yearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM, for example 2026-10');

// Money comes back from the API as strings or numbers; tools answer in numbers
// rounded to the cent.
export const money = (value: string | number | null | undefined) =>
  Math.round(Number(value ?? 0) * 100) / 100;

// Every tool answers with JSON as text (what every client reads) and the same
// object as structured content (for clients that use it).
export const json = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});

// An expected failure the agent can act on: no stack trace, no API body.
export const failure = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

export const guarded =
  <A>(run: (args: A) => Promise<CallToolResult>) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return await run(args);
    } catch (error) {
      if (error instanceof ApiError) return failure(error.message);
      // Anything else is a bug here; say so without details that could carry data.
      console.error('expense-tracker-mcp: unexpected error', (error as Error)?.name);
      return failure('Unexpected error in the Expense Tracker MCP server.');
    }
  };
