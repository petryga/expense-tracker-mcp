import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';
import { call, connect, fakeFetch } from './testing.js';

const CATEGORIES = [
  { id: 'p1', name: 'Food & Dining', parentCategoryId: null, budget: null },
  { id: 'c1', name: 'Groceries', parentCategoryId: 'p1', budget: '400.00' },
  { id: 'c2', name: 'Coffee Shops', parentCategoryId: 'p1', budget: null },
  { id: 'p2', name: 'Fun', parentCategoryId: null, budget: null },
  { id: 'c3', name: 'Hobbies', parentCategoryId: 'p2', budget: 50 },
];

const EXPENSES = [
  {
    id: 'e1',
    datePosted: '2026-10-20',
    description: 'Greenleaf Market',
    amount: '82.10',
    currency: 'USD',
    category: 'Groceries',
    account: 'Card',
    isGift: false,
  },
  {
    id: 'e2',
    datePosted: '2026-10-12T00:00:00.000Z',
    description: 'Bean There Cafe',
    amount: 4.5,
    currency: 'CAD',
    category: 'Coffee Shops',
    account: 'Cash',
    isGift: true,
  },
  {
    id: 'e3',
    datePosted: '2026-10-03',
    description: 'Greenleaf Market',
    amount: '30',
    currency: 'USD',
    category: 'Groceries',
    account: 'Card',
  },
];

describe('tools', () => {
  it('lists six tools, all read-only except add_expense', async () => {
    const client = await connect(fakeFetch({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_expense',
      'list_categories',
      'list_expenses',
      'list_recurring',
      'monthly_summary',
      'spending_report',
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(tool.name !== 'add_expense');
      expect(tool.description?.length).toBeGreaterThan(40);
    }
  });

  it('list_categories gives subcategories with their group and budget', async () => {
    const client = await connect(fakeFetch({ 'GET /categories': () => CATEGORIES }));
    expect(await call(client, 'list_categories')).toEqual({
      categories: [
        { name: 'Groceries', group: 'Food & Dining', monthlyBudget: 400 },
        { name: 'Coffee Shops', group: 'Food & Dining', monthlyBudget: null },
        { name: 'Hobbies', group: 'Fun', monthlyBudget: 50 },
      ],
    });
  });

  describe('monthly_summary', () => {
    const totals = [
      ...Array.from({ length: 14 }, (_, i) => ({
        type: 'expense',
        yearMonth: `2025-${i + 1}`.replace(/^2025-(1[3-4])$/, (_m, n) => `2026-${n - 12}`),
        amountCad: '10.00',
        amountUsd: String(i),
      })),
      { type: 'income', yearMonth: '2026-02', amountCad: '0', amountUsd: '3000.5' },
    ];
    const fetchFn = () => fakeFetch({ 'GET /monthlyData': () => totals });

    it('defaults to the last 12 months with data, padded and in order', async () => {
      const { months } = await call(await connect(fetchFn()), 'monthly_summary');
      expect(months).toHaveLength(12);
      expect(months[0]).toEqual({ month: '2025-03', spent: { CAD: 10, USD: 2 } });
      expect(months.at(-1)).toEqual({ month: '2026-02', spent: { CAD: 10, USD: 13 } });
    });

    it('takes a range and can add income', async () => {
      const { months } = await call(await connect(fetchFn()), 'monthly_summary', {
        from: '2026-01',
        to: '2026-02',
        include_income: true,
      });
      expect(months).toEqual([
        { month: '2026-01', spent: { CAD: 10, USD: 12 }, income: { CAD: 0, USD: 0 } },
        { month: '2026-02', spent: { CAD: 10, USD: 13 }, income: { CAD: 0, USD: 3000.5 } },
      ]);
    });

    it('rejects a malformed month before calling the API', async () => {
      const fetchMock = fetchFn();
      const result = await call(await connect(fetchMock), 'monthly_summary', { from: '2026-13' });
      expect(result.error).toMatch(/YYYY-MM/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('spending_report', () => {
    const report = {
      yearMonth: '2026-10',
      dataByCategory: [
        {
          category: 'Groceries',
          // The API adds currencies together here; the tool must not.
          total: 116.6,
          details: [
            { description: 'Greenleaf Market', amount: 82.1, currency: 'USD' },
            { description: 'Greenleaf Market', amount: 30, currency: 'USD' },
            { description: 'Corner Grocer', amount: 4.5, currency: 'CAD' },
          ],
        },
      ],
      totalSpentCad: 4.5,
      totalSpentUsd: 112.1,
    };
    const fetchFn = () => fakeFetch({ 'GET /reports/monthly': () => report });

    it('totals each category per currency and leaves items out by default', async () => {
      const fetchMock = fetchFn();
      const result = await call(await connect(fetchMock), 'spending_report', { month: '2026-10' });
      expect(result).toEqual({
        month: '2026-10',
        spent: { CAD: 4.5, USD: 112.1 },
        categories: [{ category: 'Groceries', spent: { CAD: 4.5, USD: 112.1 }, count: 3 }],
      });
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'http://api.test/reports/monthly?yearMonth=2026-10',
      );
    });

    it('lists the items when asked', async () => {
      const result = await call(await connect(fetchFn()), 'spending_report', {
        month: '2026-10',
        include_items: true,
      });
      expect(result.categories[0].items).toHaveLength(3);
      expect(result.categories[0].items[2]).toEqual({
        description: 'Corner Grocer',
        amount: 4.5,
        currency: 'CAD',
      });
    });
  });

  describe('list_expenses', () => {
    const fetchFn = () =>
      fakeFetch({
        'GET /expenses': (url) =>
          url.searchParams.get('search')
            ? { data: EXPENSES.filter((e) => e.description.includes('Greenleaf')) }
            : { data: EXPENSES },
      });

    it('needs a month or a search', async () => {
      expect((await call(await connect(fetchFn()), 'list_expenses')).error).toMatch(/month/);
    });

    it('lists a month, newest first as the API sends, with dates trimmed', async () => {
      const result = await call(await connect(fetchFn()), 'list_expenses', { month: '2026-10' });
      expect(result.total_found).toBe(3);
      expect(result.expenses[1]).toEqual({
        date: '2026-10-12',
        description: 'Bean There Cafe',
        amount: 4.5,
        currency: 'CAD',
        category: 'Coffee Shops',
        account: 'Cash',
        gift: true,
      });
    });

    it('finds Amazon items, saved under product names, by their merchant', async () => {
      const lamp = {
        ...EXPENSES[0],
        id: 'e-lamp',
        description: 'Test Desk Lamp',
        merchant: 'Amazon',
        category: 'Home',
      };
      const client = await connect(
        fakeFetch({ 'GET /expenses': () => ({ data: [...EXPENSES, lamp] }) }),
      );
      const result = await call(client, 'list_expenses', { month: '2026-10', search: 'amazon' });
      expect(result.expenses).toEqual([
        expect.objectContaining({ description: 'Test Desk Lamp', merchant: 'Amazon' }),
      ]);
    });

    it('narrows by search inside a month, by category, and by limit', async () => {
      const client = await connect(fetchFn());
      const searched = await call(client, 'list_expenses', { month: '2026-10', search: 'cafe' });
      expect(searched.expenses.map((e: { description: string }) => e.description)).toEqual([
        'Bean There Cafe',
      ]);
      const byCategory = await call(client, 'list_expenses', {
        search: 'Greenleaf',
        category: 'groceries',
        limit: 1,
      });
      expect(byCategory.total_found).toBe(2);
      expect(byCategory.expenses).toHaveLength(1);
    });
  });

  it('list_recurring totals each currency separately', async () => {
    const client = await connect(
      fakeFetch({
        'GET /recurringExpenses': () => [
          {
            description: 'Phone plan',
            category: 'Phone Bills',
            amount: '45.00',
            account: 'Card',
            dayOfMonth: 5,
            currency: 'CAD',
          },
          {
            description: 'Music app',
            category: 'Subscriptions',
            amount: '10.99',
            account: 'Card',
            dayOfMonth: 12,
            currency: 'USD',
          },
          {
            description: 'Cloud storage',
            category: 'Subscriptions',
            amount: '2.99',
            account: 'Card',
            dayOfMonth: 20,
            currency: 'USD',
          },
        ],
        'GET /recurringIncome': () => [
          { description: 'Salary', category: 'bankAccounts', amount: '5000', currency: 'USD' },
        ],
      }),
    );
    const result = await call(client, 'list_recurring');
    expect(result.expensesPerMonth).toEqual({ CAD: 45, USD: 13.98 });
    expect(result.incomePerMonth).toEqual({ CAD: 0, USD: 5000 });
    expect(result.expenses[0]).toMatchObject({ description: 'Phone plan', dayOfMonth: 5 });
  });
});

describe('add_expense', () => {
  const VALID = {
    date: '2026-11-16',
    amount: 12.4,
    currency: 'USD',
    category: 'coffee shops',
    description: 'Latte',
    account: 'Card',
  };
  const fetchFn = () =>
    fakeFetch({
      'GET /categories': () => CATEGORIES,
      'POST /expenses': (_url, init) => {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ...body, amount: Number(body.amount) }), {
          status: 201,
        });
      },
    });

  it('saves with the exact category name and a fresh id', async () => {
    const fetchMock = fetchFn();
    const result = await call(await connect(fetchMock), 'add_expense', VALID);
    expect(result.added).toMatchObject({
      date: '2026-11-16',
      amount: 12.4,
      currency: 'USD',
      category: 'Coffee Shops',
      description: 'Latte',
      account: 'Card',
    });
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    const sent = JSON.parse(String(init!.body));
    expect(sent).toMatchObject({
      amount: '12.40',
      datePosted: '2026-11-16',
      category: 'Coffee Shops',
    });
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['an impossible date', { date: '2026-02-30' }, /real date/],
    ['a date in another format', { date: '11/16/2026' }, /YYYY-MM-DD/],
    ['a negative amount', { amount: -5 }, /more than 0/],
    ['a zero amount', { amount: 0 }, /more than 0/],
    ['fractions of a cent', { amount: 1.234 }, /two decimals/],
    ['a huge amount', { amount: 250_000 }, /100,000/],
    ['another currency', { currency: 'EUR' }, /CAD|USD/],
    ['an empty description', { description: '   ' }, /description|at least/i],
  ])('rejects %s without calling the API', async (_name, change, message) => {
    const fetchMock = fetchFn();
    const result = await call(await connect(fetchMock), 'add_expense', { ...VALID, ...change });
    expect(result.error).toMatch(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a category the user does not have, and a parent group, without saving', async () => {
    const fetchMock = fetchFn();
    const client = await connect(fetchMock);
    for (const category of ['Yachts', 'Food & Dining']) {
      const result = await call(client, 'add_expense', { ...VALID, category });
      expect(result.error).toMatch(/list_categories/);
    }
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

describe('API failures', () => {
  it('says the API is unreachable, without details', async () => {
    const client = await connect((async () =>
      Promise.reject(new TypeError('fetch failed'))) as typeof fetch);
    expect((await call(client, 'list_categories')).error).toMatch(/Could not reach .*api\.test/);
  });

  it('points at the token on 401, and passes on a 400 message only', async () => {
    const client = await connect(
      fakeFetch({
        'GET /categories': () => new Response('{}', { status: 401 }),
        'GET /reports/monthly': () =>
          new Response(JSON.stringify({ error: 'yearMonth must look like 2026-10' }), {
            status: 400,
          }),
        'GET /monthlyData': () =>
          new Response(JSON.stringify({ error: 'secret detail', stack: 'at db.ts' }), {
            status: 500,
          }),
      }),
    );
    expect((await call(client, 'list_categories')).error).toMatch(/EXPENSE_TRACKER_TOKEN/);
    expect((await call(client, 'spending_report', { month: '2026-10' })).error).toMatch(
      /400: yearMonth must look like 2026-10/,
    );
    const failed = (await call(client, 'monthly_summary')).error;
    expect(failed).toBe('The Expense Tracker API answered 500.');
  });

  it('sends the token when one is set, and none otherwise', async () => {
    const withToken = fakeFetch({ 'GET /categories': () => [] });
    await call(await connect(withToken, { token: 'tok-123' }), 'list_categories');
    expect(withToken.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer tok-123' });

    const without = fakeFetch({ 'GET /categories': () => [] });
    await call(await connect(without), 'list_categories');
    expect(without.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });
});

describe('readConfig', () => {
  it('defaults to a local API and reads the token', () => {
    expect(readConfig({})).toEqual({ apiUrl: 'http://localhost:3000', timeoutMs: 10_000 });
    expect(
      readConfig({
        EXPENSE_TRACKER_API_URL: 'https://api.example.com/',
        EXPENSE_TRACKER_TOKEN: ' t ',
      }),
    ).toMatchObject({ apiUrl: 'https://api.example.com', token: 't' });
    expect(() => readConfig({ EXPENSE_TRACKER_API_URL: 'api.example.com' })).toThrow(/http/);
  });
});
