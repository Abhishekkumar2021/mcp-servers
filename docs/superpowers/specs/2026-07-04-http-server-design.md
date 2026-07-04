# Design — `http` server (@abhishekmcp/http)

**Status:** approved design, pre-implementation
**Date:** 2026-07-04
**Author:** Abhishek (with Claude)

An HTTP/REST client MCP server for the `mcp-suite` monorepo: make HTTP requests
to allowlisted hosts, with saved requests/collections + environments, env-based
secrets, and defense-first SSRF protection.

## 1. Goals & non-goals

**Goals**
- An ad-hoc `request` tool + a Postman-style saved-collections workflow (persist
  named requests + environments, run them with variable/secret substitution).
- **Safe by construction:** a required host allowlist, resolved-IP validation
  (no SSRF to internal/metadata endpoints), per-redirect re-validation, and
  gated mutating methods.
- Secrets never touch disk or output; only env-provided, redacted everywhere.
- Portable: pure Node built-ins (no runtime deps), so npm/npx, plugin, registry,
  and MCPB all work.

**Non-goals (v0.1)**
- OpenAPI / Swagger import (curl import/export only).
- GraphQL-specific helpers, WebSocket/SSE streaming, file-upload multipart beyond
  a raw body, cookie jars / session persistence.
- OAuth flows (a token is supplied via `HTTP_SECRET_*`; the server doesn't run
  auth dances — `github` covers device-flow OAuth if needed).

## 2. Dependency policy

Pure Node built-ins only (`node:http`, `node:https`, `node:dns`, `node:zlib`,
`node:net`). No runtime dependencies — the strongest fit for the suite's
"prefer pure-JS/WASM" policy and keeps the MCPB bundle fully portable.

## 3. Identity & distribution

- Slug `http`; npm `@abhishekmcp/http`; binary `mcp-http`; dir `servers/http/`;
  tag `http-v<semver>`; description starts "MCP server for …".
- `package.json`: `publishConfig {access:"public", provenance:true}`,
  `repository.directory:"servers/http"`, `mcpName:"io.github.Abhishekkumar2021/http"`.
- Channels: npm, Claude Code plugin (`plugins/http/`), MCP registry (`server.json`),
  MCPB (`mcpb/manifest.json` + generic `build:mcpb`).

## 4. Configuration (environment)

| Var | Required | Effect |
|-----|----------|--------|
| `HTTP_ALLOW_HOSTS` | **yes** | Comma-separated allowed hosts; exact (`api.github.com`) or wildcard (`*.example.com`). The server refuses to start without it. Every request + every redirect hop host must match. |
| `HTTP_ALLOW_PRIVATE` | no | `1`/`true` permits resolved loopback/private/link-local IPs (for localhost / internal APIs). Default off. |
| `HTTP_WRITABLE` | no | `1`/`true` enables mutating methods (POST/PUT/PATCH/DELETE). Default: only GET/HEAD/OPTIONS. |
| `HTTP_DIR` | no | Store dir for collections + environments. Default `~/.mcp-http`. |
| `HTTP_SECRET_<name>` | no | A secret value referenced in requests as `${secret.<name>}`. Never stored on disk; redacted from all output + logs. |
| `HTTP_MAX_RESPONSE_BYTES` | no | Response-body size cap (default `1048576` = 1 MB). Streaming aborts past it. |
| `HTTP_TIMEOUT_MS` | no | Per-request timeout (default `30000`). |
| `HTTP_MAX_REDIRECTS` | no | Max redirect hops, each re-validated (default `5`). |
| `HTTP_AUDIT_LOG` | no | Path to append a JSON-lines audit of requests (redacted). |

Wildcard rule: `*.example.com` matches one-or-more leading labels (`a.example.com`,
`a.b.example.com`) but NOT the apex `example.com` (list both if you want apex).
Matching is on the hostname only (case-insensitive); ports don't affect matching.

## 5. Architecture (`servers/http/src/`)

Layered, thin `index.ts`:

- `config.ts` — env parsing, limits, `VERSION`, `allowHosts()`, `isWritable()`,
  `allowPrivate()`, `storeDir()`, `secret(name)`.
- `ssrf.ts` — `hostAllowed(host)`; `classifyIp(ip)` (loopback/private/link-local/
  ULA/unique-local/`169.254.169.254`/`::1` etc.); `makeLookup()` — a `node:dns`
  `lookup` that resolves, validates **every** returned address, and returns only a
  validated IP (so the socket connects to the exact IP checked — no TOCTOU).
- `client.ts` — `fetchSafe(req)`: builds a `node:http`/`https` request with the
  validated `lookup`, follows redirects manually (re-running `hostAllowed` +
  lookup validation per hop, capped at `HTTP_MAX_REDIRECTS`), decompresses
  gzip/deflate/br (`node:zlib`), enforces timeout + streamed size-cap. Returns a
  raw response record `{status, statusText, headers, bodyBuffer, contentType,
  timingMs, redirects[]}`.
- `vars.ts` — `substitute(text, env)` expands `${var}` (from the environment's
  vars) and `${secret.name}` (from `HTTP_SECRET_*`); `redact(s)` masks secret
  values, `authorization`/`cookie`/`set-cookie`/`x-api-key` headers, and common
  token patterns.
- `store.ts` — collections + environments under `storeDir()`. `validateName`
  (no control chars / path separators / traversal); atomic writes (temp+rename);
  `collections/<name>.json` (`{requests: {<name>: RequestDef}}`),
  `environments/<name>.json` (`{vars: {<k>:<v>}}`). CRUD + listing.
- `curl.ts` — `parseCurl(str) → RequestDef` (method `-X`, `-H`, `-d`/`--data`,
  `--url`/positional, `-G`); `toCurl(def, {maskSecrets:true})`.
- `format.ts` — shape a response record for tool output: status + reason,
  redacted headers, `timingMs`, body (pretty-print JSON; decode text and truncate
  at the cap with a notice; binary → `[N bytes, <content-type>]`), redirect chain,
  final URL.
- `log.ts` — structured stderr `logInfo` + `audit()` (to `HTTP_AUDIT_LOG`, redacted).
- `index.ts` — tool registration; mutating-method gate in `request`/`run_request`;
  disk-CRUD tools always registered.

### Types
```ts
interface RequestDef {
  method: string;              // GET/POST/…
  url: string;                 // may contain ${var}/${secret.x}
  headers?: Record<string,string>;
  query?: Record<string,string>;
  body?: string;               // raw string; may contain placeholders
}
interface ResponseView {
  status: number; statusText: string;
  headers: Record<string,string>;      // redacted
  timingMs: number;
  body: string;                        // pretty/truncated, or a binary summary
  truncated: boolean;
  finalUrl: string;
  redirects: string[];                 // hop URLs
}
```

## 6. Tools (Rich)

**Requests**
- `request` — ad-hoc. Args: `method`, `url`, `headers?`, `query?`, `body?`,
  `environment?` (name, for `${var}` resolution). Mutating method → refused
  unless `HTTP_WRITABLE`.
- `run_request` — run a saved request. Args: `collection`, `name`,
  `environment?`, `overrides?` (partial `RequestDef`). Same method gate.

**Saved CRUD** (always available — local store writes, not network)
- `save_request` (`collection`, `name`, `request`: RequestDef)
- `list_requests` (`collection?`)
- `get_request` (`collection`, `name`)
- `delete_request` (`collection`, `name`)
- `list_collections`

**Environments** (on disk, non-secret vars only)
- `set_environment` (`name`, `vars`: object) — create/replace
- `get_environment` (`name`)
- `list_environments`
- `delete_environment` (`name`)

**curl**
- `import_curl` (`curl`: string, `collection?`, `name?`) — parse to a RequestDef;
  save if collection+name given, else return the definition.
- `export_curl` (`collection`, `name`) — render a saved request as a `curl`
  command with secret values masked.

Every tool: `title`, `description`, Zod `inputSchema`; `delete_*` set
`annotations:{destructiveHint:true}`.

## 7. SSRF enforcement (core safety property)

1. **Host allowlist** — the request host must match `HTTP_ALLOW_HOSTS` (exact or
   wildcard) or `HostNotAllowed`.
2. **Resolved-IP validation** — the custom `lookup` resolves the host and checks
   **every** candidate address against blocked ranges (loopback `127/8`+`::1`,
   private `10/8`,`172.16/12`,`192.168/16`, CGNAT `100.64/10`, link-local
   `169.254/16`+`fe80::/10` incl. `169.254.169.254`, ULA `fc00::/7`,
   unspecified/`::`); blocked unless `HTTP_ALLOW_PRIVATE=1` → `PrivateAddressBlocked`.
   The socket is pinned to the validated IP (no rebinding between check and connect).
3. **Per-hop re-validation** — redirects are followed manually; each hop re-runs
   steps 1–2, capped at `HTTP_MAX_REDIRECTS` → `TooManyRedirects`.
4. **Scheme** — only `http`/`https`.

## 8. Secrets & variables

`substitute()` expands `${var}` (from the named environment's on-disk vars) and
`${secret.name}` (from `HTTP_SECRET_*`, env only) into url/headers/body just
before sending. `redact()` is applied to every tool result, echoed request, and
audit line, masking: each configured secret's value, `authorization`/`cookie`/
`set-cookie`/`x-api-key`/`x-auth-token` header values, and `token`/`key`/`secret`
query params. Environments on disk never contain secrets.

## 9. Error handling

Typed errors mapped to actionable text in `index.ts`: `HostNotAllowed`,
`PrivateAddressBlocked`, `NotWritable`, `ResponseTooLarge`, `RequestTimeout`,
`TooManyRedirects`, `RequestNotFound`, `EnvironmentNotFound`, `InvalidName`,
`UnsupportedScheme`. All output passes through `redact()`.

## 10. Testing (committed `node:test`, CI — fully hermetic)

A local `node:http` server on `127.0.0.1` is the fixture (tests set
`HTTP_ALLOW_HOSTS=127.0.0.1` + `HTTP_ALLOW_PRIVATE=1`). No external network.

- **`ssrf.ts` (unit):** host allowlist (exact + wildcard + apex exclusion);
  `classifyIp` for representative addresses incl. `169.254.169.254`.
- **`vars.ts` (unit):** `${var}`/`${secret.x}` substitution; `redact()` masks
  secret values + auth headers.
- **`store.ts` (unit):** request/environment CRUD over a temp dir; `validateName`
  rejects traversal/separators.
- **`curl.ts` (unit):** parse a representative `curl` command; round-trip toCurl
  masks secrets.
- **`client.ts` + stdio (integration):** against the local server — GET returns
  body; gated POST is absent/refused without `HTTP_WRITABLE` and works with it;
  redirect is followed + re-validated (and a redirect to a disallowed host is
  refused); size cap truncates; timeout fires; gzip decodes; a request to a
  non-allowlisted host → `HostNotAllowed`; a request to `127.0.0.1` **without**
  `HTTP_ALLOW_PRIVATE` → `PrivateAddressBlocked`.

Verify end-to-end with the suite's stdio JSON-RPC smoke against the local server.

## 11. Repo housekeeping (part of this work)

- Add `servers/http/README.md`, `CHANGELOG.md`, `server.json`,
  `mcpb/manifest.json`, `scripts/build-mcpb.mjs`.
- Add `plugins/http/` (`.mcp.json` passing `${HTTP_ALLOW_HOSTS}`/`${HTTP_WRITABLE}`,
  `.claude-plugin/plugin.json`, README) + a `http` entry in
  `.claude-plugin/marketplace.json`.
- Add root README Servers + distribution rows.
- Add a "Server architecture: `http`" section to CLAUDE.md.

## 12. Build sequence (detail in the plan)

1. Scaffold + config → tsc clean.
2. `ssrf.ts` + tests.
3. `vars.ts` + tests.
4. `store.ts` + tests.
5. `curl.ts` + tests.
6. `client.ts` + `format.ts` + integration tests (local server).
7. `index.ts` (ad-hoc `request` + gate) + stdio test.
8. Saved-request + environment + curl tools + stdio test.
9. Docs + distribution wiring + final verification; ship v0.1.0.
