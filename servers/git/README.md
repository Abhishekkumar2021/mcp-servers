# @abhishekmcp/git

A local Git [MCP](https://modelcontextprotocol.io) server: inspect and (optionally) modify Git
repositories on your machine. Built on **isomorphic-git** — a pure-JavaScript git implementation, so
**no `git` binary is required** and there are no native dependencies. Complements
[`@abhishekmcp/files`](https://www.npmjs.com/package/@abhishekmcp/files).

## Tools

**Read (always):**
- `git_status` — staged / unstaged / untracked + current branch
- `git_log` — commit history (optional ref, limit, file-path filter)
- `git_show` — a commit's metadata + changed files
- `git_diff` — unified diff: working tree vs HEAD, a ref vs working tree, or refA vs refB (optional single file)
- `git_file_history` — commits that touched a file
- `read_file_at` — a file's contents at a ref/commit
- `list_branches`, `list_tags`, `current_branch`, `search_log`

- `list_remotes` — configured remotes (name + URL)

**Write + remote (only when `GIT_WRITABLE=1`):**
- Local: `git_stage`, `git_unstage`, `git_commit` (author from git config or args), `git_create_branch`, `git_checkout`
- Remote (HTTPS): `git_clone`, `git_fetch`, `git_pull` (fast-forward), `git_push`

> **Remotes are HTTPS-only** (isomorphic-git has no SSH). Public clone/fetch work anonymously; private
> repos and push need a token (`GIT_TOKEN`). `git_pull` is fast-forward only. No blame. Diffs are computed
> in pure JS (size-capped).

## Configuration

| Variable | Required | Effect |
|----------|----------|--------|
| `GIT_ROOTS` | **yes** | Allowed repo root directories (comma-separated). The server refuses to start without it. |
| `GIT_WRITABLE` | no | `1`/`true` enables the write + remote tools. |
| `GIT_TOKEN` / `GITHUB_TOKEN` | no | PAT for HTTPS remote auth (private clone/fetch/pull/push). |
| `GIT_USERNAME` | no | Username for HTTPS basic auth (defaults to the token). |

Every `repo` argument is sandboxed to `GIT_ROOTS` (lexical + realpath containment; symlink escapes rejected).

## Usage

```bash
# Claude Code (plugin):  /plugin marketplace add Abhishekkumar2021/mcp-suite  →  /plugin install git
# Claude Code (manual):
claude mcp add git --env GIT_ROOTS=$HOME/code -- npx -y @abhishekmcp/git
```

```json
{
  "mcpServers": {
    "git": { "command": "npx", "args": ["-y", "@abhishekmcp/git"], "env": { "GIT_ROOTS": "/path/to/code" } }
  }
}
```

**Claude Desktop (MCPB):** drag `git-*.mcpb` from the [latest release](https://github.com/Abhishekkumar2021/mcp-suite/releases) into Settings → Extensions, then set the allowed repo root. Build it locally with `npm run build:mcpb -w servers/git`.

## License

MIT
