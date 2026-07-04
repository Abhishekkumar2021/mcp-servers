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
import { getEnvironment, saveRequest, getRequest, deleteRequest, listRequests, listCollections, setEnvironment, listEnvironments, deleteEnvironment } from "./store.js";
import { parseCurl, toCurl } from "./curl.js";
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

const reqDefShape = {
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  query: z.record(z.string()).optional(),
  body: z.string().optional(),
};

server.registerTool(
  "run_request",
  { title: "Run saved request", description: "Execute a saved request (with ${var}/${secret} resolution + optional overrides).", inputSchema: { collection: z.string(), name: z.string(), environment: z.string().optional(), overrides: z.object(reqDefShape).partial().optional() } },
  async ({ collection, name, environment, overrides }) => {
    try {
      const def = { ...getRequest(collection, name), ...(overrides ?? {}) };
      return await execute(def, environment);
    } catch (err) { return fail(err); }
  },
);

server.registerTool(
  "save_request",
  { title: "Save request", description: "Persist a request definition into a collection.", inputSchema: { collection: z.string(), name: z.string(), request: z.object(reqDefShape) } },
  async ({ collection, name, request }) => { try { saveRequest(collection, name, request); return json({ saved: `${collection}/${name}` }); } catch (err) { return fail(err); } },
);

server.registerTool(
  "list_requests",
  { title: "List requests", description: "List saved requests (optionally within one collection).", inputSchema: { collection: z.string().optional() } },
  async ({ collection }) => { try { return json(listRequests(collection)); } catch (err) { return fail(err); } },
);

server.registerTool(
  "get_request",
  { title: "Get request", description: "Return a saved request definition.", inputSchema: { collection: z.string(), name: z.string() } },
  async ({ collection, name }) => { try { return json(getRequest(collection, name)); } catch (err) { return fail(err); } },
);

server.registerTool(
  "delete_request",
  { title: "Delete request", description: "Delete a saved request.", inputSchema: { collection: z.string(), name: z.string() }, annotations: { destructiveHint: true } },
  async ({ collection, name }) => { try { deleteRequest(collection, name); return json({ deleted: `${collection}/${name}` }); } catch (err) { return fail(err); } },
);

server.registerTool(
  "list_collections",
  { title: "List collections", description: "List saved collections.", inputSchema: {} },
  async () => { try { return json(listCollections()); } catch (err) { return fail(err); } },
);

server.registerTool(
  "set_environment",
  { title: "Set environment", description: "Create or replace an environment's variables (non-secret; secrets come from HTTP_SECRET_*).", inputSchema: { name: z.string(), vars: z.record(z.string()) } },
  async ({ name, vars }) => { try { setEnvironment(name, vars); return json({ saved: name }); } catch (err) { return fail(err); } },
);

server.registerTool(
  "get_environment",
  { title: "Get environment", description: "Return an environment's variables.", inputSchema: { name: z.string() } },
  async ({ name }) => { try { return json(getEnvironment(name)); } catch (err) { return fail(err); } },
);

server.registerTool(
  "list_environments",
  { title: "List environments", description: "List environments.", inputSchema: {} },
  async () => { try { return json(listEnvironments()); } catch (err) { return fail(err); } },
);

server.registerTool(
  "delete_environment",
  { title: "Delete environment", description: "Delete an environment.", inputSchema: { name: z.string() }, annotations: { destructiveHint: true } },
  async ({ name }) => { try { deleteEnvironment(name); return json({ deleted: name }); } catch (err) { return fail(err); } },
);

server.registerTool(
  "import_curl",
  { title: "Import curl", description: "Parse a curl command into a request definition; saves it if collection+name are given.", inputSchema: { curl: z.string(), collection: z.string().optional(), name: z.string().optional() } },
  async ({ curl, collection, name }) => {
    try {
      const def = parseCurl(curl);
      if (collection && name) { saveRequest(collection, name, def); return json({ saved: `${collection}/${name}`, request: def }); }
      return json(def);
    } catch (err) { return fail(err); }
  },
);

server.registerTool(
  "export_curl",
  { title: "Export curl", description: "Render a saved request as a curl command (secrets masked).", inputSchema: { collection: z.string(), name: z.string() } },
  async ({ collection, name }) => { try { return text(toCurl(getRequest(collection, name), { maskSecrets: true })); } catch (err) { return fail(err); } },
);

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
