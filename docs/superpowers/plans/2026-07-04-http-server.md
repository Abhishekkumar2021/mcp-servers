# http server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@abhishekmcp/http`, an HTTP/REST client MCP server with saved collections/environments, env-based secrets, gated mutating methods, and defense-first SSRF protection (required host allowlist + resolved-IP validation + per-redirect re-check).

**Architecture:** Layered, thin `index.ts`. Requests go through an SSRF-safe fetch engine (`node:http`/`https` with a custom DNS `lookup` that validates + pins the resolved IP; redirects followed manually and re-validated). Collections/environments persist as JSON under a store dir; secrets come only from env and are redacted everywhere.

**Tech Stack:** TypeScript (Node16 ESM, `.js` import extensions), `@modelcontextprotocol/sdk`, `zod`, and Node built-ins only (`node:http`, `node:https`, `node:dns`, `node:net`, `node:zlib`, `node:fs`). No runtime HTTP dependency.

## Global Constraints

- Node `>=18`; module/moduleResolution `Node16`; `"type":"module"` — **relative imports carry `.js`**.
- **stdout is the MCP transport** — never `console.log`; stderr only (`console.error`).
- Pure Node built-ins for networking; no runtime deps beyond the SDK + zod.
- Naming: npm `@abhishekmcp/http`, binary `mcp-http`, dir `servers/http/`, tag `http-v<semver>`, description starts "MCP server for …". `package.json` needs `publishConfig {access:"public", provenance:true}`, `repository.directory:"servers/http"`, `mcpName:"io.github.Abhishekkumar2021/http"`.
- Every tool: `title`, `description`, Zod `inputSchema`; `delete_*` set `annotations:{destructiveHint:true}`.
- **Security:** `HTTP_ALLOW_HOSTS` is required (server refuses to serve without it). Every request + every redirect hop must pass host allowlist AND resolved-IP validation (private/loopback/link-local/metadata blocked unless `HTTP_ALLOW_PRIVATE=1`). Mutating methods (POST/PUT/PATCH/DELETE) refused unless `HTTP_WRITABLE=1`. Secrets (`HTTP_SECRET_*`) never on disk; `redact()` applied to all output + logs.
- Defaults: `HTTP_MAX_RESPONSE_BYTES=1048576`, `HTTP_TIMEOUT_MS=30000`, `HTTP_MAX_REDIRECTS=5`, `HTTP_DIR=~/.mcp-http`.
- Tests are `node:test` `.test.mjs` under `servers/http/test/`, hermetic (a local `127.0.0.1` server fixture; tests set `HTTP_ALLOW_HOSTS=127.0.0.1` + `HTTP_ALLOW_PRIVATE=1`). Run by root `npm test --workspaces`.

---

### Task 1: Scaffold + config + errors

**Files:**
- Create: `servers/http/package.json`, `servers/http/tsconfig.json`, `servers/http/src/config.ts`, `servers/http/src/errors.ts`
- Test: `servers/http/test/config.test.mjs`

**Interfaces:**
- Produces (`config.ts`): `VERSION:string`; `allowHosts():string[]` (parsed from `HTTP_ALLOW_HOSTS`, `[]` if unset); `hasAllowHosts():boolean`; `isWritable():boolean`; `allowPrivate():boolean`; `storeDir():string`; `secret(name:string):string|undefined`; `limits():{maxResponseBytes:number;timeoutMs:number;maxRedirects:number}`; `getAuditLogPath():string|undefined`.
- Produces (`errors.ts`): `class HttpError extends Error` with `code:string`; subclasses `HostNotAllowed`, `PrivateAddressBlocked`, `NotWritable`, `RequestTimeout`, `TooManyRedirects`, `RequestNotFound`, `EnvironmentNotFound`, `InvalidName`, `UnsupportedScheme`, `MissingVariable`.

- [ ] **Step 1: Create `servers/http/package.json`**

```json
{
  "name": "@abhishekmcp/http",
  "version": "0.1.0",
  "description": "MCP server for HTTP/REST APIs — ad-hoc requests plus saved collections and environments, with a required host allowlist and SSRF protection, from any MCP client.",
  "mcpName": "io.github.Abhishekkumar2021/http",
  "type": "module",
  "bin": { "mcp-http": "dist/index.js" },
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
  "keywords": ["mcp", "modelcontextprotocol", "http", "rest", "api", "claude"],
  "author": "Abhishek (https://github.com/Abhishekkumar2021)",
  "license": "MIT",
  "homepage": "https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/http#readme",
  "repository": { "type": "git", "url": "git+https://github.com/Abhishekkumar2021/mcp-suite.git", "directory": "servers/http" },
  "bugs": { "url": "https://github.com/Abhishekkumar2021/mcp-suite/issues" },
  "engines": { "node": ">=18" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `servers/http/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `servers/http/src/errors.ts`**

```ts
/** Typed errors mapped to actionable tool text in index.ts. */
export class HttpError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}
export class HostNotAllowed extends HttpError {
  constructor(host: string) {
    super("HostNotAllowed", `host '${host}' is not in HTTP_ALLOW_HOSTS`);
  }
}
export class PrivateAddressBlocked extends HttpError {
  constructor(host: string, addrs: string[]) {
    super("PrivateAddressBlocked", `host '${host}' resolves to a blocked address (${addrs.join(", ")}); set HTTP_ALLOW_PRIVATE=1 to allow private/loopback targets`);
  }
}
export class NotWritable extends HttpError {
  constructor(method: string) {
    super("NotWritable", `method ${method} is disabled; set HTTP_WRITABLE=1 to enable mutating requests`);
  }
}
export class RequestTimeout extends HttpError {
  constructor(ms: number) { super("RequestTimeout", `request timed out after ${ms}ms`); }
}
export class TooManyRedirects extends HttpError {
  constructor(max: number) { super("TooManyRedirects", `exceeded HTTP_MAX_REDIRECTS (${max})`); }
}
export class RequestNotFound extends HttpError {
  constructor(c: string, n: string) { super("RequestNotFound", `no saved request '${n}' in collection '${c}'`); }
}
export class EnvironmentNotFound extends HttpError {
  constructor(n: string) { super("EnvironmentNotFound", `no environment '${n}'`); }
}
export class InvalidName extends HttpError {
  constructor(n: string) { super("InvalidName", `invalid name '${n}' (use letters, digits, dash, underscore, dot; no path separators)`); }
}
export class UnsupportedScheme extends HttpError {
  constructor(s: string) { super("UnsupportedScheme", `unsupported URL scheme '${s}' (only http/https)`); }
}
export class MissingVariable extends HttpError {
  constructor(kind: string, name: string) { super("MissingVariable", `${kind} '${name}' is not set`); }
}
```

- [ ] **Step 4: Create `servers/http/src/config.ts`**

```ts
import { homedir } from "node:os";
import path from "node:path";

export const VERSION = "0.1.0";

export function allowHosts(): string[] {
  return (process.env.HTTP_ALLOW_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
export function hasAllowHosts(): boolean {
  return allowHosts().length > 0;
}

function flag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true";
}
export function isWritable(): boolean { return flag("HTTP_WRITABLE"); }
export function allowPrivate(): boolean { return flag("HTTP_ALLOW_PRIVATE"); }

export function storeDir(): string {
  return process.env.HTTP_DIR?.trim() || path.join(homedir(), ".mcp-http");
}

export function secret(name: string): string | undefined {
  return process.env[`HTTP_SECRET_${name}`];
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
export function limits() {
  return {
    maxResponseBytes: intEnv("HTTP_MAX_RESPONSE_BYTES", 1048576),
    timeoutMs: intEnv("HTTP_TIMEOUT_MS", 30000),
    maxRedirects: intEnv("HTTP_MAX_REDIRECTS", 5),
  };
}
export function getAuditLogPath(): string | undefined {
  return process.env.HTTP_AUDIT_LOG?.trim() || undefined;
}
```

- [ ] **Step 5: Register workspace + build**

Run: `cd /Users/abhishek/Dev/mcp-suite && npm install && npm run build -w servers/http`
Expected: workspace links; `tsc` clean.

- [ ] **Step 6: Write `servers/http/test/config.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowHosts, hasAllowHosts, isWritable, allowPrivate, limits, secret } from "../dist/config.js";

test("allowHosts parses + lowercases", () => {
  process.env.HTTP_ALLOW_HOSTS = "API.github.com, *.example.com";
  assert.deepEqual(allowHosts(), ["api.github.com", "*.example.com"]);
  assert.equal(hasAllowHosts(), true);
  delete process.env.HTTP_ALLOW_HOSTS;
  assert.equal(hasAllowHosts(), false);
});

test("flags + limits defaults", () => {
  delete process.env.HTTP_WRITABLE; delete process.env.HTTP_ALLOW_PRIVATE;
  assert.equal(isWritable(), false);
  assert.equal(allowPrivate(), false);
  const l = limits();
  assert.equal(l.maxResponseBytes, 1048576);
  assert.equal(l.timeoutMs, 30000);
  assert.equal(l.maxRedirects, 5);
});

test("secret reads HTTP_SECRET_<name>", () => {
  process.env.HTTP_SECRET_tok = "abc";
  assert.equal(secret("tok"), "abc");
  delete process.env.HTTP_SECRET_tok;
});
```

- [ ] **Step 7: Run tests**

Run: `npm test -w servers/http`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add servers/http/package.json servers/http/tsconfig.json servers/http/src/config.ts servers/http/src/errors.ts servers/http/test/config.test.mjs package-lock.json
git commit -m "feat(http): scaffold workspace + config + typed errors"
```

---

### Task 2: SSRF guard (host allowlist + IP classification + lookup)

**Files:**
- Create: `servers/http/src/ssrf.ts`
- Test: `servers/http/test/ssrf.test.mjs`

**Interfaces:**
- Consumes: `allowHosts`, `allowPrivate` (config.ts); `HostNotAllowed`, `PrivateAddressBlocked` (errors.ts).
- Produces:
  - `hostAllowed(host:string):boolean` — exact or `*.suffix` wildcard match (case-insensitive; wildcard matches ≥1 leading label, not apex).
  - `assertHostAllowed(host:string):void` — throws `HostNotAllowed` if not.
  - `classifyIp(ip:string):string|null` — returns a reason string if the IP is loopback/private/link-local/ULA/CGNAT/metadata/unspecified, else `null`.
  - `makeLookup():(hostname:string, options:any, cb:Function)=>void` — a `node:dns`-based `lookup` that resolves all addresses, keeps only allowed ones (all, if `allowPrivate()`), and errors `PrivateAddressBlocked` if none remain; pins the connection to a validated IP.

- [ ] **Step 1: Write `servers/http/test/ssrf.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { hostAllowed, classifyIp } from "../dist/ssrf.js";

test("hostAllowed exact + wildcard", () => {
  process.env.HTTP_ALLOW_HOSTS = "api.github.com,*.example.com";
  assert.equal(hostAllowed("api.github.com"), true);
  assert.equal(hostAllowed("API.GitHub.com"), true);
  assert.equal(hostAllowed("a.example.com"), true);
  assert.equal(hostAllowed("a.b.example.com"), true);
  assert.equal(hostAllowed("example.com"), false); // apex not matched by *.example.com
  assert.equal(hostAllowed("evil.com"), false);
  delete process.env.HTTP_ALLOW_HOSTS;
});

test("classifyIp flags dangerous ranges, allows public", () => {
  assert.equal(classifyIp("8.8.8.8"), null);
  assert.equal(classifyIp("1.1.1.1"), null);
  assert.ok(classifyIp("127.0.0.1"));
  assert.ok(classifyIp("10.0.0.5"));
  assert.ok(classifyIp("192.168.1.1"));
  assert.ok(classifyIp("172.16.0.1"));
  assert.ok(classifyIp("169.254.169.254")); // cloud metadata
  assert.ok(classifyIp("100.64.0.1"));       // CGNAT
  assert.ok(classifyIp("::1"));
  assert.ok(classifyIp("fe80::1"));
  assert.ok(classifyIp("fc00::1"));
  assert.ok(classifyIp("::ffff:127.0.0.1")); // v4-mapped loopback
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/http`
Expected: FAIL — `Cannot find module '../dist/ssrf.js'`.

- [ ] **Step 3: Create `servers/http/src/ssrf.ts`**

```ts
import dns from "node:dns";
import net from "node:net";
import { allowHosts, allowPrivate } from "./config.js";
import { HostNotAllowed, PrivateAddressBlocked } from "./errors.js";

export function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  for (const pat of allowHosts()) {
    if (pat.startsWith("*.")) {
      const suffix = pat.slice(1); // ".example.com"
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    } else if (h === pat) {
      return true;
    }
  }
  return false;
}

export function assertHostAllowed(host: string): void {
  if (!hostAllowed(host)) throw new HostNotAllowed(host);
}

/** Return a reason string if `ip` is in a blocked range, else null. */
export function classifyIp(ip: string): string | null {
  const fam = net.isIP(ip);
  if (fam === 4) return classifyV4(ip);
  if (fam === 6) return classifyV6(ip.toLowerCase());
  return "unrecognized address";
}

function classifyV4(ip: string): string | null {
  const p = ip.split(".").map(Number);
  const [a, b] = p;
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local/metadata";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT";
  return null;
}

function classifyV6(ip: string): string | null {
  if (ip === "::1") return "loopback";
  if (ip === "::" ) return "unspecified";
  // IPv4-mapped (::ffff:a.b.c.d) — classify the embedded v4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyV4(mapped[1]);
  if (ip.startsWith("fe80")) return "link-local";
  if (ip.startsWith("fc") || ip.startsWith("fd")) return "unique-local";
  return null;
}

/** A node:http `lookup` that only ever yields validated IPs (pinned). */
export function makeLookup() {
  return (hostname: string, options: any, cb: any) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [addresses];
      const ok = allowPrivate() ? list : list.filter((a: any) => classifyIp(a.address) === null);
      if (ok.length === 0) {
        return cb(new PrivateAddressBlocked(hostname, list.map((a: any) => a.address)));
      }
      if (options && options.all) return cb(null, ok);
      cb(null, ok[0].address, ok[0].family);
    });
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/http`
Expected: PASS (config + ssrf).

- [ ] **Step 5: Commit**

```bash
git add servers/http/src/ssrf.ts servers/http/test/ssrf.test.mjs
git commit -m "feat(http): SSRF guard — host allowlist + IP classification + pinned lookup"
```

---

### Task 3: Variables + secrets + redaction

**Files:**
- Create: `servers/http/src/vars.ts`
- Test: `servers/http/test/vars.test.mjs`

**Interfaces:**
- Consumes: `secret` (config.ts); `MissingVariable` (errors.ts).
- Produces:
  - `substitute(text:string, vars:Record<string,string>):string` — expands `${secret.<name>}` (from `HTTP_SECRET_*`) and `${<var>}` (from `vars`); throws `MissingVariable` for an unresolved reference.
  - `collectSecretValues(text:string):string[]` — the resolved secret values referenced in `text` (used to redact them from output).
  - `redact(s:string, extra?:string[]):string` — masks provided secret values, `authorization`/`cookie`/`set-cookie`/`x-api-key`/`x-auth-token` header lines, and `token`/`key`/`secret` query-param values.

- [ ] **Step 1: Write `servers/http/test/vars.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { substitute, redact } from "../dist/vars.js";

test("substitute expands vars and secrets", () => {
  process.env.HTTP_SECRET_tok = "s3cr3t";
  const out = substitute("${base}/users?key=${secret.tok}", { base: "https://api.x" });
  assert.equal(out, "https://api.x/users?key=s3cr3t");
  delete process.env.HTTP_SECRET_tok;
});

test("substitute throws on missing reference", () => {
  assert.throws(() => substitute("${nope}", {}), /MissingVariable/);
  assert.throws(() => substitute("${secret.absent}", {}), /MissingVariable/);
});

test("redact masks secret values and auth", () => {
  const out = redact("Authorization: Bearer s3cr3t\nx=s3cr3t", ["s3cr3t"]);
  assert.ok(!out.includes("s3cr3t"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/http`
Expected: FAIL — `Cannot find module '../dist/vars.js'`.

- [ ] **Step 3: Create `servers/http/src/vars.ts`**

```ts
import { secret } from "./config.js";
import { MissingVariable } from "./errors.js";

const REF = /\$\{(secret\.([A-Za-z0-9_]+)|([A-Za-z0-9_]+))\}/g;

export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(REF, (_m, _whole, secretName?: string, varName?: string) => {
    if (secretName) {
      const v = secret(secretName);
      if (v === undefined) throw new MissingVariable("secret", secretName);
      return v;
    }
    const v = vars[varName as string];
    if (v === undefined) throw new MissingVariable("variable", varName as string);
    return v;
  });
}

export function collectSecretValues(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(REF)) {
    if (m[2]) {
      const v = secret(m[2]);
      if (v) out.push(v);
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redact(s: string, extra: string[] = []): string {
  let out = s;
  for (const val of extra) {
    if (val && val.length >= 4) out = out.replace(new RegExp(escapeRe(val), "g"), "***");
  }
  // Header lines
  out = out.replace(/((?:authorization|cookie|set-cookie|x-api-key|x-auth-token)\s*[:=]\s*)(\S+)/gi, "$1***");
  // Query params
  out = out.replace(/([?&](?:token|key|secret|access_token|api_key)=)[^&\s]+/gi, "$1***");
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/http`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servers/http/src/vars.ts servers/http/test/vars.test.mjs
git commit -m "feat(http): variable/secret substitution + redaction"
```

---

### Task 4: Store (collections + environments)

**Files:**
- Create: `servers/http/src/store.ts`
- Test: `servers/http/test/store.test.mjs`

**Interfaces:**
- Consumes: `storeDir` (config.ts); `InvalidName`, `RequestNotFound`, `EnvironmentNotFound` (errors.ts).
- Produces types + functions:
  - `interface RequestDef { method: string; url: string; headers?: Record<string,string>; query?: Record<string,string>; body?: string }`
  - `saveRequest(collection:string, name:string, def:RequestDef):void`
  - `getRequest(collection:string, name:string):RequestDef`
  - `deleteRequest(collection:string, name:string):void`
  - `listRequests(collection?:string):{collection:string; name:string; method:string; url:string}[]`
  - `listCollections():string[]`
  - `setEnvironment(name:string, vars:Record<string,string>):void`
  - `getEnvironment(name:string):Record<string,string>`
  - `deleteEnvironment(name:string):void`
  - `listEnvironments():string[]`

- [ ] **Step 1: Write `servers/http/test/store.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

async function freshDir() {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), "httpmcp-"));
  process.env.HTTP_DIR = d;
  return d;
}

test("request CRUD round-trip", async () => {
  await freshDir();
  const store = await import(`../dist/store.js?${Date.now()}`);
  store.saveRequest("gh", "me", { method: "GET", url: "https://api.github.com/user" });
  assert.deepEqual(store.getRequest("gh", "me").url, "https://api.github.com/user");
  assert.equal(store.listRequests("gh").length, 1);
  assert.deepEqual(store.listCollections(), ["gh"]);
  store.deleteRequest("gh", "me");
  assert.equal(store.listRequests("gh").length, 0);
});

test("environment CRUD + name validation", async () => {
  await freshDir();
  const store = await import(`../dist/store.js?${Date.now()}`);
  store.setEnvironment("prod", { base: "https://api.x" });
  assert.equal(store.getEnvironment("prod").base, "https://api.x");
  assert.deepEqual(store.listEnvironments(), ["prod"]);
  assert.throws(() => store.setEnvironment("../evil", {}), /InvalidName/);
  assert.throws(() => store.getRequest("gh", "nope"), /RequestNotFound/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/http`
Expected: FAIL — `Cannot find module '../dist/store.js'`.

- [ ] **Step 3: Create `servers/http/src/store.ts`**

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storeDir } from "./config.js";
import { EnvironmentNotFound, InvalidName, RequestNotFound } from "./errors.js";

export interface RequestDef {
  method: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;
function validateName(name: string): string {
  if (!NAME_RE.test(name) || name === "." || name === "..") throw new InvalidName(name);
  return name;
}

function dir(kind: "collections" | "environments"): string {
  const d = path.join(storeDir(), kind);
  mkdirSync(d, { recursive: true });
  return d;
}
function fileFor(kind: "collections" | "environments", name: string): string {
  return path.join(dir(kind), `${validateName(name)}.json`);
}
function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}
function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
function listNames(kind: "collections" | "environments"): string[] {
  const d = dir(kind);
  return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

type Collection = { requests: Record<string, RequestDef> };

export function saveRequest(collection: string, name: string, def: RequestDef): void {
  const file = fileFor("collections", collection);
  const col = readJson<Collection>(file) ?? { requests: {} };
  col.requests[validateName(name)] = def;
  writeJson(file, col);
}
export function getRequest(collection: string, name: string): RequestDef {
  const col = readJson<Collection>(fileFor("collections", collection));
  const def = col?.requests[name];
  if (!def) throw new RequestNotFound(collection, name);
  return def;
}
export function deleteRequest(collection: string, name: string): void {
  const file = fileFor("collections", collection);
  const col = readJson<Collection>(file);
  if (!col || !col.requests[name]) throw new RequestNotFound(collection, name);
  delete col.requests[name];
  writeJson(file, col);
}
export function listRequests(collection?: string): { collection: string; name: string; method: string; url: string }[] {
  const cols = collection ? [validateName(collection)] : listCollections();
  const out: { collection: string; name: string; method: string; url: string }[] = [];
  for (const c of cols) {
    const col = readJson<Collection>(fileFor("collections", c));
    if (!col) continue;
    for (const [name, def] of Object.entries(col.requests)) {
      out.push({ collection: c, name, method: def.method, url: def.url });
    }
  }
  return out;
}
export function listCollections(): string[] {
  return listNames("collections");
}

type Environment = { vars: Record<string, string> };

export function setEnvironment(name: string, vars: Record<string, string>): void {
  writeJson(fileFor("environments", name), { vars } satisfies Environment);
}
export function getEnvironment(name: string): Record<string, string> {
  const env = readJson<Environment>(fileFor("environments", name));
  if (!env) throw new EnvironmentNotFound(name);
  return env.vars;
}
export function deleteEnvironment(name: string): void {
  const file = fileFor("environments", name);
  if (!existsSync(file)) throw new EnvironmentNotFound(name);
  rmSync(file);
}
export function listEnvironments(): string[] {
  return listNames("environments");
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/http`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servers/http/src/store.ts servers/http/test/store.test.mjs
git commit -m "feat(http): collections + environments store"
```

---

### Task 5: curl import/export

**Files:**
- Create: `servers/http/src/curl.ts`
- Test: `servers/http/test/curl.test.mjs`

**Interfaces:**
- Consumes: `RequestDef` (store.ts).
- Produces:
  - `parseCurl(cmd:string):RequestDef` — supports `-X/--request`, `-H/--header`, `-d/--data/--data-raw`, `-G`, URL as positional or `--url`; default method GET (POST if data present and no -X and not -G).
  - `toCurl(def:RequestDef, opts?:{maskSecrets?:boolean}):string` — render a `curl` command; when `maskSecrets`, replace `${secret.x}` placeholders with `***`.

- [ ] **Step 1: Write `servers/http/test/curl.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCurl, toCurl } from "../dist/curl.js";

test("parseCurl basic GET with header", () => {
  const def = parseCurl(`curl -H 'Accept: application/json' https://api.x/users`);
  assert.equal(def.method, "GET");
  assert.equal(def.url, "https://api.x/users");
  assert.equal(def.headers.Accept, "application/json");
});

test("parseCurl POST with data infers method", () => {
  const def = parseCurl(`curl -X POST --data '{"a":1}' https://api.x/create`);
  assert.equal(def.method, "POST");
  assert.equal(def.body, '{"a":1}');
});

test("toCurl masks secrets", () => {
  const s = toCurl({ method: "GET", url: "https://api.x?k=${secret.tok}" }, { maskSecrets: true });
  assert.ok(!s.includes("secret.tok"));
  assert.ok(s.includes("***"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/http`
Expected: FAIL — `Cannot find module '../dist/curl.js'`.

- [ ] **Step 3: Create `servers/http/src/curl.ts`**

```ts
import type { RequestDef } from "./store.js";

/** Tokenize a shell-ish curl string honoring single/double quotes. */
function tokenize(cmd: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function parseCurl(cmd: string): RequestDef {
  const toks = tokenize(cmd.trim());
  if (toks[0] === "curl") toks.shift();
  let method: string | undefined;
  let url: string | undefined;
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let get = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === "-X" || t === "--request") { method = toks[++i]?.toUpperCase(); }
    else if (t === "-H" || t === "--header") {
      const h = toks[++i] ?? "";
      const idx = h.indexOf(":");
      if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary") {
      body = toks[++i];
    } else if (t === "-G" || t === "--get") { get = true; }
    else if (t === "--url") { url = toks[++i]; }
    else if (!t.startsWith("-")) { url = t; }
  }
  if (!method) method = body && !get ? "POST" : "GET";
  return { method, url: url ?? "", ...(Object.keys(headers).length ? { headers } : {}), ...(body ? { body } : {}) };
}

export function toCurl(def: RequestDef, opts: { maskSecrets?: boolean } = {}): string {
  const mask = (s: string) => (opts.maskSecrets ? s.replace(/\$\{secret\.[A-Za-z0-9_]+\}/g, "***") : s);
  const parts = ["curl"];
  if (def.method && def.method !== "GET") parts.push("-X", def.method);
  for (const [k, v] of Object.entries(def.headers ?? {})) parts.push("-H", `'${mask(`${k}: ${v}`)}'`);
  if (def.body) parts.push("--data", `'${mask(def.body)}'`);
  parts.push(`'${mask(def.url)}'`);
  return parts.join(" ");
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/http`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servers/http/src/curl.ts servers/http/test/curl.test.mjs
git commit -m "feat(http): curl import/export"
```

---

### Task 6: SSRF-safe fetch engine + response formatting

**Files:**
- Create: `servers/http/src/client.ts`, `servers/http/src/format.ts`
- Test: `servers/http/test/client.test.mjs`

**Interfaces:**
- Consumes: `limits` (config.ts); `assertHostAllowed`, `makeLookup` (ssrf.ts); errors.
- Produces (`client.ts`):
  - `interface RawResponse { status:number; statusText:string; headers:Record<string,string>; bodyBuffer:Buffer; timingMs:number; finalUrl:string; redirects:string[] }`
  - `fetchSafe(input:{method:string; url:string; headers?:Record<string,string>; query?:Record<string,string>; body?:string}):Promise<RawResponse>` — enforces host allowlist + pinned validated IP + per-redirect re-validation (max `HTTP_MAX_REDIRECTS`), timeout, size cap (truncates), gzip/deflate/br decode.
- Produces (`format.ts`):
  - `interface ResponseView { status:number; statusText:string; headers:Record<string,string>; timingMs:number; body:string; truncated:boolean; finalUrl:string; redirects:string[] }`
  - `formatResponse(raw:RawResponse, secretValues:string[]):ResponseView` — redacts headers, pretty-prints JSON, decodes text, renders binary as `[N bytes, <content-type>]`.

- [ ] **Step 1: Write `servers/http/test/client.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

async function startServer(handler) {
  const srv = http.createServer(handler);
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  return { srv, port: srv.address().port };
}

test("fetchSafe GET returns body (private allowed for test)", async () => {
  process.env.HTTP_ALLOW_HOSTS = "127.0.0.1";
  process.env.HTTP_ALLOW_PRIVATE = "1";
  const { srv, port } = await startServer((req, res) => { res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
  const { fetchSafe } = await import(`../dist/client.js?${Date.now()}`);
  const r = await fetchSafe({ method: "GET", url: `http://127.0.0.1:${port}/x` });
  assert.equal(r.status, 200);
  assert.match(r.bodyBuffer.toString(), /ok/);
  srv.close();
  delete process.env.HTTP_ALLOW_HOSTS; delete process.env.HTTP_ALLOW_PRIVATE;
});

test("fetchSafe rejects non-allowlisted host", async () => {
  process.env.HTTP_ALLOW_HOSTS = "example.com";
  const { fetchSafe } = await import(`../dist/client.js?${Date.now()}`);
  await assert.rejects(fetchSafe({ method: "GET", url: "http://127.0.0.1:1/x" }), /HostNotAllowed/);
  delete process.env.HTTP_ALLOW_HOSTS;
});

test("fetchSafe blocks private IP without HTTP_ALLOW_PRIVATE", async () => {
  process.env.HTTP_ALLOW_HOSTS = "127.0.0.1";
  delete process.env.HTTP_ALLOW_PRIVATE;
  const { fetchSafe } = await import(`../dist/client.js?${Date.now()}`);
  await assert.rejects(fetchSafe({ method: "GET", url: "http://127.0.0.1:1/x" }), /PrivateAddressBlocked/);
  delete process.env.HTTP_ALLOW_HOSTS;
});

test("formatResponse pretty-prints JSON + redacts", async () => {
  const { formatResponse } = await import(`../dist/format.js?${Date.now()}`);
  const raw = { status: 200, statusText: "OK", headers: { authorization: "Bearer xyz", "content-type": "application/json" }, bodyBuffer: Buffer.from('{"a":1}'), timingMs: 1, finalUrl: "http://x", redirects: [] };
  const v = formatResponse(raw, []);
  assert.match(v.body, /"a": 1/);
  assert.equal(v.headers.authorization, "***");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w servers/http`
Expected: FAIL — `Cannot find module '../dist/client.js'`.

- [ ] **Step 3: Create `servers/http/src/client.ts`**

```ts
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { limits } from "./config.js";
import { assertHostAllowed, makeLookup } from "./ssrf.js";
import { RequestTimeout, TooManyRedirects, UnsupportedScheme } from "./errors.js";

export interface RawResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBuffer: Buffer;
  timingMs: number;
  finalUrl: string;
  redirects: string[];
}

interface Input {
  method: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
}

function withQuery(url: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}

function decode(buf: Buffer, encoding?: string): Buffer {
  try {
    if (encoding === "gzip") return zlib.gunzipSync(buf);
    if (encoding === "deflate") return zlib.inflateSync(buf);
    if (encoding === "br") return zlib.brotliDecompressSync(buf);
  } catch {
    return buf; // partial/truncated — return raw
  }
  return buf;
}

export async function fetchSafe(input: Input): Promise<RawResponse> {
  const { maxResponseBytes, timeoutMs, maxRedirects } = limits();
  const start = Date.now();
  const redirects: string[] = [];
  let current = withQuery(input.url, input.query);

  for (let hop = 0; ; hop++) {
    if (hop > maxRedirects) throw new TooManyRedirects(maxRedirects);
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsupportedScheme(u.protocol.replace(":", ""));
    assertHostAllowed(u.hostname);

    const mod = u.protocol === "https:" ? https : http;
    const res = await new Promise<{ statusCode: number; statusMessage: string; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
      const req = mod.request(
        u,
        { method: input.method, headers: input.headers, lookup: makeLookup() as any },
        (r) => {
          const chunks: Buffer[] = [];
          let total = 0;
          let truncated = false;
          r.on("data", (c: Buffer) => {
            total += c.length;
            if (total <= maxResponseBytes) chunks.push(c);
            else if (!truncated) { truncated = true; chunks.push(c.subarray(0, Math.max(0, maxResponseBytes - (total - c.length)))); r.destroy(); }
          });
          r.on("end", () => resolve({ statusCode: r.statusCode ?? 0, statusMessage: r.statusMessage ?? "", headers: r.headers as Record<string, string>, body: Buffer.concat(chunks) }));
          r.on("close", () => resolve({ statusCode: r.statusCode ?? 0, statusMessage: r.statusMessage ?? "", headers: r.headers as Record<string, string>, body: Buffer.concat(chunks) }));
        },
      );
      req.setTimeout(timeoutMs, () => { req.destroy(new RequestTimeout(timeoutMs)); });
      req.on("error", reject);
      if (input.body) req.write(input.body);
      req.end();
    });

    // Redirect?
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      redirects.push(current);
      current = new URL(res.headers.location, u).toString();
      continue;
    }

    const decoded = decode(res.body, (res.headers["content-encoding"] || "").toString().toLowerCase());
    return {
      status: res.statusCode,
      statusText: res.statusMessage,
      headers: res.headers,
      bodyBuffer: decoded,
      timingMs: Date.now() - start,
      finalUrl: current,
      redirects,
    };
  }
}
```

- [ ] **Step 4: Create `servers/http/src/format.ts`**

```ts
import type { RawResponse } from "./client.js";
import { redact } from "./vars.js";
import { limits } from "./config.js";

export interface ResponseView {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timingMs: number;
  body: string;
  truncated: boolean;
  finalUrl: string;
  redirects: string[];
}

const REDACT_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token"]);

function isTextual(ct: string): boolean {
  return /^text\/|application\/(json|xml|.*\+json|.*\+xml|x-www-form-urlencoded|javascript)/.test(ct);
}

export function formatResponse(raw: RawResponse, secretValues: string[]): ResponseView {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.headers)) {
    const val = Array.isArray(v) ? v.join(", ") : String(v);
    headers[k] = REDACT_HEADERS.has(k.toLowerCase()) ? "***" : redact(val, secretValues);
  }
  const ct = (raw.headers["content-type"] || "").toString().toLowerCase();
  const { maxResponseBytes } = limits();
  let body: string;
  let truncated = false;
  if (raw.bodyBuffer.length === 0) {
    body = "";
  } else if (isTextual(ct)) {
    let text = raw.bodyBuffer.toString("utf8");
    if (ct.includes("json")) {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* leave as-is */ }
    }
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) { text = text.slice(0, maxResponseBytes) + "…[truncated]"; truncated = true; }
    body = redact(text, secretValues);
  } else {
    body = `[${raw.bodyBuffer.length} bytes, ${ct || "unknown content-type"}]`;
  }
  return {
    status: raw.status,
    statusText: raw.statusText,
    headers,
    timingMs: raw.timingMs,
    body,
    truncated,
    finalUrl: redact(raw.finalUrl, secretValues),
    redirects: raw.redirects.map((r) => redact(r, secretValues)),
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -w servers/http`
Expected: PASS (config, ssrf, vars, store, curl, client).

- [ ] **Step 6: Commit**

```bash
git add servers/http/src/client.ts servers/http/src/format.ts servers/http/test/client.test.mjs
git commit -m "feat(http): SSRF-safe fetch engine + response formatting"
```

---

### Task 7: Server entrypoint + ad-hoc request tool + method gate + logging

**Files:**
- Create: `servers/http/src/log.ts`, `servers/http/src/index.ts`
- Test: `servers/http/test/server.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces (`log.ts`): `logInfo(msg:string, meta?:object):void`; `audit(entry:object):void` (to `HTTP_AUDIT_LOG`, redacted).
- Produces (`index.ts`): runnable stdio server. In this task register only `request`. `main()` refuses to serve if `!hasAllowHosts()` (logs a clear error to stderr and exits non-zero). A helper `assertMethodAllowed(method)` throws `NotWritable` for mutating methods unless `isWritable()`.

- [ ] **Step 1: Create `servers/http/src/log.ts`**

```ts
import { appendFileSync } from "node:fs";
import { getAuditLogPath } from "./config.js";
import { redact } from "./vars.js";

export function logInfo(msg: string, meta: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "info", msg, ...meta }));
}

export function audit(entry: Record<string, unknown>): void {
  const path = getAuditLogPath();
  if (!path) return;
  try {
    appendFileSync(path, redact(JSON.stringify({ ts: new Date().toISOString(), ...entry })) + "\n");
  } catch {
    /* auditing must never break a tool call */
  }
}
```

- [ ] **Step 2: Create `servers/http/src/index.ts` (entrypoint + `request`)**

```ts
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
```

- [ ] **Step 3: Build**

Run: `npm run build -w servers/http`
Expected: `tsc` clean.

- [ ] **Step 4: Write `servers/http/test/server.test.mjs`**

Use the stdio client pattern from `servers/git/test/git.test.mjs` plus a local server.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import readline from "node:readline";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function startServer(handler) {
  const srv = http.createServer(handler);
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  return { srv, port: srv.address().port };
}
function client(env) {
  const proc = spawn("node", [SERVER], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
  const rl = readline.createInterface({ input: proc.stdout });
  const pending = new Map();
  let id = 0;
  rl.on("line", (l) => { let m; try { m = JSON.parse(l); } catch { return; } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mid, method, params }) + "\n"); });
  const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return { send, notify, kill: () => proc.kill() };
}
async function connect(env) {
  const c = client(env);
  await c.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  c.notify("notifications/initialized", {});
  return c;
}

test("request works; mutating method gated off by default", async () => {
  const { srv, port } = await startServer((req, res) => { res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
  const c = await connect({ HTTP_ALLOW_HOSTS: "127.0.0.1", HTTP_ALLOW_PRIVATE: "1" });
  const ok = await c.send("tools/call", { name: "request", arguments: { method: "GET", url: `http://127.0.0.1:${port}/x` } });
  assert.match(ok.result.content[0].text, /"ok": true/);
  const gated = await c.send("tools/call", { name: "request", arguments: { method: "POST", url: `http://127.0.0.1:${port}/x`, body: "{}" } });
  assert.match(gated.result.content[0].text, /HTTP_WRITABLE/);
  c.kill(); srv.close();
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -w servers/http`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add servers/http/src/log.ts servers/http/src/index.ts servers/http/test/server.test.mjs
git commit -m "feat(http): server entrypoint + ad-hoc request tool + method gate"
```

---

### Task 8: Saved-request, environment, and curl tools

**Files:**
- Modify: `servers/http/src/index.ts` (add tools at the marker)
- Test: `servers/http/test/server-saved.test.mjs`

**Interfaces:**
- Consumes: store functions, `execute` (index.ts), `parseCurl`/`toCurl` (curl.ts).
- Produces tools: `run_request`, `save_request`, `list_requests`, `get_request`, `delete_request`, `list_collections`, `set_environment`, `get_environment`, `list_environments`, `delete_environment`, `import_curl`, `export_curl`.

- [ ] **Step 1: Add tools in `index.ts`** (replace the `// Task 8 registers…` comment)

```ts
import { saveRequest, getRequest, deleteRequest, listRequests, listCollections, setEnvironment, getEnvironment as getEnv, listEnvironments, deleteEnvironment } from "./store.js";
import { parseCurl, toCurl } from "./curl.js";

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
  async ({ name }) => { try { return json(getEnv(name)); } catch (err) { return fail(err); } },
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
```

- [ ] **Step 2: Build**

Run: `npm run build -w servers/http`
Expected: `tsc` clean.

- [ ] **Step 3: Write `servers/http/test/server-saved.test.mjs`**

Reuse the `client`/`connect`/`startServer` helpers from `server.test.mjs` (copy them in), plus set `HTTP_DIR` to a temp dir.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import readline from "node:readline";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
// ...copy startServer(), client(), connect() from server.test.mjs...

test("save + run a request round-trip", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "httpmcp-srv-"));
  const { srv, port } = await startServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(`{"path":"${req.url}"}`); });
  const c = await connect({ HTTP_ALLOW_HOSTS: "127.0.0.1", HTTP_ALLOW_PRIVATE: "1", HTTP_DIR: dir });
  await c.send("tools/call", { name: "set_environment", arguments: { name: "local", vars: { base: `http://127.0.0.1:${port}` } } });
  await c.send("tools/call", { name: "save_request", arguments: { collection: "demo", name: "ping", request: { method: "GET", url: "${base}/ping" } } });
  const run = await c.send("tools/call", { name: "run_request", arguments: { collection: "demo", name: "ping", environment: "local" } });
  assert.match(run.result.content[0].text, /\/ping/);
  const list = await c.send("tools/call", { name: "list_requests", arguments: {} });
  assert.match(list.result.content[0].text, /ping/);
  c.kill(); srv.close();
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -w servers/http`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add servers/http/src/index.ts servers/http/test/server-saved.test.mjs
git commit -m "feat(http): saved-request, environment, and curl tools"
```

---

### Task 9: Docs, distribution wiring, final verification

**Files:**
- Create: `servers/http/README.md`, `servers/http/CHANGELOG.md`, `servers/http/server.json`, `servers/http/mcpb/manifest.json`, `servers/http/scripts/build-mcpb.mjs`, `plugins/http/.mcp.json`, `plugins/http/.claude-plugin/plugin.json`, `plugins/http/README.md`
- Modify: root `README.md`, `CLAUDE.md`, `.claude-plugin/marketplace.json`

**Interfaces:** none (docs/packaging).

- [ ] **Step 1: MCPB build script** — `cp servers/git/scripts/build-mcpb.mjs servers/http/scripts/build-mcpb.mjs`, edit the header comment + `serverRoot` comment `git`→`http` (generic body uses `slug`).

- [ ] **Step 2: `servers/http/mcpb/manifest.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/anthropics/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json",
  "manifest_version": "0.4",
  "name": "http",
  "display_name": "HTTP",
  "version": "0.1.0",
  "description": "HTTP/REST client: ad-hoc requests plus saved collections and environments, with a required host allowlist and SSRF protection.",
  "author": { "name": "Abhishek", "url": "https://github.com/Abhishekkumar2021" },
  "homepage": "https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/http#readme",
  "documentation": "https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/http#readme",
  "repository": { "type": "git", "url": "https://github.com/Abhishekkumar2021/mcp-suite" },
  "license": "MIT",
  "keywords": ["http", "rest", "api", "client", "productivity"],
  "server": {
    "type": "node",
    "entry_point": "server/dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/dist/index.js"],
      "env": { "HTTP_ALLOW_HOSTS": "${user_config.allowHosts}", "HTTP_WRITABLE": "${user_config.writable}" }
    }
  },
  "user_config": {
    "allowHosts": { "type": "string", "title": "Allowed hosts", "description": "Comma-separated hosts the client may reach (exact or *.example.com). Required.", "required": true },
    "writable": { "type": "boolean", "title": "Enable writes", "description": "Allow POST/PUT/PATCH/DELETE.", "default": false, "required": false }
  },
  "compatibility": { "claude_desktop": ">=0.10.0", "platforms": ["darwin", "win32", "linux"] }
}
```

- [ ] **Step 3: `servers/http/README.md`** — mirror `servers/git/README.md` structure: intro; Tools (request, run_request, save/list/get/delete_request, list_collections, set/get/list/delete_environment, import_curl/export_curl; note mutating methods need `HTTP_WRITABLE`); Configuration table (all `HTTP_*` env from the spec — mark `HTTP_ALLOW_HOSTS` **required**); a "Security / SSRF" section (allowlist + private-IP block + per-redirect re-validation); Secrets/variables (`${secret.name}` from `HTTP_SECRET_*`, `${var}` from environments); Usage (plugin line; `claude mcp add http --env HTTP_ALLOW_HOSTS=api.github.com -- npx -y @abhishekmcp/http`; JSON block; MCPB line).

- [ ] **Step 4: `servers/http/CHANGELOG.md`**

```markdown
# Changelog — @abhishekmcp/http

All notable changes to this server. Format based on [Keep a Changelog](https://keepachangelog.com).

## 0.1.0 — Initial release
- HTTP/REST client MCP: ad-hoc `request` + saved collections/environments (`run_request`, save/list/get/delete_request, list_collections, set/get/list/delete_environment) + `import_curl`/`export_curl`.
- Security: required `HTTP_ALLOW_HOSTS` allowlist, resolved-IP validation (private/loopback/link-local/metadata blocked unless `HTTP_ALLOW_PRIVATE=1`), per-redirect re-validation, gated mutating methods (`HTTP_WRITABLE`).
- Secrets via `HTTP_SECRET_*` (`${secret.name}`), never on disk, redacted everywhere; env vars via `${var}`.
- Pure Node built-ins; response size cap, timeout, gzip/deflate/br decode.
```

- [ ] **Step 5: `servers/http/server.json`** — copy `servers/git/server.json` shape (schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`). name `io.github.Abhishekkumar2021/http`, title "HTTP", **description ≤100 chars** (e.g. "HTTP/REST client with saved collections, env secrets, and SSRF-safe host allowlisting."), version 0.1.0, npm `@abhishekmcp/http`. environmentVariables: `HTTP_ALLOW_HOSTS` (isRequired true), `HTTP_WRITABLE` (optional).

- [ ] **Step 6: Plugin** — copy `plugins/git/` → `plugins/http/`; edit `plugin.json` (name/description/keywords) and `.mcp.json`:
```json
{ "mcpServers": { "http": { "command": "npx", "args": ["-y", "@abhishekmcp/http"], "env": { "HTTP_ALLOW_HOSTS": "${HTTP_ALLOW_HOSTS}", "HTTP_WRITABLE": "${HTTP_WRITABLE}" } } } }
```
Add an `http` entry to `.claude-plugin/marketplace.json` (source `./plugins/http`, category productivity, version 0.1.0, author same as others, one-line description).

- [ ] **Step 7: Root `README.md`** — add rows (match existing column formatting):
```
| [`http`](servers/http) | HTTP/REST client: ad-hoc requests + saved collections/environments, env secrets, host-allowlisted + SSRF-safe | ✅ Stable |
```
```
| [`http`](servers/http) | `/plugin install http` | `npx -y @abhishekmcp/http` | drag `http-*.mcpb` | `io.github.Abhishekkumar2021/http` |
```

- [ ] **Step 8: `CLAUDE.md`** — add a "## Server architecture: `http`" section (after `sql`): layered `config`/`errors`/`ssrf`/`vars`/`store`/`curl`/`client`/`format`/`index`; **required `HTTP_ALLOW_HOSTS`**; SSRF = allowlist + custom `lookup` that validates + pins the resolved IP + per-redirect re-check; secrets from `HTTP_SECRET_*` only (`${secret.name}`), env vars on disk (`${var}`); mutating methods gated by `HTTP_WRITABLE`; pure Node built-ins; hermetic tests via a local `127.0.0.1` fixture.

- [ ] **Step 9: Full verification**

Run:
```bash
npm run build
npm test --workspaces
npm run build:mcpb -w servers/http
```
Expected: all builds clean; every server's tests pass (report http's count); `dist-mcpb/http-0.1.0.mcpb` built + manifest validates. Then extract the bundle and boot the packaged server with `HTTP_ALLOW_HOSTS=127.0.0.1 HTTP_ALLOW_PRIVATE=1` against a local server, confirm `tools/list` lists `request` + the saved tools.

- [ ] **Step 10: Commit**

```bash
git add servers/http/README.md servers/http/CHANGELOG.md servers/http/server.json servers/http/mcpb/ servers/http/scripts/ plugins/http/ .claude-plugin/marketplace.json README.md CLAUDE.md
git commit -m "docs(http): README, distribution wiring, CLAUDE.md; ship v0.1.0"
```

---

## Self-Review

**Spec coverage:** config/env + required allowlist (T1), SSRF host+IP+lookup (T2), vars/secrets/redaction (T3), collections+environments store (T4), curl import/export (T5), SSRF-safe client + response formatting incl. size cap/redirect/gzip (T6), entrypoint + ad-hoc request + method gate + logging (T7), saved/env/curl tools (T8), docs/distribution/CLAUDE.md + final verification (T9). Non-goals (OpenAPI, OAuth flows, websockets) excluded.

**Placeholder scan:** No TBD/TODO; code steps carry complete code. T9 doc steps point at exact templates to copy (git's README/server.json/plugin) plus specific edits, with the machine-critical artifacts (manifest, CHANGELOG, table rows, .mcp.json) given verbatim.

**Type consistency:** `RequestDef` defined in T4 (store.ts) and consumed unchanged in T5/T7/T8; `RawResponse`→`ResponseView` from T6 used by T7; `fetchSafe`/`formatResponse`/`substitute`/`collectSecretValues`/`redact`/store fns referenced with the signatures defined in their tasks; `execute` defined+exported in T7, used in T8. `hostAllowed`/`assertHostAllowed`/`makeLookup`/`classifyIp` consistent between T2 and T6.

**Known nuance:** the size cap truncates the response body (sets `truncated`) rather than throwing; there is no `ResponseTooLarge` error (dropped from the plan intentionally — spec §4 says the stream aborts, §10 tests truncation). Redirect re-validation relies on `assertHostAllowed` per hop plus the pinned `lookup`; a redirect to a disallowed host throws `HostNotAllowed` mid-loop (surfaced by the `request` handler's catch).
