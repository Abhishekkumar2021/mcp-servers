# http (Claude Code plugin)

Installs the [`@abhishekmcp/http`](https://www.npmjs.com/package/@abhishekmcp/http) MCP server — an HTTP/REST
client that makes ad-hoc requests and runs **saved requests** (collections + per-environment variables and
secrets). Every request is confined to a **required host allowlist** and validated against SSRF. Pure Node
built-ins; no dependencies to compile.

## Install

```
/plugin marketplace add Abhishekkumar2021/mcp-suite
/plugin install http
```

## Required configuration

The server **refuses to start without `HTTP_ALLOW_HOSTS`** — the comma-separated hosts it may reach (exact,
e.g. `api.github.com`, or wildcard, e.g. `*.example.com`). Set it before launching Claude Code:

```bash
export HTTP_ALLOW_HOSTS="api.github.com"              # one host
export HTTP_ALLOW_HOSTS="api.github.com,*.example.com" # or several / wildcards
```

Mutating methods (`POST`/`PUT`/`PATCH`/`DELETE`) are **off by default** — enable with `HTTP_WRITABLE=1`.
Secrets are provided as `HTTP_SECRET_<name>` and referenced as `${secret.<name>}`; to reach `localhost`/internal
services set `HTTP_ALLOW_PRIVATE=1`. See the
[server README](https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/http#readme).
