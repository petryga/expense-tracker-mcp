import type { Config } from './config.js';

// The Expense Tracker's REST API, as the tools need it. Errors are turned into
// short messages an agent can act on; response bodies and stack traces are
// never passed on.

export class ApiError extends Error {}

type Fetch = typeof fetch;

export interface Category {
  id: string;
  name: string;
  parentCategoryId: string | null;
  budget: number | string | null;
}

export interface Expense {
  id: string;
  datePosted: string;
  description: string;
  amount: string | number;
  currency: string;
  category: string;
  account: string;
  isGift?: boolean;
  // Where it was bought when the description doesn't say: "Amazon" for the
  // items of a split Amazon charge, or a marketplace from the user's list.
  merchant?: string | null;
}

export interface MonthlyTotals {
  type: 'expense' | 'income';
  yearMonth: string;
  amountCad: string;
  amountUsd: string;
}

export interface MonthlyReport {
  yearMonth: string;
  dataByCategory: {
    category: string;
    total: number;
    details: { description: string; amount: number; currency: string; merchant?: string }[];
  }[];
  totalSpentCad: number;
  totalSpentUsd: number;
}

export interface RecurringExpense {
  description: string;
  category: string;
  amount: string | number;
  account: string;
  dayOfMonth: number;
  currency: string;
}

export interface RecurringIncome {
  description: string;
  category: string;
  amount: string | number;
  currency: string;
}

export interface NewExpense {
  id: string;
  datePosted: string;
  description: string;
  amount: string;
  currency: 'CAD' | 'USD';
  category: string;
  account: string;
}

export class ExpenseTrackerApi {
  constructor(
    private readonly config: Config,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.config.apiUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const timedOut = (error as Error)?.name === 'TimeoutError';
      throw new ApiError(
        timedOut
          ? 'The Expense Tracker API did not answer in time.'
          : `Could not reach the Expense Tracker API at ${this.config.apiUrl}. Is it running?`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(
        'The Expense Tracker API refused the request: check EXPENSE_TRACKER_TOKEN.',
      );
    }
    if (!res.ok) {
      // A 400 carries a short validation message worth passing on.
      const message = res.status === 400 ? await errorMessage(res) : undefined;
      throw new ApiError(
        `The Expense Tracker API answered ${res.status}${message ? `: ${message}` : ''}.`,
      );
    }
    return (await res.json()) as T;
  }

  categories = () => this.request<Category[]>('/categories');

  monthlyTotals = () => this.request<MonthlyTotals[]>('/monthlyData');

  monthlyReport = (yearMonth: string) =>
    this.request<MonthlyReport>(`/reports/monthly?yearMonth=${encodeURIComponent(yearMonth)}`);

  expensesInMonth = async (yearMonth: string) =>
    (
      await this.request<{ data: Expense[] }>(
        `/expenses?yearMonth=${encodeURIComponent(yearMonth)}`,
      )
    ).data;

  searchExpenses = async (text: string) =>
    (await this.request<{ data: Expense[] }>(`/expenses?search=${encodeURIComponent(text)}`)).data;

  recurringExpenses = () => this.request<RecurringExpense[]>('/recurringExpenses');

  recurringIncome = () => this.request<RecurringIncome[]>('/recurringIncome');

  addExpense = (expense: NewExpense) =>
    this.request<Expense>('/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    });
}

const errorMessage = async (res: Response) => {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
};
