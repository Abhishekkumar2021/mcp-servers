# @abhishekmcp/sql

A read-first SQL [MCP](https://modelcontextprotocol.io) server: query and introspect **Postgres** and
**SQLite** databases from any MCP client. Built on pure-JS drivers — `pg` for Postgres and `sql.js`
(WebAssembly) for SQLite — so there are **no native dependencies** and nothing to compile. Databases are
referenced by **named connections** (`DB_CONN_<name>`); credentials never appear in tool arguments or logs.

Reads are the default and are enforced with defense-in-depth; writes are **off unless you opt in** with
`DB_WRITABLE=1`.

## Tools

**Read (always):**
- `list_connections` — configured connection names + types (no credentials returned)
- `list_schemas` — schemas in a connection (SQLite returns `main`)
- `list_tables` — tables and views in a schema
- `describe_table` — columns (type/nullable/default), primary key, foreign keys, and indexes
- `list_indexes` — indexes on a table (name, columns, uniqueness)
- `relationships` — foreign-key relationships in a schema (`from table.column → to table.column`)
- `query` — run a read-only `SELECT`/`WITH`/`VALUES` (positional params; row/cell-capped)
- `explain` — query plan for a `SELECT` (server prepends `EXPLAIN`; nothing is executed)
- `sample_table` — up to `limit` rows from a table (`SELECT * … LIMIT`)

**Write (only when `DB_WRITABLE=1`):**
- `execute` — run one write statement (`INSERT`/`UPDATE`/`DELETE`/DDL), positional params
- `execute_script` — run multiple statements in a single transaction (rolls back on error)

> Write tools are simply **not registered** (absent from `tools/list`) unless `DB_WRITABLE` is set.

## Configuration

| Variable | Default | Effect |
|----------|---------|--------|
| `DB_CONN_<name>` | — | Defines a connection called `<name>`. Value is a connection URL: `postgres://user:pass@host:5432/db` or `sqlite:/absolute/path/app.db`. Define as many as you like (e.g. `DB_CONN_pg`, `DB_CONN_local`). **SQLite paths must be ABSOLUTE.** |
| `DB_WRITABLE` | `0` | `1`/`true` registers the write tools (`execute`, `execute_script`). |
| `DB_MAX_ROWS` | `1000` | Max rows returned by `query`/`sample_table` (result is truncated + flagged). |
| `DB_MAX_CELL_BYTES` | `8192` | Max bytes per cell before truncation (keeps output token-cheap). |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Per-statement timeout. |
| `DB_SQLITE_MAX_BYTES` | `536870912` (512 MB) | Refuse to open a SQLite file larger than this (`sql.js` loads the DB into memory). |
| `SQL_AUDIT_LOG` | — | Path to a JSON-lines file; each executed **write** statement is appended (never contains credentials). |

Connection URLs carry credentials, so they live only in the environment — tools take a connection **name**,
never a URL. Any credential that leaks into an error message is redacted.

## Read-only enforcement

Read tools are protected at three layers, so a bypass at one layer is still caught by the next:

1. **Statement guard** — `query`/`explain` reject anything that isn't a single `SELECT`/`WITH`/`VALUES`
   statement (comments stripped; multiple statements rejected).
2. **Postgres** — the query runs inside a `READ ONLY` transaction, so the engine itself refuses writes.
3. **SQLite** — the connection sets `PRAGMA query_only = ON` for read tools, so writes error at the engine.

## Limitations

- `execute_script` splits the input on top-level `;` and does **not** support Postgres dollar-quoted bodies
  (`$$ … $$`, e.g. `CREATE FUNCTION`). Run those through `execute` as a single statement instead.
- MySQL is not supported; connections are runtime-static (defined via env, not added at runtime); no migrations.

## Usage

```bash
# Claude Code (plugin):  /plugin marketplace add Abhishekkumar2021/mcp-suite  →  /plugin install sql
# Claude Code (manual):
claude mcp add sql --env DB_CONN_local=sqlite:/abs/path/app.db -- npx -y @abhishekmcp/sql
```

```json
{
  "mcpServers": {
    "sql": {
      "command": "npx",
      "args": ["-y", "@abhishekmcp/sql"],
      "env": {
        "DB_CONN_pg": "postgres://user:pass@localhost:5432/app",
        "DB_CONN_local": "sqlite:/absolute/path/to/app.db",
        "DB_WRITABLE": "0"
      }
    }
  }
}
```

**Claude Desktop (MCPB):** drag `sql-*.mcpb` from the [latest release](https://github.com/Abhishekkumar2021/mcp-suite/releases) into Settings → Extensions, then set the connection URL (mapped to the `default` connection) and, optionally, enable writes. Build it locally with `npm run build:mcpb -w servers/sql`.

## Manual Postgres check

CI covers SQLite only (hermetic — no server needed). To verify Postgres against a live database:

```bash
# 1. Start a throwaway Postgres (Docker) and load a row:
docker run --rm -d --name sqlmcp-pg -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:16
sleep 5
docker exec -i sqlmcp-pg psql -U postgres -c \
  "CREATE TABLE author (id serial primary key, name text); INSERT INTO author(name) VALUES ('Ada');"

# 2. Build, then run a stdio smoke test against the connection:
npm run build -w servers/sql
export DB_CONN_pg="postgres://postgres:pw@localhost:5432/postgres"
node servers/sql/dist/index.js   # then write JSON-RPC to stdin:
#   {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}
#   {"jsonrpc":"2.0","method":"notifications/initialized"}
#   {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query","arguments":{"connection":"pg","sql":"SELECT name FROM author"}}}
# Expect a result row containing "Ada". Also try list_tables / describe_table.

docker rm -f sqlmcp-pg
```

## License

MIT
