import { DatabaseSync } from "node:sqlite";
import type { Row, SqlRows, SqlValue } from "../sql/rows.ts";

const BUSY_TIMEOUT_MS = 5_000;

export class SqliteRows implements SqlRows {
  readonly dialect = "sqlite" as const;
  readonly #db: DatabaseSync;

  constructor(path: string, options: { readonly readOnly?: boolean } = {}) {
    this.#db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
    if (!options.readOnly) this.#db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  }

  async exec(ddl: string): Promise<void> {
    this.#db.exec(ddl);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    return Number(this.#db.prepare(sql).run(...params).changes);
  }

  async get(sql: string, params: readonly SqlValue[] = []): Promise<Row | undefined> {
    return this.#db.prepare(sql).get(...params);
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<readonly Row[]> {
    return this.#db.prepare(sql).all(...params);
  }

  jsonText(column: string, field: string): string {
    return `json_extract(${column}, '$.${field}')`;
  }

  close(): void {
    this.#db.close();
  }
}
