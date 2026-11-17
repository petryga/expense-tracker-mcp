# Expense Tracker MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI client (Claude Code, Claude Desktop, or any MCP client) answer questions about your spending, and add expenses, through the Expense Tracker's existing REST API.

A side project: a small server over my own API. It doesn't change the backend; it calls the same endpoints the web app uses.

## Tools

| Tool              | What it does                                                                  | API                                              |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `list_categories` | Your categories, each with its group and monthly budget                       | `GET /categories`                                |
| `monthly_summary` | Spent (and optionally income) per month, in CAD and USD separately            | `GET /monthlyData`                               |
| `spending_report` | One month by category, biggest first; expense lines only if asked             | `GET /reports/monthly`                           |
| `list_expenses`   | Individual expenses for a month and/or a text search, optionally one category | `GET /expenses`                                  |
| `list_recurring`  | Recurring expenses and income, with monthly totals                            | `GET /recurringExpenses`, `GET /recurringIncome` |
| `add_expense`     | **Writes:** adds one expense, after validating every field                    | `POST /expenses`                                 |

Five tools are read-only and marked so (`readOnlyHint`). `add_expense` is the only write: it can't change or delete anything, its description tells the agent to confirm with you first, and it checks every field before calling the API: a real date, an amount above 0 with at most two decimals, CAD or USD, and a category you already have.

## Design choices

- **Summaries first.** Everything a tool returns is sent to the model, so the report tools return totals by default and list individual expenses only when asked (`include_items`, `list_expenses`).
- **Currencies are never added together.** Every total comes back as `{ CAD, USD }`. The backend's monthly report adds both into one per-category number; this server totals each currency from the expense lines instead.
- **Inputs are validated with zod** before any request, so a malformed month or amount never reaches the API, and the agent gets a message saying what to fix.
- **Errors are short and safe.** An unreachable API, a refused token or a validation message from the API comes back as a tool error the agent can act on. Stack traces and response bodies are never passed through.
- **stdio transport.** The client starts the server as a local process. stdout carries only protocol messages, and diagnostics go to stderr.

## Used by the in-app assistant

The Expense Tracker's chat page ("Ask") runs on this server too: the AI service (`AI/`, Python) starts it over stdio for each question and drives it as an MCP client, offering the model only the read-only tools. So the same tools serve Claude Code, Claude Desktop and the app's own agent.

## Setup

Requires Node 22+ and a running Expense Tracker backend.

```bash
npm install
npm run build
```

| Variable                     | Default                 |                                                                                       |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `EXPENSE_TRACKER_API_URL`    | `http://localhost:3000` | The backend's URL                                                                     |
| `EXPENSE_TRACKER_TOKEN`      | (none)                  | A Supabase access token for the account; not needed for a local backend with auth off |
| `EXPENSE_TRACKER_TIMEOUT_MS` | `10000`                 | Per request                                                                           |

### Claude Code

```bash
claude mcp add expense-tracker -e EXPENSE_TRACKER_API_URL=http://localhost:3000 -- node /path/to/MCP/dist/index.js
```

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "expense-tracker": {
      "command": "node",
      "args": ["/path/to/MCP/dist/index.js"],
      "env": { "EXPENSE_TRACKER_API_URL": "http://localhost:3000" }
    }
  }
}
```

To try it without your own data, sign in to the app's demo account and use that session's access token with the deployed API.

## Example

On invented data, through Claude Code (Claude Haiku 5.5):

> **Q:** How did my coffee spending change from September to October 2026, and what was my biggest category in October?
>
> The agent called `list_categories`, then `spending_report` for each month.
>
> **A:** Coffee Shops went from US$5.75 in September (1 purchase) to US$14.65 in October (3 purchases), up US$8.90. Your biggest category in October was Groceries, at US$129.45. Home was your only CAD spending (CA$38); the tools don't convert between currencies, so I can't say whether that would outrank Groceries in one currency.

## Development

```bash
npm test           # vitest: every tool through a real MCP client, API faked at fetch
npm run lint       # eslint, no warnings allowed
npm run typecheck
npm run dev        # run from source with tsx
```

Tests connect a real MCP `Client` to the server in memory (`InMemoryTransport`) and fake only the HTTP API, so they cover tool registration, input validation, output shape and error handling together. All test data is invented.

## Limits

- One user per server process, chosen by the token.
- No currency conversion: CAD and USD stay separate.
- `add_expense` adds; editing and deleting stay in the app.
- stdio only; no remote HTTP transport yet.

## License

All rights reserved. Published for portfolio review; not licensed for reuse.
