# @abhishekmcp/http

An HTTP/REST client [MCP](https://modelcontextprotocol.io) server: make ad-hoc requests and run **saved
requests** organized into collections, with per-**environment** variables and secrets. Built on pure Node
built-ins (`node:http`/`node:https`/`node:dns`/`node:zlib`) — **no dependencies beyond the MCP SDK + Zod**,
nothing to compile.

Every request is confined to a **required host allowlist** and validated against **SSRF** (private,
loopback, link-local, and cloud-metadata addresses are refused). Reads (`GET`/`HEAD`/`OPTIONS`) are the
default; mutating methods (`POST`/`PUT`/`PATCH`/`DELETE`) are **off unless you opt in** with `HTTP_WRITABLE=1`.

## Tools

- `request` — make an ad-hoc HTTP request to an allowlisted host (supports `${var}` + `${secret.name}`)
- `run_request` — execute a saved request, resolving `${var}`/`${secret}` with optional field overrides
- `save_request` — persist a request definition into a collection
- `list_requests` — list saved requests (optionally within one collection)
- `get_request` — return a saved request definition
- `delete_request` — delete a saved request
- `list_collections` — list saved collections
- `set_environment` — create or replace an environment's (non-secret) variables
- `get_environment` — return an environment's variables
- `list_environments` — list environments
- `delete_environment` — delete an environment
- `import_curl` — parse a `curl` command into a request definition (saved if `collection`+`name` given)
- `export_curl` — render a saved request as a `curl` command (secrets masked)

> **Mutating methods** (`POST`/`PUT`/`PATCH`/`DELETE`) are refused unless `HTTP_WRITABLE=1`. `GET`/`HEAD`/`OPTIONS`
> always work. The gate applies to `request` and `run_request` alike (whatever method the saved request carries).

## Configuration

| Variable | Required | Default | Effect |
|----------|----------|---------|--------|
| `HTTP_ALLOW_HOSTS` | **yes** | — | Comma-separated hosts the client may reach. Exact (`api.github.com`) or wildcard (`*.example.com`). The server **refuses to start** without it. |
| `HTTP_WRITABLE` | no | `0` | `1`/`true` allows the mutating methods (`POST`/`PUT`/`PATCH`/`DELETE`). |
| `HTTP_ALLOW_PRIVATE` | no | `0` | `1`/`true` permits private/loopback/link-local IPs (for talking to `localhost`/internal services). **Off by default.** |
| `HTTP_SECRET_<name>` | no | — | Defines a secret referenced as `${secret.<name>}` in URLs/headers/body. Lives only in the environment — never written to disk, never returned, redacted in all output. |
| `HTTP_DIR` | no | `~/.mcp-http` | Directory for saved collections + environments (on-disk JSON). |
| `HTTP_MAX_RESPONSE_BYTES` | no | `1048576` (1 MB) | Response body size cap — the body is truncated (and flagged) past this. Also caps decompression output. |
| `HTTP_TIMEOUT_MS` | no | `30000` | Per-request timeout. |
| `HTTP_MAX_REDIRECTS` | no | `5` | Max redirects followed; **each hop is re-validated** against the allowlist + SSRF checks. |
| `HTTP_AUDIT_LOG` | no | — | Path to a JSON-lines file; each executed request (method/url/status) is appended (secrets redacted). |

## Security / SSRF

Requests are locked down at two layers:

1. **Host allowlist (required).** `HTTP_ALLOW_HOSTS` must be set or the server won't boot. A host matches if
   it equals an allowlist entry, or matches a `*.example.com` wildcard (the wildcard covers subdomains, not
   the bare apex). The target host of every request — and of **every redirect hop** — is checked.
2. **IP validation + pinning.** DNS names are resolved through a custom `lookup`; the **resolved IP** is
   validated and then **pinned** for the actual connection (so a name that passes the check can't be
   re-resolved to a different address — no TOCTOU rebind). Literal IPs in the URL (including bracketed IPv6,
   e.g. `http://[::1]/`) are validated directly. Private, loopback, link-local, unique-local, and
   cloud-metadata (`169.254.169.254`) ranges are **refused unless `HTTP_ALLOW_PRIVATE=1`**.

On a redirect, the new location is re-validated from scratch (allowlist + IP checks); a redirect to a
disallowed host or private IP fails the request rather than following it.

## Secrets & variables

- **Secrets** come **only** from the environment as `HTTP_SECRET_<name>` and are referenced as
  `${secret.<name>}` anywhere in a request (URL, headers, body). They are never persisted to disk, never
  returned in tool output, and are redacted from responses, `export_curl`, and the audit log.
- **Variables** are per-environment, non-secret values referenced as `${var}` (or `${name}`). They are stored
  on disk with the environment (`set_environment`) and resolved when a request runs with that `environment`.

```jsonc
// save a request that uses a secret + a var, then run it against an environment
save_request  { "collection": "gh", "name": "me",
                "request": { "method": "GET", "url": "https://api.github.com/user",
                             "headers": { "Authorization": "Bearer ${secret.gh_token}" } } }
set_environment { "name": "prod", "vars": { "base": "https://api.github.com" } }
run_request   { "collection": "gh", "name": "me", "environment": "prod" }
// with HTTP_SECRET_gh_token set in the environment
```

## Usage

```bash
# Claude Code (plugin):  /plugin marketplace add Abhishekkumar2021/mcp-suite  →  /plugin install http
# Claude Code (manual):
claude mcp add http --env HTTP_ALLOW_HOSTS=api.github.com -- npx -y @abhishekmcp/http
```

```json
{
  "mcpServers": {
    "http": {
      "command": "npx",
      "args": ["-y", "@abhishekmcp/http"],
      "env": {
        "HTTP_ALLOW_HOSTS": "api.github.com,*.example.com",
        "HTTP_WRITABLE": "0",
        "HTTP_SECRET_gh_token": "ghp_…"
      }
    }
  }
}
```

**Claude Desktop (MCPB):** drag `http-*.mcpb` from the [latest release](https://github.com/Abhishekkumar2021/mcp-suite/releases) into Settings → Extensions, then set the allowed hosts and, optionally, enable writes. Build it locally with `npm run build:mcpb -w servers/http`.

## License

MIT
