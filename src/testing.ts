import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { vi } from 'vitest';
import { ExpenseTrackerApi } from './api.js';
import type { Config } from './config.js';
import { createServer } from './server.js';

// A real MCP client talking to the real server in memory, with only the
// Expense Tracker API faked at fetch. Invented data only.

export type Route = (url: URL, init: RequestInit) => unknown;

export const fakeFetch = (routes: Record<string, Route>) =>
  vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? 'GET'} ${url.pathname}`;
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    const body = route(url, init);
    return body instanceof Response ? body : new Response(JSON.stringify(body));
  });

export const connect = async (
  fetchFn: typeof fetch,
  config: Partial<Config> = {},
): Promise<Client> => {
  const api = new ExpenseTrackerApi(
    { apiUrl: 'http://api.test', timeoutMs: 1000, ...config },
    fetchFn,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(api).connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
};

// Calls a tool and returns its JSON answer, or the error text.
export const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  return result.isError ? { error: text } : JSON.parse(text);
};
