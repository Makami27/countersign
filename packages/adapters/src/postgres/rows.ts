import type pg from "pg";
import type { Row, SqlRows, SqlValue } from "../sql/rows.ts";
import { query } from "./pool.ts";

function numbered(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function values(params: readonly SqlValue[]): unknown[] {
  return params.map((p) => (typeof p === "bigint" ? p.toString() : p));
}

export class PostgresRows implements SqlRows {
  readonly dialect = "postgres" as const;
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async exec(ddl: string): Promise<void> {
    await query(this.#pool, ddl);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    return (await query(this.#pool, numbered(sql), values(params))).rowCount ?? 0;
  }

  async get(sql: string, params: readonly SqlValue[] = []): Promise<Row | undefined> {
    return (await query<Row>(this.#pool, numbered(sql), values(params))).rows[0];
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<readonly Row[]> {
    return (await query<Row>(this.#pool, numbered(sql), values(params))).rows;
  }

  jsonText(column: string, field: string): string {
    return `(${column}::jsonb ->> '${field}')`;
  }
}
