import type { Row, SqlRows, SqlValue } from "@countersign/adapters/sql";

export class CountingRows implements SqlRows {
  readonly #inner: SqlRows;
  queries = 0;

  constructor(inner: SqlRows) {
    this.#inner = inner;
  }

  get dialect() {
    return this.#inner.dialect;
  }

  exec(ddl: string): Promise<void> {
    this.queries += 1;
    return this.#inner.exec(ddl);
  }

  run(sql: string, params?: readonly SqlValue[]): Promise<number> {
    this.queries += 1;
    return this.#inner.run(sql, params);
  }

  get(sql: string, params?: readonly SqlValue[]): Promise<Row | undefined> {
    this.queries += 1;
    return this.#inner.get(sql, params);
  }

  all(sql: string, params?: readonly SqlValue[]): Promise<readonly Row[]> {
    this.queries += 1;
    return this.#inner.all(sql, params);
  }

  jsonText(column: string, field: string): string {
    return this.#inner.jsonText(column, field);
  }
}
