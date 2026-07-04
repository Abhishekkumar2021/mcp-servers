import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
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
  SqliteTooLarge,
} from "../adapter.js";

const require = createRequire(import.meta.url);
let sqlJs: SqlJsStatic | null = null;

/** Init the WASM runtime once (locate the .wasm inside the installed package). */
async function getSqlJs(): Promise<SqlJsStatic> {
  if (sqlJs) return sqlJs;
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  sqlJs = await initSqlJs({ locateFile: () => wasmPath });
  return sqlJs;
}

/** Path portion after the sqlite:/file: scheme. */
function filePath(url: string): string {
  return url.replace(/^(sqlite:|file:)\/?\/?/i, "/").replace(/^\/+/, "/");
}

export async function createSqlite(conn: Connection): Promise<SqliteAdapter> {
  const path = filePath(conn.url);
  const { size } = await fs.stat(path);
  const { sqliteMaxBytes } = limits();
  if (size > sqliteMaxBytes) throw new SqliteTooLarge(size, sqliteMaxBytes);
  return new SqliteAdapter(path);
}

export class SqliteAdapter implements Adapter {
  constructor(private readonly path: string) {}

  /** Fresh in-memory DB from the file (sql.js loads whole file anyway). */
  private async open(): Promise<Database> {
    const SQL = await getSqlJs();
    const buf = await fs.readFile(this.path);
    return new SQL.Database(buf);
  }

  private run(db: Database, sql: string, params: unknown[]): { columns: string[]; rows: unknown[][] } {
    const stmt = db.prepare(sql);
    try {
      if (params.length) stmt.bind(params as never[]);
      const columns = stmt.getColumnNames();
      const rows: unknown[][] = [];
      while (stmt.step()) rows.push(stmt.get() as unknown[]);
      return { columns, rows };
    } finally {
      stmt.free();
    }
  }

  async listSchemas(): Promise<string[]> {
    return ["main"];
  }

  async listTables(): Promise<TableRef[]> {
    const db = await this.open();
    try {
      const { rows } = this.run(
        db,
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        [],
      );
      return rows.map((r) => ({ name: String(r[0]), kind: r[1] === "view" ? "view" : "table" }));
    } finally {
      db.close();
    }
  }

  async describeTable(_schema: string | undefined, table: string): Promise<TableDesc> {
    const db = await this.open();
    try {
      const info = this.run(db, `PRAGMA table_info(${quoteIdent(table)})`, []);
      const columns = info.rows.map((r) => ({
        name: String(r[1]),
        type: String(r[2] ?? ""),
        nullable: Number(r[3]) === 0,
        default: r[4] == null ? null : String(r[4]),
      }));
      const primaryKey = info.rows.filter((r) => Number(r[5]) > 0).map((r) => String(r[1]));
      return {
        name: table,
        columns,
        primaryKey,
        foreignKeys: await this.fkeys(db, table),
        indexes: await this.idx(db, table),
      };
    } finally {
      db.close();
    }
  }

  private fkeys(db: Database, table: string): ForeignKey[] {
    const { rows } = this.run(db, `PRAGMA foreign_key_list(${quoteIdent(table)})`, []);
    return rows.map((r) => ({ fromTable: table, fromColumn: String(r[3]), toTable: String(r[2]), toColumn: String(r[4]) }));
  }

  private idx(db: Database, table: string): IndexInfo[] {
    const list = this.run(db, `PRAGMA index_list(${quoteIdent(table)})`, []);
    return list.rows.map((r) => {
      const idxName = String(r[1]);
      const cols = this.run(db, `PRAGMA index_info(${quoteIdent(idxName)})`, []);
      return { name: idxName, columns: cols.rows.map((c) => String(c[2])), unique: Number(r[2]) === 1 };
    });
  }

  async listIndexes(_schema: string | undefined, table: string): Promise<IndexInfo[]> {
    const db = await this.open();
    try {
      return this.idx(db, table);
    } finally {
      db.close();
    }
  }

  async relationships(): Promise<ForeignKey[]> {
    const db = await this.open();
    try {
      const tables = this.run(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", []);
      const out: ForeignKey[] = [];
      for (const t of tables.rows) out.push(...this.fkeys(db, String(t[0])));
      return out;
    } finally {
      db.close();
    }
  }

  async query(sql: string, params: unknown[], opts: { maxRows: number; maxCellBytes: number }): Promise<ResultSet> {
    const db = await this.open();
    try {
      db.run("PRAGMA query_only = ON");
      const { columns, rows } = this.run(db, sql, params);
      return capResult(columns, rows, opts);
    } finally {
      db.close();
    }
  }

  async explain(sql: string, params: unknown[]): Promise<ResultSet> {
    const { maxRows, maxCellBytes } = limits();
    return this.query(`EXPLAIN QUERY PLAN ${sql}`, params, { maxRows, maxCellBytes });
  }

  async sample(_schema: string | undefined, table: string, limit: number): Promise<ResultSet> {
    const { maxRows, maxCellBytes } = limits();
    return this.query(`SELECT * FROM ${quoteIdent(table)} LIMIT ?`, [Math.min(limit, maxRows)], { maxRows, maxCellBytes });
  }

  async execute(sql: string, params: unknown[]): Promise<ExecResult> {
    const results = await this.executeScript(params.length ? [sql] : splitOrSingle(sql), params);
    return results[results.length - 1];
  }

  async executeScript(statements: string[], params: unknown[] = []): Promise<ExecResult[]> {
    const db = await this.open();
    try {
      db.run("PRAGMA query_only = OFF");
      db.run("BEGIN");
      const out: ExecResult[] = [];
      try {
        for (const s of statements) {
          const stmt = db.prepare(s);
          try {
            if (params.length) stmt.bind(params as never[]);
            stmt.step();
          } finally {
            stmt.free();
          }
          out.push({ rowsAffected: db.getRowsModified() });
        }
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
      await persist(this.path, db);
      return out;
    } finally {
      db.close();
    }
  }

  async close(): Promise<void> {
    /* nothing cached open */
  }
}

function splitOrSingle(sql: string): string[] {
  return [sql];
}

async function persist(path: string, db: Database): Promise<void> {
  const data = Buffer.from(db.export());
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path);
}

/** Minimal identifier quoting for PRAGMA/table refs (double-quote, escape quotes). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
