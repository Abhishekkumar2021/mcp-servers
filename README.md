<div align="center">

# 🧰 mcp-suite

**A collection of [Model Context Protocol](https://modelcontextprotocol.io) servers, built in TypeScript.**

[![CI](https://github.com/Abhishekkumar2021/mcp-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/Abhishekkumar2021/mcp-suite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-43853d.svg)](https://nodejs.org)

[![@abhishekmcp/notes](https://img.shields.io/npm/v/@abhishekmcp/notes?label=%40abhishekmcp%2Fnotes&color=cb3837&logo=npm)](https://www.npmjs.com/package/@abhishekmcp/notes)
[![@abhishekmcp/files](https://img.shields.io/npm/v/@abhishekmcp/files?label=%40abhishekmcp%2Ffiles&color=cb3837&logo=npm)](https://www.npmjs.com/package/@abhishekmcp/files)
[![@abhishekmcp/github](https://img.shields.io/npm/v/@abhishekmcp/github?label=%40abhishekmcp%2Fgithub&color=cb3837&logo=npm)](https://www.npmjs.com/package/@abhishekmcp/github)
[![@abhishekmcp/git](https://img.shields.io/npm/v/@abhishekmcp/git?label=%40abhishekmcp%2Fgit&color=cb3837&logo=npm)](https://www.npmjs.com/package/@abhishekmcp/git)

</div>

Each server lives in its own folder under [`servers/`](servers) and publishes to npm as an independent package, while sharing tooling through an npm workspace. Connect them to any MCP client — Claude Desktop, Claude Code, Cursor, and more.

## Table of contents

- [Servers](#servers)
- [Quickstart](#quickstart)
- [Install](#install)
- [Connecting to a client](#connecting-to-a-client)
- [Architecture & conventions](#architecture--conventions)
- [Development](#development)
- [Adding a new server](#adding-a-new-server)
- [Publishing](#publishing)
- [Contributing](#contributing)
- [License](#license)

## Servers

| Server | Description | Status |
|--------|-------------|--------|
| [`notes`](servers/notes) | Local markdown notes: ranked full-text **and semantic** search, tags, todos, a `[[wiki-link]]` knowledge graph, daily notes + templates, and slash-command workflows (prompts) | ✅ Stable |
| [`files`](servers/files) | Sandboxed local filesystem: read, glob + content search, token-efficient edits, copy/move, soft-delete trash, zip, checksums, and dedup | ✅ Stable |
| [`github`](servers/github) | GitHub: search repos/code/issues, read repos/issues/PRs/files, notifications, create issues — OAuth device flow or token | ✅ Stable |
| [`git`](servers/git) | Git: status, log, diff, file history, branches/tags, gated stage/commit, and remote clone/fetch/pull/push — pure-JS, no git binary | ✅ Stable |

_More on the way: a Spotify controller, and others._

## Quickstart

```bash
git clone https://github.com/Abhishekkumar2021/mcp-suite.git
cd mcp-suite
npm install      # installs deps for every workspace
npm run build    # builds every server
```

## Install

Every server ships through every common channel. For the **Claude Code plugin**, add the marketplace
once — `/plugin marketplace add Abhishekkumar2021/mcp-suite` — then install per the table. See each
server's README for full config.

| Server | Claude Code plugin | npm (any client) | Claude Desktop (MCPB) | MCP registry |
|--------|--------------------|------------------|-----------------------|--------------|
| [`notes`](servers/notes) | `/plugin install notes` | `npx -y @abhishekmcp/notes` | drag `notes-*.mcpb` from the [latest release](https://github.com/Abhishekkumar2021/mcp-suite/releases) | `io.github.Abhishekkumar2021/notes` |
| [`files`](servers/files) | `/plugin install files` | `npx -y @abhishekmcp/files` | drag `files-*.mcpb` | `io.github.Abhishekkumar2021/files` |
| [`github`](servers/github) | `/plugin install github` | `npx -y @abhishekmcp/github` | drag `github-*.mcpb` | `io.github.Abhishekkumar2021/github` |
| [`git`](servers/git) | `/plugin install git` | `npx -y @abhishekmcp/git` | drag `git-*.mcpb` | `io.github.Abhishekkumar2021/git` |

> `notes` defaults to `~/notes`; `files` **requires** `FS_ROOTS` (the directories it may touch). MCPB
> bundles install via Claude Desktop → Settings → Extensions.

## Connecting to a client

Each server's README has full configuration instructions. As an example, to use the **notes** server with Claude Code:

```bash
claude mcp add notes --env NOTES_DIR=$HOME/notes -- node "$(pwd)/servers/notes/dist/index.js"
```

Or with Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "notes": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-suite/servers/notes/dist/index.js"],
      "env": { "NOTES_DIR": "/absolute/path/to/your/notes" }
    }
  }
}
```

## Architecture & conventions

A few principles hold across every server:

- **Pure-JS, no native dependencies.** Servers run via `npx`/MCPB on any machine, so anything needing a
  native build is off-limits (e.g. `notes` uses MiniSearch + WebAssembly embeddings instead of SQLite;
  `files` uses `fast-glob` instead of ripgrep). `npm audit` stays clean.
- **Sandbox-first, layered design.** Each server keeps a thin `index.ts` (tool registration only) over
  focused modules, with a single security boundary every path must pass through (realpath-containment,
  symlink-escape rejection, atomic writes).
- **Token-efficient by default.** Pagination, head/tail/section reads, snippets, and compact graph refs
  keep tool output small.
- **Automated, hands-off releases.** A GitHub Release tagged `<server>-v<version>` publishes to **npm
  (with provenance), the official MCP registry, and attaches an MCPB bundle** — all via OIDC, no secrets.
- **Tested in CI.** Each server ships a committed `node:test` suite (unit + integration/security) run on
  every push.

## Development

This is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo.

```bash
npm install                      # install all workspace dependencies (run once at the root)
npm run build                    # build every server
npm run build -w servers/notes   # build a single server
npm test --workspaces --if-present  # run each server's test suite
npm run clean                    # remove all build output
```

## Adding a new server

1. Create `servers/<name>/` with its own `package.json` (unique npm `name`) and a `tsconfig.json` that `extends: "../../tsconfig.base.json"`.
2. Put source in `servers/<name>/src/`.
3. Run `npm install` at the root so the workspace picks it up.
4. Add a row to the [Servers](#servers) table above.

All servers follow the [naming standard](NAMING.md) (`@abhishekmcp/<slug>`). See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Publishing

Releases are automated. Cutting a GitHub Release tagged `<server>-v<version>` triggers
[`publish.yml`](.github/workflows/publish.yml), which — authenticated entirely via GitHub OIDC (no
`NPM_TOKEN`) — publishes the package to **npm with provenance**, registers it on the **official MCP
registry**, and **builds + attaches the MCPB bundle** to the release.

```bash
# bump servers/<name>/package.json, commit, then:
gh release create <name>-v<version> --title "<name> v<version>" --notes "…"
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Abhishek
