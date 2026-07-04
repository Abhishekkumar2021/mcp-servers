# Changelog — @abhishekmcp/sql

All notable changes to this server. Format based on [Keep a Changelog](https://keepachangelog.com).

## 0.1.0 — Initial release
- Read-first SQL MCP over Postgres (`pg`) and SQLite (`sql.js`/WASM).
- Read tools: list_connections, list_schemas, list_tables, describe_table, list_indexes, relationships, query, explain, sample_table.
- Write tools (only when `DB_WRITABLE=1`): execute, execute_script.
- Defense-in-depth read-only: statement guard + engine-level (PG read-only txn, SQLite `PRAGMA query_only`).
- Named connections via `DB_CONN_<name>`; secrets never in tool args or logs. Row/cell caps, statement timeout, SQLite size cap, optional audit log.
