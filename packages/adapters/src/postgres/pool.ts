import pg from "pg";

const CONNECT_TIMEOUT_MS = 10_000;
const CONNECT_ATTEMPTS = 2;
const QUERY_TIMEOUT_MS = 15_000;
const STATEMENT_TIMEOUT_MS = 12_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_CONNECTIONS = 5;
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const CONNECT_FAILURE = /timeout exceeded when trying to connect|connection timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|Connection terminated unexpectedly/i;

export type PostgresOptions = { readonly url: string; readonly schema?: string };
export type Connectable = { connect(): Promise<pg.PoolClient> };

export function directNeonUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.replace(/-pooler(?=\.)/, "");
  if (["prefer", "require", "verify-ca"].includes(parsed.searchParams.get("sslmode") ?? "")) parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}

export function openPostgres(options: PostgresOptions): pg.Pool {
  if (options.schema !== undefined && !SCHEMA_NAME.test(options.schema)) throw new Error("Postgres schema names use lowercase letters, digits and underscores.");
  const pool = new pg.Pool({
    connectionString: directNeonUrl(options.url),
    max: MAX_CONNECTIONS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    ...(options.schema === undefined ? {} : { options: `-c search_path=${options.schema}` }),
  });
  pool.on("error", (error: Error & { code?: string }) => {
    console.error(`postgres: idle connection dropped (${error.code ?? "no code"})`);
  });
  return pool;
}

export function isConnectFailure(error: unknown): boolean {
  return error instanceof Error && (CONNECT_FAILURE.test(error.message) || CONNECT_FAILURE.test(String((error as Error & { code?: unknown }).code ?? "")));
}

export async function connect(pool: Connectable): Promise<pg.PoolClient> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pool.connect();
    } catch (error) {
      if (attempt >= CONNECT_ATTEMPTS || !isConnectFailure(error)) throw error;
    }
  }
}

export async function query<R extends pg.QueryResultRow = Record<string, unknown>>(pool: Connectable, sql: string, params?: readonly unknown[]): Promise<pg.QueryResult<R>> {
  const client = await connect(pool);
  let broken: Error | undefined;
  try {
    return await client.query<R>(sql, params === undefined ? undefined : [...params]);
  } catch (error) {
    if (isConnectFailure(error)) broken = error as Error;
    throw error;
  } finally {
    client.release(broken);
  }
}

export async function inTransaction<T>(pool: Connectable, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await connect(pool);
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (isConnectFailure(error)) broken = error as Error;
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(broken);
  }
}
