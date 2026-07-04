#!/usr/bin/env node
/**
 * @abhishekmcp/http — HTTP/REST client MCP server.
 * Tool registration only; logic lives below. Mutating methods require
 * HTTP_WRITABLE; the server refuses to serve without HTTP_ALLOW_HOSTS.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION, hasAllowHosts, isWritable } from "./config.js";
import { NotWritable } from "./errors.js";
import { fetchSafe } from "./client.js";
import { formatResponse } from "./format.js";
import { substitute, collectSecretValues, redact } from "./vars.js";
import { getEnvironment } from "./store.js";
import { logInfo, audit } from "./log.js";
import type { RequestDef } from "./store.js";

const server = new McpServer({ name: "mcp-http-server", version: VERSION });

const text = (v: string) => ({ content: [{ type: "text" as const, text: v }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const fail = (err: unknown) => text(`Error: ${redact((err as Error).message)}`);

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function assertMethodAllowed(method: string): void {
  if (MUTATING.has(method.toUpperCase()) && !isWritable()) throw new NotWritable(method.toUpperCase());
}

/** Resolve ${var}/${secret} across a request using an optional environment. */
function resolve(def: RequestDef, environment?: string): { req: RequestDef; secrets: string[] } {
  const vars = environment ? getEnvironment(environment) : {};
  const secrets: string[] = [];
  const sub = (s: string) => { collectSecretValues(s).forEach((v) => secrets.push(v)); return substitute(s, vars); };
  const headers = def.headers ? Object.fromEntries(Object.entries(def.headers).map(([k, v]) => [k, sub(v)])) : undefined;
  const query = def.query ? Object.fromEntries(Object.entries(def.query).map(([k, v]) => [k, sub(v)])) : undefined;
  return { req: { method: def.method, url: sub(def.url), headers, query, body: def.body ? sub(def.body) : undefined }, secrets };
}

async function execute(def: RequestDef, environment?: string) {
  assertMethodAllowed(def.method);
  const { req, secrets } = resolve(def, environment);
  const raw = await fetchSafe(req);
  audit({ method: def.method, url: req.url, status: raw.status });
  return json(formatResponse(raw, secrets));
}

const methodArg = z.string().describe("HTTP method (GET/HEAD/OPTIONS always; POST/PUT/PATCH/DELETE need HTTP_WRITABLE=1)");

server.registerTool(
  "request",
  {
    title: "HTTP request",
    description: "Make an ad-hoc HTTP request to an allowlisted host. Supports ${var} (from an environment) and ${secret.name} (from HTTP_SECRET_*).",
    inputSchema: {
      method: methodArg,
      url: z.string(),
      headers: z.record(z.string()).optional(),
      query: z.record(z.string()).optional(),
      body: z.string().optional(),
      environment: z.string().optional().describe("Environment name for ${var} resolution"),
    },
  },
  async ({ method, url, headers, query, body, environment }) => {
    try {
      return await execute({ method, url, headers, query, body }, environment);
    } catch (err) {
      return fail(err);
    }
  },
);

// Task 8 registers saved-request / environment / curl tools here.
export { execute };

async function main() {
  if (!hasAllowHosts()) {
    console.error("fatal: HTTP_ALLOW_HOSTS is required (comma-separated allowed hosts). Refusing to start.");
    process.exit(1);
  }
  await server.connect(new StdioServerTransport());
  logInfo("http server ready", { writable: isWritable() });
}
main().catch((e) => {
  console.error(`fatal: ${redact((e as Error).message)}`);
  process.exit(1);
});
