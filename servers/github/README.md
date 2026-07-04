# @abhishekmcp/github

A GitHub [MCP](https://modelcontextprotocol.io) server: search, browse, and act on GitHub from any MCP
client. Authenticates via **OAuth device flow** (real OAuth, no hosted callback) or a **token**. Pure
JavaScript ([`@octokit/rest`](https://github.com/octokit/rest.js)), no native dependencies.

> GitHub ships an official, much larger MCP server. This is a focused, learning-oriented build that does
> auth/secrets handling cleanly.

## Tools

**Auth:** `github_login` (device flow), `github_logout`, `whoami`
**Search:** `search_repos`, `search_code`, `search_issues`
**Read:** `get_repo`, `list_issues`, `get_issue`, `list_pull_requests`, `get_pull_request`,
`get_file_contents`, `list_notifications`, `rate_limit`
**Write** (omitted when `GITHUB_READONLY=1`): `create_issue`, `add_issue_comment`

Responses are trimmed to the useful fields to stay token-efficient.

## Authentication

Resolved in this order (nothing is required at startup):

1. **Token** — `GITHUB_TOKEN` (or `GITHUB_PERSONAL_ACCESS_TOKEN`). A [Personal Access Token](https://github.com/settings/tokens); simplest path.
2. **Cached OAuth token** — from a previous `github_login`, stored at `~/.config/mcp-github/auth.json` (`0600`), auto-refreshed when possible.
3. Otherwise tools return a clear "run `github_login`" message.

### OAuth device flow (one-time setup)
Device flow needs a **public** OAuth-App client id (no secret):
1. Create a [GitHub OAuth App](https://github.com/settings/developers) and **enable Device Flow**.
2. `export GITHUB_CLIENT_ID=<client id>`.
3. Run `github_login` → open the printed URL, enter the code, then run `github_login` again to finish.

Tokens are cached locally with `0600` permissions and are never logged.

## Configuration

| Variable | Effect |
|----------|--------|
| `GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN` | Use this PAT (skips OAuth). |
| `GITHUB_CLIENT_ID` | OAuth App client id for the device-flow login. |
| `GITHUB_READONLY` | `1`/`true` → only read + auth tools are registered. |
| `GITHUB_API_URL` | REST base URL (default `https://api.github.com`); set for GitHub Enterprise Server. |
| `GITHUB_TIMEOUT_MS` | Per-request timeout (default 30000). |
| `GITHUB_AUDIT_LOG` | Path to append a JSON-lines audit record of every write (issue/comment). |

### Production hardening
Requests use the official retry + throttling plugins (auto-retry transient `5xx`, **proactively wait on
primary/secondary rate limits**) and a request timeout, so the server survives real GitHub conditions
instead of failing or hanging. List tools paginate up to 300 items (reporting truncation). Tokens are
never logged (output is redacted defense-in-depth), and writes are recorded to `GITHUB_AUDIT_LOG`.

## Usage

```bash
# Claude Code (plugin):  /plugin marketplace add Abhishekkumar2021/mcp-suite  →  /plugin install github
# Claude Code (manual):
claude mcp add github --env GITHUB_TOKEN=<pat> -- npx -y @abhishekmcp/github
```

```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@abhishekmcp/github"], "env": { "GITHUB_TOKEN": "<pat>" } }
  }
}
```

**Claude Desktop (MCPB):** drag `github-*.mcpb` from the [latest release](https://github.com/Abhishekkumar2021/mcp-suite/releases) into Settings → Extensions, then paste a personal access token (or an OAuth client ID for device-flow login). Build it locally with `npm run build:mcpb -w servers/github`.

## License

MIT
