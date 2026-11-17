#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ExpenseTrackerApi } from './api.js';
import { readConfig } from './config.js';
import { createServer } from './server.js';

// stdio: the MCP client starts this process and talks to it over stdin and
// stdout, so stdout carries protocol messages only. Diagnostics go to stderr.
const main = async () => {
  const config = readConfig();
  const server = createServer(new ExpenseTrackerApi(config));
  await server.connect(new StdioServerTransport());
  console.error(`expense-tracker-mcp: ready, API at ${config.apiUrl}`);
};

main().catch((error: unknown) => {
  console.error(`expense-tracker-mcp: ${(error as Error)?.message ?? 'failed to start'}`);
  process.exit(1);
});
