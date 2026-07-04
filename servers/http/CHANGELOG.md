# Changelog — @abhishekmcp/http

All notable changes to this server. Format based on [Keep a Changelog](https://keepachangelog.com).

## 0.1.0 — Initial release
- HTTP/REST client MCP: ad-hoc `request` + saved collections/environments (`run_request`, save/list/get/delete_request, list_collections, set/get/list/delete_environment) + `import_curl`/`export_curl`.
- Security: required `HTTP_ALLOW_HOSTS` allowlist, resolved-IP validation (private/loopback/link-local/metadata blocked unless `HTTP_ALLOW_PRIVATE=1`), per-redirect re-validation, gated mutating methods (`HTTP_WRITABLE`).
- Secrets via `HTTP_SECRET_*` (`${secret.name}`), never on disk, redacted everywhere; env vars via `${var}`.
- Pure Node built-ins; response size cap, timeout, gzip/deflate/br decode.
