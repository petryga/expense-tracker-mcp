import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExpenseTrackerApi } from './api.js';
import { registerAddExpense } from './tools/addExpense.js';
import { registerReadTools } from './tools/read.js';

export const createServer = (api: ExpenseTrackerApi) => {
  const server = new McpServer({ name: 'expense-tracker', version: '0.1.0' });
  registerReadTools(server, api);
  registerAddExpense(server, api);
  return server;
};
