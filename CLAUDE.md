# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mcp-suite` is an npm-workspaces monorepo of independent [Model Context Protocol](https://modelcontextprotocol.io) servers written in TypeScript (ES modules). Each server in `servers/<slug>/` is its own npm package (`@abhishekmcp/<slug>`), versioned and published independently, but shares root tooling (`tsconfig.base.json`, `@types/node`, `typescript`).

## Commands

```bash
npm install                      # install deps for all workspaces (run once at root)
npm run build                    # build (tsc) every server
npm run build -w servers/notes   # build one server
npm run clean                    # rm -rf servers/*/dist
```

There is **no test runner or linter** configured. CI (`.github/workflows/ci.yml`) only runs `npm run build` across Node 18/20/22 — a clean `tsc` is the bar a change must clear. Verify servers with an ad-hoc stdio JSON-RPC smoke test: spawn `node servers/<slug>/dist/index.js` with the relevant env, write newline-delimited JSON-RPC to stdin (`initialize` → `notifications/initialized` → `tools/list` / `tools/call`), and parse responses from stdout line-by-line.

## Hard constraints

- **stdout is the MCP transport.** Never `console.log` from a server — log to **stderr** (`console.error`) only. A stray stdout write corrupts the protocol stream.
- **No native dependencies.** Servers run via `npx @abhishekmcp/<slug>`, so anything requiring a native build (e.g. `better-sqlite3`) is off-limits. Prefer pure-JS libraries. (The `notes` server deliberately uses MiniSearch instead of SQLite/FTS5, and hand-rolls its frontmatter parser to avoid `js-yaml`/npm-audit noise.)
- **Module resolution is `Node16` ESM** (`tsconfig.base.json`, `"type": "module"`). Relative imports must carry the `.js` extension even though the source is `.ts`.

## Naming standard (enforced — see NAMING.md)

Every server: npm name `@abhishekmcp/<slug>`, binary `mcp-<slug>`, directory `servers/<slug>/`, release tag `<slug>-v<semver>`, description starting `MCP server for …`. The slug is a short lowercase noun with no `mcp`/`server` in it. Each server's `package.json` needs `publishConfig: { access: "public", provenance: true }` and `repository.directory: "servers/<slug>"`.

## Publishing / CD (non-obvious)

Publishing is **release-driven**: creating a GitHub Release with a tag `<slug>-v<version>` triggers `.github/workflows/publish.yml`, which parses the slug from the tag and publishes that one package. Typical flow:

```bash
git commit ... && git push
gh release create notes-v0.2.0 --title "notes v0.2.0" --notes "..."
gh run watch <run-id> --exit-status
npm view @abhishekmcp/notes version   # confirm
```

Auth is **npm Trusted Publishing (OIDC)** — no `NPM_TOKEN`. Gotchas baked into the workflow (don't "fix" them):
- Do **not** set `registry-url` on `setup-node` — it writes an `.npmrc` token stub that shadows the OIDC exchange and 404s the publish.
- Provenance only works in CI; any manual `npm publish` needs `--provenance=false` plus a 2FA `--otp`.
- The OIDC trusted-publisher config on npmjs.com must match the workflow filename exactly (`publish.yml`) with a blank Environment, or it fails silently.

## Server architecture: `notes` (the reference implementation)

`servers/notes/src/` is layered; `index.ts` is thin and everything below it is pure logic. When adding features, follow this separation:

- **`config.ts`** — all env + limits in one place: `NOTES_DIR` (default `~/notes`), `NOTES_READONLY=1`, `NOTES_NO_CACHE=1`, `MAX_FILE_BYTES`, `INDEX_VERSION` (bump to force a full cache rebuild on upgrade), `INDEX_FILENAME` (`.notes-index.json`).
- **`fsutil.ts`** — the security boundary: `validateName` (rejects control chars/absolute paths), `resolveSafe` (lexical **and** realpath/symlink containment within the notes dir), size-guarded `readRaw`, `atomicWrite` (temp file + rename), `listNoteFiles`. All filesystem access goes through here.
- **`parse.ts`** — dependency-free markdown parsing: hand-rolled frontmatter reader plus `extractHeadings`/`extractSection`/`extractWikiLinks`/`extractTags`/`extractTodos`, composed by `parseNote`.
- **`store.ts`** — the engine. Holds an in-memory MiniSearch index + a `perNote` metadata map (title/tags/outLinks/mtime/size), and is the **single source of truth synced on every mutation**. On startup `buildIndex()` loads the `.notes-index.json` cache and does an **incremental diff** against disk (re-parse only new/changed by mtime+size, drop deleted), full-rebuilding only when the cache is missing/unreadable/version-bumped. All CRUD ops (`createNote`/`appendNote`/`deleteNote`/`moveNote`) update the index, graph metadata, and cache together. `moveNote` also rewrites `[[wiki-links]]` pointing at the moved note across the vault.
- **`graph.ts`** — read-only queries derived from `store`'s metadata (backlinks, neighbors/BFS, shortest path, related-by-shared-links+tags, overview, broken links). Returns compact node refs (name + title), never note bodies, to stay token-cheap.
- **`tokenizer.ts` / `embed.ts` / `semantic.ts`** (v0.3 semantic search) — pure-WASM, no native deps. `tokenizer.ts` is a hand-rolled BERT WordPiece tokenizer; `embed.ts` is a **lazy** singleton that `await import("onnxruntime-web")` (so startup never loads WASM) and downloads all-MiniLM-L6-v2 quantized (~23 MB) once to `getModelDir()`; `semantic.ts` is a vector store mirroring `store.ts`'s cache+incremental-sync pattern (`.notes-embeddings.json`), doing brute-force cosine + optional RRF hybrid fusion with `store.searchNotes`. The model is only ever touched when `semantic_search` runs; a download/load failure returns a clean tool error and never takes the server down.
- **`extras.ts` / `prompts.ts`** (v0.4 QoL + Prompts primitive) — `extras.ts` holds daily-note, template instantiation (`{{var}}` substitution), `renameTag` (rewrites frontmatter + inline `#hashtags` vault-wide via `store.updateNoteRaw`), and `unlinkedMentions`. `prompts.ts` builds messages for the three MCP **prompts** (`weekly_review`/`summarize_note`/`daily_standup`) registered via `server.registerPrompt` — the second server primitive in use after tools. Note: MCP **sampling** is deprecated (SEP-2577), so server-side LLM synthesis is intentionally avoided; retrieval tools return context for the calling model.

Two cross-cutting rules this server models for any future server:
- **Read/write tool split:** when `NOTES_READONLY=1`, `index.ts` simply does not register the mutating tools, so they're absent from `tools/list`. Mirror this for any server with side effects.
- **Index built before serving:** `main()` `await`s `buildIndex()` *before* `server.connect(transport)`.

## Server architecture: `files`

`servers/files/src/` follows the same layered, sandbox-first pattern as `notes`. The security core is
`sandbox.ts`: **all** paths go through `resolveInside` (lexical + realpath containment against the
`FS_ROOTS` set; rejects symlinks escaping the sandbox), writes/edits/deletes additionally refuse to act
through a symlink, and writes are atomic. Logic is split `read`/`search`/`edit`/`mutate`/`archive`;
`index.ts` is thin and omits write tools when `FS_READONLY` is set. Notable choices: **deletes are soft**
(moved to `.mcp-trash`, restorable); `edit_file`/`edit_lines` are token-efficient (unique find/replace,
hash-guarded line ranges, `dryRun` diffs); `unzip` is zip-slip protected; search is **pure-JS**
(`fast-glob` + streaming grep — ripgrep was rejected as native). **`FS_ROOTS` is required** (refuses to
boot without it); the MCP `roots` protocol is deprecated (SEP-2577) + buggy in Claude Code, so it's only
a best-effort augment after connect, never the sole source.

v0.2 hardening modules: `log.ts` (structured stderr + `FS_AUDIT_LOG` audit of mutations), `runtime.ts`
(`guard()` = concurrency semaphore + per-op timeout, wrapping every handler in `index.ts`), `encoding.ts`
(BOM + CRLF/LF preservation on edits; binary → clean error), `denylist.ts` (block-by-default secret
files + `.mcpignore` via the `ignore` dep; `FS_ALLOW_SECRETS=1` overrides). Tests are committed under
`servers/files/test/` (`node:test`, run by the CI **test** job via `npm test --workspaces`); reads/hash
stream rather than load whole files.

## Server architecture: `github`

`servers/github/src/` is the suite's first **auth/secrets** server (local stdio, `@octokit/rest`).
`auth.ts` is the centerpiece: a token resolution chain — env PAT → cached OAuth token (auto-refreshed)
→ **hand-rolled OAuth device flow** (request code → poll with `slow_down` handling → persist). Tokens
cache at `~/.config/mcp-github/auth.json` with `0600` perms and are **never logged**; device flow uses a
**public** client id (`GITHUB_CLIENT_ID`, no secret). `gh.ts` builds an Octokit per call with the
resolved token and returns trimmed (token-efficient) objects. `index.ts` registers ~16 tools; writes are
gated by `GITHUB_READONLY`; handlers map `NotAuthenticatedError`/Octokit errors to actionable text (incl.
rate-limit hints). No auth is required at startup. Device-flow polling is bounded (~50s) and resumable to
survive MCP tool-call timeouts. Tests mock global `fetch` for the device flow (CI-safe); real-API checks
are manual (need a token), like notes' semantic test.

v0.2 hardening: Octokit is built with the official `retry` + `throttling` plugins (`gh.ts`) + a
timeout `fetch` wrapper (`AbortSignal.timeout`) + `baseUrl` from `GITHUB_API_URL` (GHES); list tools
paginate to `MAX_ITEMS` (300) and report truncation. `log.ts` adds structured logging + `audit()` of
writes (`GITHUB_AUDIT_LOG`) and a `redact()` (strips token patterns) applied to all tool output. New
env: `GITHUB_TIMEOUT_MS`, `GITHUB_API_URL`, `GITHUB_AUDIT_LOG`.

## Server architecture: `git`

`servers/git/src/` wraps **isomorphic-git** (pure-JS; no `git` binary) behind the same sandbox pattern as
`files`: `sandbox.ts` `resolveRepo()` confines every `repo` arg to `GIT_ROOTS` (realpath containment).
`repo.ts` holds the isomorphic-git wrappers; notable gaps handled in-house — **no high-level diff** (built
via `git.walk()` over two trees + `diff.createPatch` per file, size-capped) and **no blame** (omitted).
`git_show` resolves a ref/short-oid via `resolveRef`→`expandOid`, and lists all files for a root commit.
Write tools (stage/unstage/commit/branch/checkout) are registered only when `GIT_WRITABLE=1`. Tests are
self-contained — they build a real repo with isomorphic-git itself, so no system git is needed in CI.
**v0.2** adds remote ops (`git_clone`/`git_fetch`/`git_pull`(FF)/`git_push` + read `list_remotes`) over
isomorphic-git's `http/node` client — **HTTPS only** (no SSH), gated by `GIT_WRITABLE`, token auth via
`GIT_TOKEN`/`GITHUB_TOKEN` (`onAuth`), errors mapped to auth/fast-forward hints with token `redact()`.
Remote tests are network → manual; CI covers gating + `list_remotes` + token resolution + redact.

## Distribution (per server)

Beyond npm, `notes` ships through several channels — keep them version-aligned when releasing:
- **Claude Code plugin:** root `.claude-plugin/marketplace.json` lists `plugins/notes/` (manifest + `.mcp.json`). The `.mcp.json` runs `npx -y @abhishekmcp/notes` with **no `env` block** — Claude Code's MCP config does NOT support bash `${VAR:-default}` expansion, so rely on the server's built-in `~/notes` default.
- **MCPB bundle:** **every** server ships one — `servers/<slug>/mcpb/manifest.json` + `npm run build:mcpb -w servers/<slug>` (each `scripts/build-mcpb.mjs` is the same generic pipeline: tsc → stage `dist` + a prod-only `node_modules` copied wholesale → `mcpb pack`; deps are copied, not esbuild-bundled, so module resolution matches a normal install — and so onnxruntime-web's `.wasm` in notes survives). Manifest `user_config` maps to each server's env (e.g. git → `GIT_ROOTS`/`GIT_WRITABLE`/`GIT_TOKEN`, github → `GITHUB_TOKEN`/`GITHUB_CLIENT_ID`/`GITHUB_READONLY`, with `sensitive: true` on tokens). Output `dist-mcpb/<slug>-<ver>.mcpb` is gitignored; attach to the GitHub release.
- **Official MCP registry:** `servers/notes/server.json` (name `io.github.Abhishekkumar2021/notes`). Requires `mcpName` in the **published** `package.json` (added in 0.4.1) and `mcp-publisher login github` (human OAuth) before `mcp-publisher publish`.
- **Skipped Smithery** on purpose — it's HTTP-container-only; this server is local-file stdio. Glama/mcp.so cover stdio discovery.

## Adding a new server

`servers/<slug>/` with its own `package.json` (`name`, `bin: { "mcp-<slug>": "dist/index.js" }`, `publishConfig`), a `tsconfig.json` that `extends: "../../tsconfig.base.json"`, source in `src/`, and a `README.md` documenting tools + config. Run `npm install` at root to link the workspace, then add a row to the Servers table in the root `README.md`. Give every tool a `title`, `description`, and Zod `inputSchema`; mark destructive tools with `annotations: { destructiveHint: true }`.
