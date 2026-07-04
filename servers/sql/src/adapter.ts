import type { Connection } from "./connections.js";
import type { ResultSet } from "./format.js";

export interface TableRef { schema?: string; name: string; kind: "table" | "view" }
export interface Column { name: string; type: string; nullable: boolean; default: string | null }
export interface ForeignKey { fromTable: string; fromColumn: string; toTable: string; toColumn: string }
export interface IndexInfo { name: string; columns: string[]; unique: boolean }
export interface TableDesc {
  schema?: string;
  name: string;
  columns: Column[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  indexes: IndexInfo[];
}
export interface ExecResult { rowsAffected: number }

export interface Adapter {
  listSchemas(): Promise<string[]>;
  listTables(schema?: string): Promise<TableRef[]>;
  describeTable(schema: string | undefined, table: string): Promise<TableDesc>;
  listIndexes(schema: string | undefined, table: string): Promise<IndexInfo[]>;
  relationships(schema?: string): Promise<ForeignKey[]>;
  query(sql: string, params: unknown[], opts: { maxRows: number; maxCellBytes: number }): Promise<ResultSet>;
  explain(sql: string, params: unknown[]): Promise<ResultSet>;
  sample(schema: string | undefined, table: string, limit: number): Promise<ResultSet>;
  execute(sql: string, params: unknown[]): Promise<ExecResult>;
  executeScript(statements: string[]): Promise<ExecResult[]>;
  close(): Promise<void>;
}

export class NotWritable extends Error {
  constructor() {
    super("write refused: server is read-only (set DB_WRITABLE=1 to enable)");
    this.name = "NotWritable";
  }
}
export class SqliteTooLarge extends Error {
  constructor(bytes: number, max: number) {
    super(`SQLite file is ${bytes} bytes, over the DB_SQLITE_MAX_BYTES limit of ${max}`);
    this.name = "SqliteTooLarge";
  }
}

const cache = new Map<string, Adapter>();

export async function getAdapter(conn: Connection): Promise<Adapter> {
  const existing = cache.get(conn.name);
  if (existing) return existing;
  let adapter: Adapter;
  if (conn.type === "sqlite") {
    const { createSqlite } = await import("./adapters/sqlite.js");
    adapter = await createSqlite(conn);
  } else {
    // Non-literal specifier: postgres adapter is added in a later task; defer
    // module resolution to runtime so tsc doesn't require the file to exist yet.
    const pgModule = "./adapters/postgres.js";
    const { createPostgres } = await import(pgModule);
    adapter = await createPostgres(conn);
  }
  cache.set(conn.name, adapter);
  return adapter;
}
