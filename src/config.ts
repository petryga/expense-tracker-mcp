// Settings come from the environment, set where the MCP client starts this
// server (see README).
export interface Config {
  apiUrl: string;
  // A Supabase access token for the account to use. Not needed against a
  // local backend running with auth off.
  token?: string;
  timeoutMs: number;
}

export const readConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const apiUrl = (env.EXPENSE_TRACKER_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new Error('EXPENSE_TRACKER_API_URL must start with http:// or https://');
  }
  const token = env.EXPENSE_TRACKER_TOKEN?.trim() || undefined;
  return {
    apiUrl,
    token,
    timeoutMs: Number(env.EXPENSE_TRACKER_TIMEOUT_MS) || 10_000,
  };
};
