import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ExpenseTrackerApi } from '../api.js';
import { failure, guarded, json, money, yearMonth } from './shared.js';

// Read-only tools. They return totals and summaries by default; individual
// expenses only when asked, since whatever a tool returns goes to the model.

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const byCurrency = () => ({ CAD: 0, USD: 0 }) as Record<'CAD' | 'USD', number>;

export const registerReadTools = (server: McpServer, api: ExpenseTrackerApi) => {
  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description:
        "The user's expense categories, each with its parent group and monthly budget (null " +
        'if none). Use these exact names when filtering or adding expenses.',
      annotations: READ_ONLY,
    },
    guarded(async () => {
      const categories = await api.categories();
      const nameOf = new Map(categories.map((c) => [c.id, c.name]));
      return json({
        categories: categories
          .filter((c) => c.parentCategoryId)
          .map((c) => ({
            name: c.name,
            group: nameOf.get(c.parentCategoryId!) ?? null,
            monthlyBudget: c.budget === null ? null : money(c.budget),
          })),
      });
    }),
  );

  server.registerTool(
    'monthly_summary',
    {
      title: 'Monthly totals',
      description:
        'Total spent (and optionally income) per month, in CAD and USD separately; the two ' +
        'currencies are never added together. Months with nothing recorded are left out. ' +
        'Defaults to the last 12 months that have data.',
      inputSchema: {
        from: yearMonth.optional().describe('First month, YYYY-MM (inclusive)'),
        to: yearMonth.optional().describe('Last month, YYYY-MM (inclusive)'),
        include_income: z.boolean().default(false).describe('Also return income per month'),
      },
      annotations: READ_ONLY,
    },
    guarded(async ({ from, to, include_income }) => {
      const rows = (await api.monthlyTotals())
        .filter((r) => r.type === 'expense' || include_income)
        .map((r) => ({ ...r, yearMonth: normalizeMonth(r.yearMonth) }))
        .filter((r) => (!from || r.yearMonth >= from) && (!to || r.yearMonth <= to));
      let months = [...new Set(rows.map((r) => r.yearMonth))].sort();
      if (!from && !to) months = months.slice(-12);
      const pick = (month: string, type: 'expense' | 'income') => {
        const row = rows.find((r) => r.yearMonth === month && r.type === type);
        return row ? { CAD: money(row.amountCad), USD: money(row.amountUsd) } : byCurrency();
      };
      return json({
        months: months.map((month) => ({
          month,
          spent: pick(month, 'expense'),
          ...(include_income ? { income: pick(month, 'income') } : {}),
        })),
      });
    }),
  );

  server.registerTool(
    'spending_report',
    {
      title: 'Spending by category for a month',
      description:
        'One month broken down by category, biggest first, with totals in CAD and USD ' +
        'separately. Gifts are reported as their own "Gifts" group. Set include_items to also ' +
        'list the expenses in each category (description, amount, currency).',
      inputSchema: {
        month: yearMonth.describe('The month, YYYY-MM'),
        include_items: z.boolean().default(false).describe('List the expenses in each category'),
      },
      annotations: READ_ONLY,
    },
    guarded(async ({ month, include_items }) => {
      const report = await api.monthlyReport(month);
      const categories = report.dataByCategory.map((entry) => {
        const totals = byCurrency();
        for (const item of entry.details) {
          if (item.currency === 'CAD' || item.currency === 'USD') {
            totals[item.currency] = money(totals[item.currency] + item.amount);
          }
        }
        return {
          category: entry.category,
          spent: totals,
          count: entry.details.length,
          ...(include_items
            ? {
                items: entry.details.map((d) => ({
                  description: d.description,
                  amount: money(d.amount),
                  currency: d.currency,
                })),
              }
            : {}),
        };
      });
      return json({
        month,
        spent: {
          CAD: money(report.totalSpentCad),
          USD: money(report.totalSpentUsd),
        },
        categories,
      });
    }),
  );

  server.registerTool(
    'list_expenses',
    {
      title: 'List expenses',
      description:
        'Individual expenses, newest first: for one month, or matching a text search over ' +
        'description and category (give month, search, or both). Optionally narrowed to one ' +
        'category. Prefer spending_report or monthly_summary for totals.',
      inputSchema: {
        month: yearMonth.optional().describe('The month, YYYY-MM'),
        search: z
          .string()
          .trim()
          .min(2)
          .max(100)
          .optional()
          .describe('Text to find in description or category'),
        category: z.string().trim().min(1).max(100).optional().describe('Exact category name'),
        limit: z.number().int().min(1).max(200).default(50).describe('At most this many'),
      },
      annotations: READ_ONLY,
    },
    guarded(async ({ month, search, category, limit }) => {
      if (!month && !search) {
        return failure('Give a month, a search text, or both.');
      }
      let expenses = month ? await api.expensesInMonth(month) : await api.searchExpenses(search!);
      if (month && search) {
        const needle = search.toLowerCase();
        expenses = expenses.filter(
          (e) =>
            e.description.toLowerCase().includes(needle) ||
            e.category.toLowerCase().includes(needle),
        );
      }
      if (category) {
        expenses = expenses.filter((e) => e.category.toLowerCase() === category.toLowerCase());
      }
      return json({
        total_found: expenses.length,
        expenses: expenses.slice(0, limit).map((e) => ({
          date: e.datePosted.slice(0, 10),
          description: e.description,
          amount: money(e.amount),
          currency: e.currency,
          category: e.category,
          account: e.account,
          ...(e.isGift ? { gift: true } : {}),
        })),
      });
    }),
  );

  server.registerTool(
    'list_recurring',
    {
      title: 'Recurring expenses and income',
      description:
        'Expenses that repeat every month (with the day of the month they fall on) and ' +
        'recurring income, with monthly totals per currency.',
      annotations: READ_ONLY,
    },
    guarded(async () => {
      const [expenses, income] = await Promise.all([
        api.recurringExpenses(),
        api.recurringIncome(),
      ]);
      const total = (rows: { amount: string | number; currency: string }[]) => {
        const totals = byCurrency();
        for (const r of rows) {
          if (r.currency === 'CAD' || r.currency === 'USD') {
            totals[r.currency] = money(totals[r.currency] + Number(r.amount));
          }
        }
        return totals;
      };
      return json({
        expenses: expenses.map((e) => ({
          description: e.description,
          category: e.category,
          amount: money(e.amount),
          currency: e.currency,
          account: e.account,
          dayOfMonth: e.dayOfMonth,
        })),
        expensesPerMonth: total(expenses),
        income: income.map((i) => ({
          description: i.description,
          category: i.category,
          amount: money(i.amount),
          currency: i.currency,
        })),
        incomePerMonth: total(income),
      });
    }),
  );
};

// The API may return "2026-3" for March in older rows.
const normalizeMonth = (value: string) => {
  const [year, month] = value.split('-');
  return `${year}-${month.padStart(2, '0')}`;
};
