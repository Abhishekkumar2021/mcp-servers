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
