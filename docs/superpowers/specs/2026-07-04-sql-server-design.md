# Design — `sql` server (@abhishekmcp/sql)

**Status:** approved design, pre-implementation
**Date:** 2026-07-04
**Author:** Abhishek (with Claude)

A read-first SQL MCP server for the `mcp-suite` monorepo: safe read-only querying
and schema introspection over **Postgres** and **SQLite**, with an optional gated
write mode.

## 1. Goals & non-goals

**Goals**
- Let an MCP client explore a database (schemas, tables/views, columns, keys,
  indexes, relationships) and run **read-only** queries safely.
- Support two backends behind one adapter interface: **Postgres** (pure-JS `pg`)
  and **SQLite** (`sql.js`, WASM).
- Keep the whole thing **portable** (npm/npx, Claude Code plugin, MCP registry,
  and MCPB bundle) — no native binaries.
- Model safe secret handling: connections are operator-configured; **raw DSNs
  never appear in tool arguments or logs**.

**Non-goals (v0.1)**
- MySQL / other engines (the adapter seam makes this a later add: one new file).
- Connection management tools (add/remove connections at runtime).
- Migrations, schema diffing, ORMs/query builders.
- CalDAV-style remote anything. Local + standard Postgres only.

## 2. Dependency policy (context)

The suite's former hard rule "no native dependencies" is now a **preference**:
prefer pure-JS/WASM for portability; use native only when genuinely required
(gated + documented). For `sql`, WASM (`sql.js`) covers SQLite while keeping the
MCPB bundle portable, so **no native deps** are used. Postgres uses pure-JS `pg`.
(CLAUDE.md's "Hard constraints" bullet is reworded as part of this work.)

## 3. Identity & distribution

- Slug `sql`; npm `@abhishekmcp/sql`; binary `mcp-sql`; dir `servers/sql/`; tag
  `sql-v<semver>`; description starts "MCP server for …".
- `package.json` carries `publishConfig {access:"public", provenance:true}`,
  `repository.directory:"servers/sql"`, `mcpName`.
- Distribution channels: npm, Claude Code plugin (`plugins/sql/`), MCP registry
  (`server.json`), MCPB bundle (`mcpb/manifest.json` + generic `build:mcpb`).

## 4. Configuration (environment only)

| Var | Default | Effect |
|-----|---------|--------|
| `DB_CONN_<name>` | — | Defines a named connection by URL. Scheme sets type: `postgres://`/`postgresql://` → Postgres; `sqlite:`/`file:` → SQLite. At least one required to be useful. |
| `DB_WRITABLE` | unset | `1`/`true` registers write tools and permits writable execution. Default is strictly read-only. |
| `DB_MAX_ROWS` | `1000` | Hard cap on rows returned; also the implicit `LIMIT` applied when a query specifies none. |
| `DB_MAX_CELL_BYTES` | `8192` | Oversized cell values are truncated with a marker. |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Per-statement timeout (pg `statement_timeout`; SQLite interrupt timer). |
| `DB_SQLITE_MAX_BYTES` | `536870912` (512 MB) | Refuse to open a larger SQLite file (`sql.js` loads it into memory). |
| `SQL_AUDIT_LOG` | unset | Path to append a JSON-lines audit log (writes always logged); secrets redacted. |

**Connection naming.** `DB_CONN_analytics=postgres://u:p@host:5432/db`,
`DB_CONN_local=sqlite:/abs/path/app.db`. The suffix after `DB_CONN_` is the
connection name used by tools.

**SQLite path trust.** Because connections are operator-configured (not supplied
per tool call), the SQLite file path is already trusted. There is **no per-call
path argument**, so there is no path-traversal surface. The adapter still
realpath-resolves the file, requires it to exist, and enforces `DB_SQLITE_MAX_BYTES`.

## 5. Architecture (`servers/sql/src/`)

Layered, thin `index.ts`, following `notes`/`files`/`git`:

- `config.ts` — env parsing, limits, `VERSION` (kept in lockstep with package.json).
- `connections.ts` — parse `DB_CONN_*` into a registry `{name, type, url, …}`;
  `getConnection(name)`; `redact()` for secrets in errors/logs.
- `adapter.ts` — the `Adapter` interface + `getAdapter(conn)` (lazily creates and
  caches one adapter per connection).
- `adapters/postgres.ts` — `pg` Pool; introspection via `information_schema` /
  `pg_catalog`; read-only transaction wrapper; write execution.
- `adapters/sqlite.ts` — lazy `sql.js` init (WASM import only when first used, like
  `notes`' `embed.ts`); introspection via `sqlite_master` + `PRAGMA`; query; write +
  atomic persist.
- `guard.ts` — SQL statement classifier: SELECT-family allow-list for read tools;
  multi-statement split for scripts.
- `format.ts` — shape result sets (columns + rows), apply `DB_MAX_ROWS` and
  `DB_MAX_CELL_BYTES`, attach truncation notices.
- `log.ts` — structured stderr logging + optional `SQL_AUDIT_LOG` audit (mirrors
  `files`/`github`).
- `index.ts` — register tools; **write tools registered only when `DB_WRITABLE`**.

### Adapter interface

```ts
interface Adapter {
  listSchemas(): Promise<string[]>;
  listTables(schema?: string): Promise<TableRef[]>;          // tables + views
  describeTable(schema: string | undefined, table: string): Promise<TableDesc>;
  listIndexes(schema: string | undefined, table: string): Promise<IndexInfo[]>;
  relationships(schema?: string): Promise<ForeignKey[]>;      // FK graph
  query(sql: string, params: unknown[], opts: { maxRows: number }): Promise<ResultSet>;
  explain(sql: string, params: unknown[]): Promise<ResultSet>;
  sample(schema: string | undefined, table: string, limit: number): Promise<ResultSet>;
  execute(sql: string, params: unknown[]): Promise<ExecResult>;      // write mode only
  executeScript(statements: string[]): Promise<ExecResult[]>;       // write mode only
  close(): Promise<void>;
}
```

SQLite has no real schemas; `listSchemas` returns `["main"]` (+ attached DBs if
any) and `schema` is ignored elsewhere.

## 6. Tools

**Read (always registered)**
1. `list_connections` — configured connection names + type + redacted target. No DB round-trip.
2. `list_schemas` — schemas for a connection.
3. `list_tables` — tables and views in a schema.
4. `describe_table` — columns (name, type, nullable, default), primary key, foreign keys, indexes.
5. `list_indexes` — indexes for a table (name, columns, unique).
6. `relationships` — foreign-key map for a schema (from table.column → to table.column).
7. `query` — run a read-only SELECT; optional positional `params`; enforced read-only; row/cell caps.
8. `explain` — query plan for a SELECT. Takes a SELECT (guard-validated as SELECT-family); the adapter itself prepends `EXPLAIN` (pg) / `EXPLAIN QUERY PLAN` (SQLite). Callers cannot pass a raw `EXPLAIN ANALYZE`, so no query is executed as a side effect.
9. `sample_table` — `SELECT * FROM <table> LIMIT <n>` convenience.

**Write (registered only when `DB_WRITABLE`)** — both `annotations:{destructiveHint:true}`
10. `execute` — run one DML/DDL statement; returns rows affected / result.
11. `execute_script` — run multiple statements in a single transaction (rolls back on error).

Every tool has a `title`, `description`, and Zod `inputSchema`. Every query/execute
takes `connection` (name) plus SQL and optional `params`.

## 7. Read-only enforcement (defense in depth)

1. **Statement guard (`guard.ts`).** Read tools accept only the SELECT family
   (`SELECT`, `WITH … SELECT`, `VALUES`, read-only `PRAGMA`/`SHOW`). `EXPLAIN` is
   never accepted raw — the `explain` tool prepends it to an already-validated
   SELECT, so `EXPLAIN ANALYZE` can't be smuggled in. Anything else →
   `ReadOnlyViolation` with a clear "this is a read-only server (set DB_WRITABLE
   to enable writes)" message.
2. **Engine-level.**
   - Postgres: each read query runs inside `BEGIN; SET TRANSACTION READ ONLY; … ;
     ROLLBACK` — even side-effecting functions are refused by the server. Statement
     timeout applied.
   - SQLite: before each read query the adapter sets `PRAGMA query_only = ON`, so
     the engine itself rejects any write (INSERT/UPDATE/DELETE/DDL) — true
     engine-level read-only, symmetric with Postgres. Read tools also never persist
     the in-memory image, as a second backstop. Write mode sets `PRAGMA query_only = OFF`.
3. **Parameters are always bound** (positional), never string-interpolated.

Write tools bypass layer 1's SELECT-only rule (by design) but still run under the
statement timeout; `execute_script` is transactional.

## 8. Data flow

client → `index.ts` handler → `getConnection(name)` → `getAdapter(conn)` (cached)
→ (`query`/`execute`: `guard` classify) → adapter runs against `pg` / `sql.js`
→ `format` applies caps → response. Errors are mapped to actionable text; secrets
redacted everywhere.

## 9. Error handling

Typed errors mapped in `index.ts`:
`ConnectionNotFound`, `NotWritable`, `ReadOnlyViolation`, `StatementTimeout`,
`SqliteTooLarge`, `TableNotFound`, and driver auth/connection failures →
actionable messages (e.g. "connection 'x' not found; configure DB_CONN_x").
`redact()` strips connection URLs / credentials from all output and logs.

## 10. Testing (committed `node:test`, run in CI)

- **SQLite adapter (hermetic → CI):** build a temp DB with `sql.js`, seed a small
  schema (two related tables + a view + an index), then exercise: introspection
  (schemas/tables/describe/indexes/relationships), `query` + params, row/cell caps,
  read-only rejection of a write via a read tool, and — with `DB_WRITABLE` —
  `execute`/`execute_script` persisting changes.
- **`guard.ts` unit tests:** SELECT / CTE-SELECT / EXPLAIN accepted; INSERT /
  UPDATE / DELETE / DDL / multi-statement rejected for read tools.
- **`format.ts` unit tests:** row cap and cell truncation.
- **Postgres adapter:** integration needs a live server → **manual** (documented in
  the README, like `notes`' semantic test and `github`'s real-API checks). CI runs
  everything hermetic.

Verify end-to-end with the suite's stdio JSON-RPC smoke pattern
(`initialize` → `initialized` → `tools/list` → `tools/call`) against a temp SQLite DB.

## 11. Repo housekeeping (part of this work)

- Reword CLAUDE.md "Hard constraints" → the pure-JS/WASM-preferred dependency policy.
- Add a "Server architecture: `sql`" section to CLAUDE.md.
- Add the README Servers-table row + distribution-table entry.
- Add `plugins/sql/` (marketplace manifest + `.mcp.json`), `server.json`,
  `mcpb/manifest.json`, `scripts/build-mcpb.mjs`, `CHANGELOG.md`, `README.md`.

## 12. Build sequence (high level; detailed plan follows in writing-plans)

1. Scaffold workspace (package.json, tsconfig, config.ts) → `tsc` clean.
2. `connections.ts` + `guard.ts` + `format.ts` with unit tests → tests pass.
3. `adapters/sqlite.ts` + `adapter.ts` → SQLite adapter tests pass.
4. `index.ts` read tools → stdio smoke over a temp SQLite DB.
5. Write tools gated by `DB_WRITABLE` → gated smoke.
6. `adapters/postgres.ts` → manual PG check documented.
7. Docs + distribution wiring (README, CLAUDE.md, plugin, server.json, mcpb).
8. Version 0.1.0; release via `sql-v0.1.0` tag (OIDC CD).
