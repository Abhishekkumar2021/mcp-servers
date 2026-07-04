# sql (Claude Code plugin)

Installs the [`@abhishekmcp/sql`](https://www.npmjs.com/package/@abhishekmcp/sql) MCP server — read-only
SQL querying and schema introspection over **Postgres** and **SQLite**, with a gated write mode. Pure-JS
(`pg` + `sql.js`/WASM); **no native dependencies**.

## Install

```
/plugin marketplace add Abhishekkumar2021/mcp-suite
/plugin install sql
```

## Required configuration

The server talks to databases through **named connections** set via `DB_CONN_<name>` env vars. The plugin
wires `DB_CONN_default` (the `default` connection) and `DB_WRITABLE`. Set them before launching Claude Code:

```bash
export DB_CONN_default="postgres://user:pass@localhost:5432/app"   # or
export DB_CONN_default="sqlite:/absolute/path/to/app.db"           # SQLite paths must be ABSOLUTE
```

Write tools (`execute`, `execute_script`) are **off by default** — enable with `DB_WRITABLE=1`. See the
[server README](https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/sql#readme) for all
connections, limits, and read-only enforcement details.
