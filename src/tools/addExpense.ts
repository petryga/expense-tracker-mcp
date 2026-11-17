import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ExpenseTrackerApi } from '../api.js';
import { failure, guarded, json, money } from './shared.js';

// The one write tool. It adds a single expense and never changes or deletes
// anything. Every field is checked before the API is called, and the
// category must be one the user already has.

const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const addExpenseInput = {
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine(isRealDate, 'Not a real date')
    .describe('The day it was paid, YYYY-MM-DD'),
  amount: z
    .number()
    .positive('Must be more than 0')
    .max(100_000, 'Over 100,000: add it in the app instead')
    .refine((n) => Math.round(n * 100) === Number((n * 100).toFixed(6)), 'At most two decimals')
    .describe('Amount in dollars, for example 12.40'),
  currency: z.enum(['CAD', 'USD']).describe('CAD or USD'),
  category: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('An existing category, from list_categories'),
  description: z.string().trim().min(1).max(200).describe('What it was, for example "Coffee"'),
  account: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('The card or account it was paid with, for example "Amex"'),
};

export const registerAddExpense = (server: McpServer, api: ExpenseTrackerApi) => {
  server.registerTool(
    'add_expense',
    {
      title: 'Add an expense',
      description:
        'WRITES DATA: adds one expense. Confirm the details with the user before calling. ' +
        'The category must be an existing one (see list_categories). Returns the saved expense.',
      inputSchema: addExpenseInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guarded(async ({ date, amount, currency, category, description, account }) => {
      const categories = await api.categories();
      const match = categories.find(
        (c) => c.parentCategoryId && c.name.toLowerCase() === category.toLowerCase(),
      );
      if (!match) {
        return failure(
          `There is no category "${category}". Call list_categories and use one of those names.`,
        );
      }
      const saved = await api.addExpense({
        id: randomUUID(),
        datePosted: date,
        description,
        amount: amount.toFixed(2),
        currency,
        category: match.name,
        account,
      });
      return json({
        added: {
          id: saved.id,
          date: saved.datePosted.slice(0, 10),
          description: saved.description,
          amount: money(saved.amount),
          currency: saved.currency,
          category: saved.category,
          account: saved.account,
        },
      });
    }),
  );
};
