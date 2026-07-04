import pg from "pg";
import { limits } from "../config.js";
import type { Connection } from "../connections.js";
import { capResult, type ResultSet } from "../format.js";
import {
  type Adapter,
  type ExecResult,
  type ForeignKey,
  type IndexInfo,
  type TableDesc,
  type TableRef,
} from "../adapter.js";

const { Pool } = pg;

export async function createPostgres(conn: Connection): Promise<PostgresAdapter> {
  const pool = new Pool({ connectionString: conn.url, max: 4 });
  return new PostgresAdapter(pool);
}

export class PostgresAdapter implements Adapter {
  constructor(private readonly pool: pg.Pool) {}

  private async readQuery(sql: string, params: unknown[]): Promise<{ columns: string[]; rows: unknown[][] }> {
    const { statementTimeoutMs } = limits();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${Number(statementTimeoutMs)}`);
      const res = await client.query({ text: sql, values: params, rowMode: "array" });
      return { columns: res.fields.map((f) => f.name), rows: res.rows as unknown[][] };
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }

  async listSchemas(): Promise<string[]> {
    const { rows } = await this.readQuery(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY 1",
      [],
    );
    return rows.map((r) => String(r[0]));
  }

  async listTables(schema = "public"): Promise<TableRef[]> {
    const { rows } = await this.readQuery(
      "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [schema],
    );
    return rows.map((r) => ({ schema, name: String(r[0]), kind: String(r[1]).includes("VIEW") ? "view" : "table" }));
  }

  async describeTable(schema = "public", table?: string): Promise<TableDesc> {
    const cols = await this.readQuery(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
      [schema, table],
    );
    const pk = await this.readQuery(
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
       WHERE i.indrelid = ($1||'.'||$2)::regclass AND i.indisprimary`,
      [schema, table],
    );
    return {
      schema,
      name: table ?? "",
      columns: cols.rows.map((r) => ({ name: String(r[0]), type: String(r[1]), nullable: r[2] === "YES", default: r[3] == null ? null : String(r[3]) })),
      primaryKey: pk.rows.map((r) => String(r[0])),
      foreignKeys: await this.fkeys(schema, table ?? ""),
      indexes: await this.listIndexes(schema, table ?? ""),
    };
  }

  private async fkeys(schema: string, table: string): Promise<ForeignKey[]> {
    const { rows } = await this.readQuery(
      `SELECT kcu.column_name, ccu.table_name, ccu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
       WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=$1 AND tc.table_name=$2`,
      [schema, table],
    );
    return rows.map((r) => ({ fromTable: table, fromColumn: String(r[0]), toTable: String(r[1]), toColumn: String(r[2]) }));
  }

  async listIndexes(schema = "public", table?: string): Promise<IndexInfo[]> {
    const { rows } = await this.readQuery(
      `SELECT i.relname, a.attname, ix.indisunique
       FROM pg_class t JOIN pg_index ix ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid
       JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(ix.indkey)
       JOIN pg_namespace n ON n.oid=t.relnamespace
       WHERE t.relname=$2 AND n.nspname=$1 ORDER BY i.relname`,
      [schema, table],
    );
    const map = new Map<string, IndexInfo>();
    for (const r of rows) {
      const name = String(r[0]);
      const e = map.get(name) ?? { name, columns: [], unique: Boolean(r[2]) };
      e.columns.push(String(r[1]));
      map.set(name, e);
    }
    return [...map.values()];
  }

  async relationships(schema = "public"): Promise<ForeignKey[]> {
    const tables = await this.listTables(schema);
    const out: ForeignKey[] = [];
    for (const t of tables.filter((x) => x.kind === "table")) out.push(...(await this.fkeys(schema, t.name)));
    return out;
  }

  async query(sql: string, params: unknown[], opts: { maxRows: number; maxCellBytes: number }): Promise<ResultSet> {
    // node-postgres buffers every row, so bound the fetch in SQL: wrap the
    // (already read-only-guarded) user query as a subquery capped at maxRows + 1
    // (the extra row lets capResult flag truncation). Only applied to `query`.
    const inner = sql.replace(/[\s;]+$/, "");
    const wrapped = `SELECT * FROM ( ${inner} ) AS _mcp_q LIMIT ${opts.maxRows + 1}`;
    const { columns, rows } = await this.readQuery(wrapped, params);
    return capResult(columns, rows, opts);
  }

  async explain(sql: string, params: unknown[]): Promise<ResultSet> {
    const { maxRows, maxCellBytes } = limits();
    const { columns, rows } = await this.readQuery(`EXPLAIN ${sql}`, params);
    return capResult(columns, rows, { maxRows, maxCellBytes });
  }

  async sample(schema = "public", table?: string, limit = 20): Promise<ResultSet> {
    const { maxRows, maxCellBytes } = limits();
    const ident = `"${schema.replace(/"/g, '""')}"."${String(table).replace(/"/g, '""')}"`;
    // Already bounded by its own LIMIT — run directly (no query() subquery wrap).
    const { columns, rows } = await this.readQuery(`SELECT * FROM ${ident} LIMIT ${Math.min(limit, maxRows)}`, []);
    return capResult(columns, rows, { maxRows, maxCellBytes });
  }

  async execute(sql: string, params: unknown[]): Promise<ExecResult> {
    const { statementTimeoutMs } = limits();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${Number(statementTimeoutMs)}`);
      const res = await client.query({ text: sql, values: params });
      await client.query("COMMIT");
      return { rowsAffected: res.rowCount ?? 0 };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async executeScript(statements: string[]): Promise<ExecResult[]> {
    const { statementTimeoutMs } = limits();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${Number(statementTimeoutMs)}`);
      const out: ExecResult[] = [];
      for (const s of statements) {
        const res = await client.query(s);
        out.push({ rowsAffected: res.rowCount ?? 0 });
      }
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
