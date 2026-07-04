# sql server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@abhishekmcp/sql`, a read-first SQL MCP server over Postgres (`pg`) and SQLite (`sql.js`/WASM) with defense-in-depth read-only enforcement and a gated write mode.

**Architecture:** Layered like the other suite servers — a thin `index.ts` registers tools; all logic sits below it. Connections are parsed from `DB_CONN_*` env into a registry; each tool resolves a connection by name and dispatches through an `Adapter` interface with two implementations (Postgres, SQLite). Read-only is enforced both by a statement guard and at the engine level (PG read-only transaction; SQLite `PRAGMA query_only`).

**Tech Stack:** TypeScript (Node16 ESM, `.js` import extensions), `@modelcontextprotocol/sdk`, `zod`, `pg`, `sql.js` (WASM), `node:test`.

## Global Constraints

- Node `>=18`; module/moduleResolution `Node16`; `"type":"module"` — **relative imports carry `.js`**.
- **stdout is the MCP transport** — never `console.log`; log only to stderr (`console.error`).
- Prefer pure-JS/WASM (portability). No native deps in this server (`pg` is pure-JS; SQLite via `sql.js` WASM).
- Naming: npm `@abhishekmcp/sql`, binary `mcp-sql`, dir `servers/sql/`, tag `sql-v<semver>`, description starts "MCP server for …". `package.json` needs `publishConfig {access:"public", provenance:true}`, `repository.directory:"servers/sql"`, `mcpName:"io.github.Abhishekkumar2021/sql"`.
- Every tool: `title`, `description`, Zod `inputSchema`; destructive tools set `annotations:{destructiveHint:true}`.
- Secrets (connection URLs/credentials) must never appear in tool output or logs — run everything user-facing through `redact()`.
- Defaults: `DB_MAX_ROWS=1000`, `DB_MAX_CELL_BYTES=8192`, `DB_STATEMENT_TIMEOUT_MS=15000`, `DB_SQLITE_MAX_BYTES=536870912`.
- Tests are `node:test` `.test.mjs` files under `servers/sql/test/`, run by root `npm test --workspaces` after build.

---

### Task 1: Workspace scaffold + config

**Files:**
- Create: `servers/sql/package.json`, `servers/sql/tsconfig.json`, `servers/sql/src/config.ts`
- Test: `servers/sql/test/config.test.mjs`

**Interfaces:**
- Produces: `config.ts` exports `VERSION: string`; `isWritable(): boolean`; `limits(): { maxRows:number; maxCellBytes:number; statementTimeoutMs:number; sqliteMaxBytes:number }`; `getAuditLogPath(): string | undefined`.

- [ ] **Step 1: Create `servers/sql/package.json`**

```json
{
  "name": "@abhishekmcp/sql",
  "version": "0.1.0",
  "description": "MCP server for SQL databases — read-only querying and schema introspection over Postgres and SQLite, with a gated write mode, from any MCP client.",
  "mcpName": "io.github.Abhishekkumar2021/sql",
  "type": "module",
  "bin": { "mcp-sql": "dist/index.js" },
  "files": ["dist"],
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "start": "node dist/index.js",
    "dev": "tsc && node dist/index.js",
    "test": "npm run build && node --test test/*.test.mjs",
    "build:mcpb": "node scripts/build-mcpb.mjs",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["mcp", "modelcontextprotocol", "sql", "postgres", "sqlite", "claude"],
  "author": "Abhishek (https://github.com/Abhishekkumar2021)",
  "license": "MIT",
  "homepage": "https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/sql#readme",
  "repository": { "type": "git", "url": "git+https://github.com/Abhishekkumar2021/mcp-suite.git", "directory": "servers/sql" },
  "bugs": { "url": "https://github.com/Abhishekkumar2021/mcp-suite/issues" },
  "engines": { "node": ">=18" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "pg": "^8.13.0",
    "sql.js": "^1.14.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "@types/sql.js": "^1.4.9",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `servers/sql/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `servers/sql/src/config.ts`**

```ts
/** Env + limits in one place. Keep VERSION in lockstep with package.json. */
export const VERSION = "0.1.0";

/** Writes enabled only when DB_WRITABLE is 1/true. */
export function isWritable(): boolean {
  const v = process.env.DB_WRITABLE?.trim().toLowerCase();
  return v === "1" || v === "true";
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function limits() {
  return {
    maxRows: intEnv("DB_MAX_ROWS", 1000),
    maxCellBytes: intEnv("DB_MAX_CELL_BYTES", 8192),
    statementTimeoutMs: intEnv("DB_STATEMENT_TIMEOUT_MS", 15000),
    sqliteMaxBytes: intEnv("DB_SQLITE_MAX_BYTES", 536870912),
  };
}

/** Optional JSON-lines audit log path for executed statements. */
export function getAuditLogPath(): string | undefined {
  return process.env.SQL_AUDIT_LOG?.trim() || undefined;
}
```

- [ ] **Step 4: Register the workspace and build**

Run: `cd /Users/abhishek/Dev/mcp-suite && npm install && npm run build -w servers/sql`
Expected: install links the new workspace; `tsc` completes with no errors (dist/ created).

- [ ] **Step 5: Write the failing test `servers/sql/test/config.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { limits, isWritable } from "../dist/config.js";

test("limits use defaults when env unset", () => {
  delete process.env.DB_MAX_ROWS;
  const l = limits();
  assert.equal(l.maxRows, 1000);
  assert.equal(l.maxCellBytes, 8192);
  assert.equal(l.statementTimeoutMs, 15000);
  assert.equal(l.sqliteMaxBytes, 536870912);
});

test("limits read overrides from env", () => {
  process.env.DB_MAX_ROWS = "5";
  assert.equal(limits().maxRows, 5);
  delete process.env.DB_MAX_ROWS;
});

test("isWritable reflects DB_WRITABLE", () => {
  delete process.env.DB_WRITABLE;
  assert.equal(isWritable(), false);
  process.env.DB_WRITABLE = "true";
  assert.equal(isWritable(), true);
  delete process.env.DB_WRITABLE;
});
```

- [ ] **Step 6: Run tests**

Run: `npm test -w servers/sql`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add servers/sql/package.json servers/sql/tsconfig.json servers/sql/src/config.ts servers/sql/test/config.test.mjs package-lock.json
git commit -m "feat(sql): scaffold workspace + config"
```

---

### Task 2: Connection registry + redaction

**Files:**
- Create: `servers/sql/src/connections.ts`
- Test: `servers/sql/test/connections.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ConnType = "postgres" | "sqlite"`
  - `interface Connection { name: string; type: ConnType; url: string }`
  - `listConnections(): Connection[]` — parsed from `DB_CONN_*` env (sorted by name).
  - `getConnection(name: string): Connection` — throws `ConnectionNotFound` if absent.
  - `redact(s: string): string` — masks any `scheme://user:pass@host` credential and full connection URLs.
  - `class ConnectionNotFound extends Error`.

- [ ] **Step 1: Write the failing test `servers/sql/test/connections.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { listConnections, getConnection, redact, ConnectionNotFound } from "../dist/connections.js";

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(process.env)) if (k.startsWith("DB_CONN_")) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("parses postgres and sqlite connections by scheme", () => {
  withEnv({ DB_CONN_analytics: "postgres://u:p@host:5432/db", DB_CONN_local: "sqlite:/tmp/app.db" }, () => {
    const conns = listConnections();
    assert.equal(conns.length, 2);
    assert.deepEqual(conns.map((c) => c.name).sort(), ["analytics", "local"]);
    assert.equal(getConnection("analytics").type, "postgres");
    assert.equal(getConnection("local").type, "sqlite");
  });
});

test("getConnection throws ConnectionNotFound for unknown name", () => {
  withEnv({}, () => {
    assert.throws(() => getConnection("nope"), ConnectionNotFound);
  });
});

test("redact hides credentials", () => {
  const out = redact("connect postgres://user:secret@db:5432/x failed");
  assert.ok(!out.includes("secret"));
  assert.ok(out.includes("postgres://"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/sql`
Expected: FAIL — `Cannot find module '../dist/connections.js'`.

- [ ] **Step 3: Create `servers/sql/src/connections.ts`**

```ts
export type ConnType = "postgres" | "sqlite";
export interface Connection { name: string; type: ConnType; url: string }

export class ConnectionNotFound extends Error {
  constructor(name: string) {
    super(`connection '${name}' not found; configure DB_CONN_${name}=<url>`);
    this.name = "ConnectionNotFound";
  }
}

function typeFromUrl(url: string): ConnType {
  const scheme = url.slice(0, url.indexOf(":")).toLowerCase();
  if (scheme === "postgres" || scheme === "postgresql") return "postgres";
  if (scheme === "sqlite" || scheme === "file") return "sqlite";
  throw new Error(`unsupported connection scheme in '${scheme}://…' (use postgres:// or sqlite:)`);
}

export function listConnections(): Connection[] {
  const out: Connection[] = [];
  for (const [key, val] of Object.entries(process.env)) {
    if (!key.startsWith("DB_CONN_") || !val) continue;
    const name = key.slice("DB_CONN_".length);
    if (!name) continue;
    out.push({ name, type: typeFromUrl(val), url: val });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getConnection(name: string): Connection {
  const c = listConnections().find((x) => x.name === name);
  if (!c) throw new ConnectionNotFound(name);
  return c;
}

/** Mask credentials and full connection URLs in any user-facing string. */
export function redact(s: string): string {
  return s.replace(/([a-z]+:\/\/)([^\s/@]+)@/gi, "$1***@");
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/sql`
Expected: PASS (config + connections tests).

- [ ] **Step 5: Commit**

```bash
git add servers/sql/src/connections.ts servers/sql/test/connections.test.mjs
git commit -m "feat(sql): connection registry + redaction"
```

---

### Task 3: Statement guard

**Files:**
- Create: `servers/sql/src/guard.ts`
- Test: `servers/sql/test/guard.test.mjs`

**Interfaces:**
- Produces:
  - `class ReadOnlyViolation extends Error`
  - `assertReadOnly(sql: string): void` — throws `ReadOnlyViolation` unless `sql` is a single SELECT-family statement (leading `SELECT`/`WITH`/`VALUES`, comments stripped, no extra statements). Engine-level read-only is the authority; this is the friendly first line + multi-statement block.
  - `splitStatements(sql: string): string[]` — split a script into non-empty statements on top-level `;` (ignores `;` inside quotes/comments).

- [ ] **Step 1: Write the failing test `servers/sql/test/guard.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReadOnly, ReadOnlyViolation, splitStatements } from "../dist/guard.js";

test("allows SELECT / WITH / VALUES", () => {
  assertReadOnly("SELECT 1");
  assertReadOnly("  -- c\n WITH x AS (SELECT 1) SELECT * FROM x");
  assertReadOnly("VALUES (1),(2)");
});

test("rejects writes and DDL", () => {
  for (const sql of ["INSERT INTO t VALUES (1)", "update t set a=1", "DELETE FROM t", "DROP TABLE t", "CREATE TABLE t(a int)"]) {
    assert.throws(() => assertReadOnly(sql), ReadOnlyViolation, sql);
  }
});

test("rejects multiple statements for read", () => {
  assert.throws(() => assertReadOnly("SELECT 1; DROP TABLE t"), ReadOnlyViolation);
});

test("splitStatements ignores semicolons in strings", () => {
  const parts = splitStatements("INSERT INTO t VALUES (';'); SELECT 1;");
  assert.equal(parts.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/sql`
Expected: FAIL — `Cannot find module '../dist/guard.js'`.

- [ ] **Step 3: Create `servers/sql/src/guard.ts`**

```ts
export class ReadOnlyViolation extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ReadOnlyViolation";
  }
}

/** Strip `--` line comments and block comments, then trim. */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
}

/** Split into statements on top-level `;`, ignoring quotes and comments. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (ch === "/" && sql[i + 1] === "*") { i += 2; while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++; i++; continue; }
    if (ch === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const READ_LEADERS = /^(select|with|values)\b/i;

/** Throw unless `sql` is a single SELECT-family statement. */
export function assertReadOnly(sql: string): void {
  const stmts = splitStatements(sql);
  if (stmts.length > 1) {
    throw new ReadOnlyViolation("multiple statements are not allowed in a read-only query");
  }
  const body = stripComments(stmts[0] ?? "");
  if (!READ_LEADERS.test(body)) {
    throw new ReadOnlyViolation(
      "this is a read-only query tool; only SELECT/WITH/VALUES are allowed (set DB_WRITABLE=1 and use execute for writes)",
    );
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servers/sql/src/guard.ts servers/sql/test/guard.test.mjs
git commit -m "feat(sql): read-only statement guard"
```

---

### Task 4: Result formatting (caps)

**Files:**
- Create: `servers/sql/src/format.ts`
- Test: `servers/sql/test/format.test.mjs`

**Interfaces:**
- Produces:
  - `interface ResultSet { columns: string[]; rows: unknown[][]; rowCount: number; truncated: boolean; notice?: string }`
  - `capResult(columns: string[], rows: unknown[][], opts: { maxRows: number; maxCellBytes: number }): ResultSet` — trims rows to `maxRows` (sets `truncated`), truncates any string/Buffer cell longer than `maxCellBytes` (appends `"…[truncated]"`), leaves other scalars as-is.

- [ ] **Step 1: Write the failing test `servers/sql/test/format.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { capResult } from "../dist/format.js";

test("caps row count and flags truncation", () => {
  const rows = [[1], [2], [3]];
  const r = capResult(["n"], rows, { maxRows: 2, maxCellBytes: 100 });
  assert.equal(r.rows.length, 2);
  assert.equal(r.truncated, true);
  assert.match(r.notice ?? "", /2/);
});

test("truncates oversized string cells", () => {
  const big = "x".repeat(50);
  const r = capResult(["s"], [[big]], { maxRows: 10, maxCellBytes: 10 });
  assert.ok(String(r.rows[0][0]).length < 50);
  assert.match(String(r.rows[0][0]), /truncated/);
});

test("passes small values through unchanged", () => {
  const r = capResult(["a", "b"], [[1, "ok"]], { maxRows: 10, maxCellBytes: 100 });
  assert.deepEqual(r.rows, [[1, "ok"]]);
  assert.equal(r.truncated, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/sql`
Expected: FAIL — `Cannot find module '../dist/format.js'`.

- [ ] **Step 3: Create `servers/sql/src/format.ts`**

```ts
export interface ResultSet {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  notice?: string;
}

function capCell(v: unknown, maxCellBytes: number): unknown {
  if (typeof v === "string" && Buffer.byteLength(v, "utf8") > maxCellBytes) {
    return v.slice(0, maxCellBytes) + "…[truncated]";
  }
  if (Buffer.isBuffer(v)) {
    return `[${v.length} bytes]`;
  }
  return v;
}

export function capResult(
  columns: string[],
  rows: unknown[][],
  opts: { maxRows: number; maxCellBytes: number },
): ResultSet {
  const truncated = rows.length > opts.maxRows;
  const kept = truncated ? rows.slice(0, opts.maxRows) : rows;
  const capped = kept.map((row) => row.map((c) => capCell(c, opts.maxCellBytes)));
  return {
    columns,
    rows: capped,
    rowCount: capped.length,
    truncated,
    notice: truncated ? `result truncated to ${opts.maxRows} rows` : undefined,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servers/sql/src/format.ts servers/sql/test/format.test.mjs
git commit -m "feat(sql): result formatting + caps"
```

---

### Task 5: Adapter interface + SQLite adapter

**Files:**
- Create: `servers/sql/src/adapter.ts`, `servers/sql/src/adapters/sqlite.ts`
- Test: `servers/sql/test/sqlite.test.mjs`

**Interfaces:**
- Consumes: `Connection` (connections.ts), `ResultSet` (format.ts), `limits()` (config.ts).
- Produces (in `adapter.ts`):
  - Shared types: `TableRef { schema?: string; name: string; kind: "table" | "view" }`, `Column { name: string; type: string; nullable: boolean; default: string | null }`, `ForeignKey { fromTable: string; fromColumn: string; toTable: string; toColumn: string }`, `IndexInfo { name: string; columns: string[]; unique: boolean }`, `TableDesc { schema?: string; name: string; columns: Column[]; primaryKey: string[]; foreignKeys: ForeignKey[]; indexes: IndexInfo[] }`, `ExecResult { rowsAffected: number }`.
  - `interface Adapter { listSchemas(); listTables(schema?); describeTable(schema, table); listIndexes(schema, table); relationships(schema?); query(sql, params, opts); explain(sql, params); sample(schema, table, limit); execute(sql, params); executeScript(statements); close(); }` (return types per the spec).
  - `class NotWritable extends Error`, `class SqliteTooLarge extends Error`.
  - `getAdapter(conn: Connection): Promise<Adapter>` — caches one adapter per connection name; dispatches on `conn.type`.
- Produces (in `adapters/sqlite.ts`): `class SqliteAdapter implements Adapter` + `createSqlite(conn): Promise<SqliteAdapter>`.

- [ ] **Step 1: Write the failing test `servers/sql/test/sqlite.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { getAdapter } from "../dist/adapter.js";

async function makeDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE author (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE book (id INTEGER PRIMARY KEY, title TEXT, author_id INTEGER REFERENCES author(id));
    CREATE INDEX idx_book_author ON book(author_id);
    CREATE VIEW book_titles AS SELECT title FROM book;
    INSERT INTO author (id, name) VALUES (1, 'Ada');
    INSERT INTO book (id, title, author_id) VALUES (1, 'Notes', 1);
  `);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "sqlmcp-"));
  const file = path.join(dir, "app.db");
  await fsp.writeFile(file, Buffer.from(db.export()));
  db.close();
  return file;
}

test("sqlite: introspection + read query", async () => {
  const file = await makeDb();
  const a = await getAdapter({ name: "t", type: "sqlite", url: `sqlite:${file}` });
  const tables = await a.listTables();
  const names = tables.map((t) => t.name).sort();
  assert.ok(names.includes("author") && names.includes("book"));
  assert.ok(tables.find((t) => t.name === "book_titles").kind === "view");

  const desc = await a.describeTable(undefined, "book");
  assert.deepEqual(desc.primaryKey, ["id"]);
  assert.equal(desc.foreignKeys[0].toTable, "author");

  const res = await a.query("SELECT name FROM author WHERE id = ?", [1], { maxRows: 10, maxCellBytes: 100 });
  assert.deepEqual(res.rows, [["Ada"]]);
  await a.close();
});

test("sqlite: read query rejects writes at engine level", async () => {
  const file = await makeDb();
  const a = await getAdapter({ name: "t2", type: "sqlite", url: `sqlite:${file}` });
  await assert.rejects(a.query("DELETE FROM author", [], { maxRows: 10, maxCellBytes: 100 }));
  await a.close();
});

test("sqlite: execute persists when writable", async () => {
  const file = await makeDb();
  const a = await getAdapter({ name: "t3", type: "sqlite", url: `sqlite:${file}` });
  const r = await a.execute("INSERT INTO author (id, name) VALUES (2, 'Grace')", []);
  assert.equal(r.rowsAffected, 1);
  const check = await a.query("SELECT COUNT(*) FROM author", [], { maxRows: 10, maxCellBytes: 100 });
  assert.equal(check.rows[0][0], 2);
  await a.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/sql`
Expected: FAIL — `Cannot find module '../dist/adapter.js'`.

- [ ] **Step 3: Create `servers/sql/src/adapter.ts`**

```ts
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
    const { createPostgres } = await import("./adapters/postgres.js");
    adapter = await createPostgres(conn);
  }
  cache.set(conn.name, adapter);
  return adapter;
}
```

- [ ] **Step 4: Create `servers/sql/src/adapters/sqlite.ts`**

```ts
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
```

Note: `execute` delegates to `executeScript`; the `index.ts` write tool passes params only for single statements. `executeScript`'s public interface (from `adapter.ts`) is `executeScript(statements: string[])`; the extra optional `params` here is an internal convenience and stays compatible.

- [ ] **Step 5: Run tests**

Run: `npm test -w servers/sql`
Expected: PASS (config, connections, guard, format, sqlite).

- [ ] **Step 6: Commit**

```bash
git add servers/sql/src/adapter.ts servers/sql/src/adapters/sqlite.ts servers/sql/test/sqlite.test.mjs
git commit -m "feat(sql): adapter interface + SQLite (sql.js) adapter"
```

---

### Task 6: Read tools + server entrypoint + logging

**Files:**
- Create: `servers/sql/src/log.ts`, `servers/sql/src/index.ts`
- Test: `servers/sql/test/server-read.test.mjs`

**Interfaces:**
- Consumes: `config`, `connections`, `adapter`, `guard`, `format`.
- Produces (in `log.ts`): `logInfo(msg: string, meta?: object): void` (stderr JSON line); `audit(entry: object): void` (append to `getAuditLogPath()` if set, redacted).
- Produces (in `index.ts`): a runnable stdio server registering the 9 read tools (+ write tools in Task 7). Binary `mcp-sql`.

- [ ] **Step 1: Create `servers/sql/src/log.ts`**

```ts
import { appendFileSync } from "node:fs";
import { getAuditLogPath } from "./config.js";
import { redact } from "./connections.js";

export function logInfo(msg: string, meta: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "info", msg, ...meta }));
}

export function audit(entry: Record<string, unknown>): void {
  const path = getAuditLogPath();
  if (!path) return;
  const line = redact(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
  try {
    appendFileSync(path, line + "\n");
  } catch {
    /* auditing must never break a tool call */
  }
}
```

- [ ] **Step 2: Create `servers/sql/src/index.ts` (read tools)**

```ts
#!/usr/bin/env node
/**
 * @abhishekmcp/sql — read-first SQL MCP over Postgres + SQLite.
 * Tool registration only; logic lives below in adapters. Write tools are
 * registered only when DB_WRITABLE=1.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION, isWritable, limits } from "./config.js";
import { getConnection, listConnections, redact } from "./connections.js";
import { getAdapter } from "./adapter.js";
import { assertReadOnly } from "./guard.js";
import { logInfo } from "./log.js";

const server = new McpServer({ name: "mcp-sql-server", version: VERSION });

const text = (v: string) => ({ content: [{ type: "text" as const, text: v }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const fail = (err: unknown) => text(`Error: ${redact((err as Error).message)}`);

const connArg = z.string().describe("Configured connection name (see list_connections)");
const paramsArg = z.array(z.unknown()).optional().describe("Positional bind parameters");

server.registerTool(
  "list_connections",
  { title: "List connections", description: "Configured database connections (name + type). No credentials are returned.", inputSchema: {} },
  async () => {
    try {
      return json(listConnections().map((c) => ({ name: c.name, type: c.type })));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_schemas",
  { title: "List schemas", description: "Schemas available in a connection (SQLite returns 'main').", inputSchema: { connection: connArg } },
  async ({ connection }) => {
    try {
      return json(await (await getAdapter(getConnection(connection))).listSchemas());
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_tables",
  { title: "List tables", description: "Tables and views in a schema.", inputSchema: { connection: connArg, schema: z.string().optional() } },
  async ({ connection, schema }) => {
    try {
      return json(await (await getAdapter(getConnection(connection))).listTables(schema));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "describe_table",
  { title: "Describe table", description: "Columns (type/nullable/default), primary key, foreign keys, and indexes for a table.", inputSchema: { connection: connArg, schema: z.string().optional(), table: z.string() } },
  async ({ connection, schema, table }) => {
    try {
      return json(await (await getAdapter(getConnection(connection))).describeTable(schema, table));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_indexes",
  { title: "List indexes", description: "Indexes on a table (name, columns, uniqueness).", inputSchema: { connection: connArg, schema: z.string().optional(), table: z.string() } },
  async ({ connection, schema, table }) => {
    try {
      return json(await (await getAdapter(getConnection(connection))).listIndexes(schema, table));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "relationships",
  { title: "Relationships", description: "Foreign-key relationships in a schema (from table.column → to table.column).", inputSchema: { connection: connArg, schema: z.string().optional() } },
  async ({ connection, schema }) => {
    try {
      return json(await (await getAdapter(getConnection(connection))).relationships(schema));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "query",
  { title: "Run query", description: "Run a read-only SELECT (only SELECT/WITH/VALUES). Use positional params. Results are row/cell-capped.", inputSchema: { connection: connArg, sql: z.string(), params: paramsArg } },
  async ({ connection, sql, params }) => {
    try {
      assertReadOnly(sql);
      const { maxRows, maxCellBytes } = limits();
      return json(await (await getAdapter(getConnection(connection))).query(sql, params ?? [], { maxRows, maxCellBytes }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "explain",
  { title: "Explain query", description: "Query plan for a SELECT (the server prepends EXPLAIN; no query is executed).", inputSchema: { connection: connArg, sql: z.string(), params: paramsArg } },
  async ({ connection, sql, params }) => {
    try {
      assertReadOnly(sql);
      return json(await (await getAdapter(getConnection(connection))).explain(sql, params ?? []));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "sample_table",
  { title: "Sample table", description: "Return up to `limit` rows from a table (SELECT * … LIMIT).", inputSchema: { connection: connArg, schema: z.string().optional(), table: z.string(), limit: z.number().int().positive().max(1000).optional() } },
  async ({ connection, schema, table, limit }) => {
    try {
      return json(await (await getAdapter(getConnection(connection))).sample(schema, table, limit ?? 20));
    } catch (err) {
      return fail(err);
    }
  },
);

// Task 7 inserts write tools here (gated by isWritable()).

async function main() {
  await server.connect(new StdioServerTransport());
  logInfo("sql server ready", { writable: isWritable(), connections: listConnections().length });
}
main().catch((e) => {
  console.error(`fatal: ${redact((e as Error).message)}`);
  process.exit(1);
});
```

- [ ] **Step 3: Build**

Run: `npm run build -w servers/sql`
Expected: `tsc` clean.

- [ ] **Step 4: Write the failing test `servers/sql/test/server-read.test.mjs`**

Reuse the stdio client pattern from `servers/git/test/git.test.mjs` (copy the `client()` helper and `makeDb()` from `sqlite.test.mjs`).

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function makeDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE author (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO author VALUES (1,'Ada');");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "sqlmcp-srv-"));
  const file = path.join(dir, "app.db");
  await fsp.writeFile(file, Buffer.from(db.export()));
  db.close();
  return file;
}

function client(env) {
  const proc = spawn("node", [SERVER], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
  const rl = readline.createInterface({ input: proc.stdout });
  const pending = new Map();
  let id = 0;
  rl.on("line", (l) => { let m; try { m = JSON.parse(l); } catch { return; } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((res) => { const msgId = ++id; pending.set(msgId, res); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msgId, method, params }) + "\n"); });
  const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return { send, notify, kill: () => proc.kill() };
}

async function connect(env) {
  const c = client(env);
  await c.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  c.notify("notifications/initialized", {});
  return c;
}

test("read tools work over stdio", async () => {
  const file = await makeDb();
  const c = await connect({ DB_CONN_local: `sqlite:${file}` });
  const list = await c.send("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  assert.ok(names.includes("query") && names.includes("describe_table"));
  assert.ok(!names.includes("execute"), "execute absent without DB_WRITABLE");

  const q = await c.send("tools/call", { name: "query", arguments: { connection: "local", sql: "SELECT name FROM author WHERE id = ?", params: [1] } });
  assert.match(q.result.content[0].text, /Ada/);

  const bad = await c.send("tools/call", { name: "query", arguments: { connection: "local", sql: "DELETE FROM author" } });
  assert.match(bad.result.content[0].text, /read-only/);
  c.kill();
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -w servers/sql`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add servers/sql/src/log.ts servers/sql/src/index.ts servers/sql/test/server-read.test.mjs
git commit -m "feat(sql): read tools + server entrypoint + logging"
```

---

### Task 7: Gated write tools

**Files:**
- Modify: `servers/sql/src/index.ts` (insert write-tool registration at the marker)
- Test: `servers/sql/test/server-write.test.mjs`

**Interfaces:**
- Consumes: `isWritable()`, `audit()`, adapter `execute`/`executeScript`.
- Produces: `execute` and `execute_script` tools, registered only when `isWritable()`.

- [ ] **Step 1: Add write tools in `index.ts`** (replace the `// Task 7 inserts…` comment)

```ts
import { audit } from "./log.js";
import { splitStatements } from "./guard.js";

if (isWritable()) {
  server.registerTool(
    "execute",
    { title: "Execute statement", description: "Run one write statement (INSERT/UPDATE/DELETE/DDL). Requires DB_WRITABLE.", inputSchema: { connection: connArg, sql: z.string(), params: paramsArg }, annotations: { destructiveHint: true } },
    async ({ connection, sql, params }) => {
      try {
        const r = await (await getAdapter(getConnection(connection))).execute(sql, params ?? []);
        audit({ tool: "execute", connection, sql });
        return json(r);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "execute_script",
    { title: "Execute script", description: "Run multiple statements in a single transaction (rolls back on error). Requires DB_WRITABLE.", inputSchema: { connection: connArg, sql: z.string() }, annotations: { destructiveHint: true } },
    async ({ connection, sql }) => {
      try {
        const statements = splitStatements(sql);
        const r = await (await getAdapter(getConnection(connection))).executeScript(statements);
        audit({ tool: "execute_script", connection, statements: statements.length });
        return json(r);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build -w servers/sql`
Expected: `tsc` clean.

- [ ] **Step 3: Write the failing test `servers/sql/test/server-write.test.mjs`**

Reuse the `client`/`connect`/`makeDb` helpers (copy from `server-read.test.mjs`).

```js
// ...copy client(), connect(), makeDb() from server-read.test.mjs...

test("write tools appear + persist only when DB_WRITABLE", async () => {
  const file = await makeDb();
  const c = await connect({ DB_CONN_local: `sqlite:${file}`, DB_WRITABLE: "1" });
  const list = await c.send("tools/list", {});
  assert.ok(list.result.tools.map((t) => t.name).includes("execute"));

  const ins = await c.send("tools/call", { name: "execute", arguments: { connection: "local", sql: "INSERT INTO author (id, name) VALUES (2, 'Grace')" } });
  assert.match(ins.result.content[0].text, /rowsAffected/);

  const count = await c.send("tools/call", { name: "query", arguments: { connection: "local", sql: "SELECT COUNT(*) AS n FROM author" } });
  assert.match(count.result.content[0].text, /2/);
  c.kill();
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/sql`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add servers/sql/src/index.ts servers/sql/test/server-write.test.mjs
git commit -m "feat(sql): gated write tools (execute, execute_script)"
```

---

### Task 8: Postgres adapter

**Files:**
- Create: `servers/sql/src/adapters/postgres.ts`
- Test: `servers/sql/test/postgres-dispatch.test.mjs`

**Interfaces:**
- Consumes: `Connection`, `limits()`, adapter types.
- Produces: `class PostgresAdapter implements Adapter` + `createPostgres(conn): Promise<PostgresAdapter>`. Read queries run in `BEGIN; SET TRANSACTION READ ONLY; SET LOCAL statement_timeout=<ms>; …; ROLLBACK`. Writes run in a committed transaction. Introspection via `information_schema`/`pg_catalog`. Uses `rowMode: "array"`.

- [ ] **Step 1: Create `servers/sql/src/adapters/postgres.ts`**

```ts
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
    const { columns, rows } = await this.readQuery(sql, params);
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
    return this.query(`SELECT * FROM ${ident} LIMIT ${Math.min(limit, maxRows)}`, [], { maxRows, maxCellBytes });
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
```

- [ ] **Step 2: Write the failing test `servers/sql/test/postgres-dispatch.test.mjs`** (hermetic — no live PG)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresAdapter } from "../dist/adapters/postgres.js";

test("PostgresAdapter class is constructable and shaped", () => {
  // We do not connect (no live server in CI); just verify the module + surface.
  assert.equal(typeof PostgresAdapter, "function");
  const methods = ["listSchemas", "listTables", "describeTable", "listIndexes", "relationships", "query", "explain", "sample", "execute", "executeScript", "close"];
  for (const m of methods) assert.equal(typeof PostgresAdapter.prototype[m], "function", m);
});
```

- [ ] **Step 3: Build + run tests**

Run: `npm test -w servers/sql`
Expected: PASS. (Live-Postgres behavior is verified manually — see README "Manual Postgres check".)

- [ ] **Step 4: Commit**

```bash
git add servers/sql/src/adapters/postgres.ts servers/sql/test/postgres-dispatch.test.mjs
git commit -m "feat(sql): Postgres adapter (read-only txn + introspection)"
```

---

### Task 9: Docs, distribution wiring, and final verification

**Files:**
- Create: `servers/sql/README.md`, `servers/sql/CHANGELOG.md`, `servers/sql/server.json`, `servers/sql/mcpb/manifest.json`, `servers/sql/scripts/build-mcpb.mjs`, `plugins/sql/.mcp.json`, `plugins/sql/plugin.json` (match an existing plugin's shape)
- Modify: root `README.md` (Servers table + distribution table), `CLAUDE.md` (reword Hard-constraints native bullet + add "Server architecture: sql" section), root `.claude-plugin/marketplace.json` (add sql)

**Interfaces:** none (docs/packaging).

- [ ] **Step 1: Copy the generic MCPB build script**

Run: `cp servers/git/scripts/build-mcpb.mjs servers/sql/scripts/build-mcpb.mjs` then edit its header comment `git` → `sql` and the `serverRoot` comment. (Generic body uses the `slug` variable — no other change.)

- [ ] **Step 2: Create `servers/sql/mcpb/manifest.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/anthropics/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json",
  "manifest_version": "0.4",
  "name": "sql",
  "display_name": "SQL",
  "version": "0.1.0",
  "description": "Read-only SQL querying and schema introspection over Postgres and SQLite, with a gated write mode.",
  "author": { "name": "Abhishek", "url": "https://github.com/Abhishekkumar2021" },
  "homepage": "https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/sql#readme",
  "documentation": "https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/sql#readme",
  "repository": { "type": "git", "url": "https://github.com/Abhishekkumar2021/mcp-suite" },
  "license": "MIT",
  "keywords": ["sql", "postgres", "sqlite", "database", "productivity"],
  "server": {
    "type": "node",
    "entry_point": "server/dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/dist/index.js"],
      "env": { "DB_CONN_default": "${user_config.connectionUrl}", "DB_WRITABLE": "${user_config.writable}" }
    }
  },
  "user_config": {
    "connectionUrl": { "type": "string", "title": "Connection URL", "description": "A postgres:// or sqlite: URL. Exposed to the server as connection name 'default'.", "sensitive": true, "required": true },
    "writable": { "type": "boolean", "title": "Enable writes", "description": "Allow execute/execute_script write tools.", "default": false, "required": false }
  },
  "compatibility": { "claude_desktop": ">=0.10.0", "platforms": ["darwin", "win32", "linux"] }
}
```

- [ ] **Step 3: Create `servers/sql/README.md`**

Document: what it is; tools table (read + gated write); Configuration table (all `DB_*`/`SQL_AUDIT_LOG` env from the spec); connection URL examples; **read-only enforcement** (guard + PG read-only txn + SQLite `PRAGMA query_only`); Usage (plugin + manual `claude mcp add sql --env DB_CONN_x=... -- npx -y @abhishekmcp/sql` + JSON block + MCPB line); a **"Manual Postgres check"** section (spin up a local PG, set `DB_CONN_pg`, run `tools/call` smoke). Follow `servers/git/README.md` structure.

- [ ] **Step 4: Create `servers/sql/CHANGELOG.md`**

```markdown
# Changelog — @abhishekmcp/sql

All notable changes to this server. Format based on [Keep a Changelog](https://keepachangelog.com).

## 0.1.0 — Initial release
- Read-first SQL MCP over Postgres (`pg`) and SQLite (`sql.js`/WASM).
- Read tools: list_connections, list_schemas, list_tables, describe_table, list_indexes, relationships, query, explain, sample_table.
- Write tools (only when `DB_WRITABLE=1`): execute, execute_script.
- Defense-in-depth read-only: statement guard + engine-level (PG read-only txn, SQLite `PRAGMA query_only`).
- Named connections via `DB_CONN_<name>`; secrets never in tool args or logs. Row/cell caps, statement timeout, SQLite size cap, optional audit log.
```

- [ ] **Step 5: Create `servers/sql/server.json`** (copy `servers/git/server.json`, change name to `io.github.Abhishekkumar2021/sql`, description, package name/version).

- [ ] **Step 6: Add the Claude Code plugin** — copy `plugins/git/` to `plugins/sql/`, edit `plugin.json` (name/description) and `.mcp.json` (`npx -y @abhishekmcp/sql`, no env block). Add a `sql` entry to `.claude-plugin/marketplace.json`.

- [ ] **Step 7: Update root `README.md`** — add the Servers-table row and the distribution-table row:

```
| [`sql`](servers/sql) | SQL databases: read-only query + schema introspection over Postgres & SQLite, gated writes | ✅ Stable |
```
```
| [`sql`](servers/sql) | `/plugin install sql` | `npx -y @abhishekmcp/sql` | drag `sql-*.mcpb` | `io.github.Abhishekkumar2021/sql` |
```

- [ ] **Step 8: Update `CLAUDE.md`** — reword the "No native dependencies" hard-constraint bullet to the pure-JS/WASM-preferred policy (native allowed when genuinely required, gated/documented; note the MCPB platform caveat). Add a "Server architecture: `sql`" section summarizing the adapter design, `DB_CONN_*` connections, defense-in-depth read-only (guard + PG read-only txn + SQLite `query_only`), gated writes, and the manual-PG test posture.

- [ ] **Step 9: Full build + test + MCPB smoke**

Run:
```bash
npm run build
npm test --workspaces
npm run build:mcpb -w servers/sql
```
Expected: all builds clean; every server's tests pass; `dist-mcpb/sql-0.1.0.mcpb` produced and manifest schema validation passes. Then extract the bundle and boot it against a temp SQLite DB (the git/github MCPB verification pattern) — `tools/list` returns the read tools.

- [ ] **Step 10: Commit**

```bash
git add servers/sql/README.md servers/sql/CHANGELOG.md servers/sql/server.json servers/sql/mcpb/ servers/sql/scripts/ plugins/sql/ .claude-plugin/marketplace.json README.md CLAUDE.md
git commit -m "docs(sql): README, distribution wiring, CLAUDE.md; ship v0.1.0"
```

---

## Self-Review

**Spec coverage:** All spec sections map to tasks — config/env (T1), connections+redaction (T2), guard (T3), format/caps (T4), adapter+SQLite incl. `query_only` read-only + persist (T5), read tools+server+logging (T6), gated writes+audit (T7), Postgres read-only-txn adapter (T8), docs/distribution/CLAUDE.md reword + MCPB + manual-PG posture (T9). Non-goals (MySQL, runtime connection mgmt, migrations) intentionally excluded.

**Type consistency:** `Adapter` method names/signatures defined in T5 (`adapter.ts`) are used unchanged in T6–T8; `ResultSet` (T4) is the return of `query`/`explain`/`sample`; `TableRef.kind`, `TableDesc.primaryKey/foreignKeys/indexes`, `ForeignKey.{fromTable,fromColumn,toTable,toColumn}`, `IndexInfo.{name,columns,unique}` are consistent across SQLite + Postgres adapters and tool JSON.

**Placeholder scan:** No TBD/TODO; every code step ships complete code. T9 docs steps describe file content by pointing at an exact existing template to copy (git's README/server.json/plugin) plus the specific edits — acceptable since they are mechanical mirrors of committed files, and the machine-critical artifacts (manifest, CHANGELOG, table rows) are given verbatim.

**Known nuance:** `SqliteAdapter.executeScript` adds an optional internal `params` arg beyond the `Adapter` interface signature (`executeScript(statements)`); it remains call-compatible. `execute` funnels through it. Verified this compiles under `strict` (extra optional param is allowed on an implementing method).
