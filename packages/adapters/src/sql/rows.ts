export type SqlValue = string | number | bigint | null;
export type Row = Record<string, unknown>;
export type Dialect = "sqlite" | "postgres";

export interface SqlRows {
  readonly dialect: Dialect;
  exec(ddl: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<number>;
  get(sql: string, params?: readonly SqlValue[]): Promise<Row | undefined>;
  all(sql: string, params?: readonly SqlValue[]): Promise<readonly Row[]>;
  jsonText(column: string, field: string): string;
}
