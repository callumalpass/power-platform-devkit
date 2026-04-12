# pp

CLI and library for working with Microsoft Power Platform.

`pp` provides authenticated access to Dataverse, Power Automate, Microsoft Graph, BAP, and Power Apps APIs. It includes an MCP server for AI assistant integration and a localhost web UI for managing accounts, environments, and querying Dataverse.

## Install

### npm

If you already have Node.js 22+ installed:

```sh
npm install -g pp
```

Or run without a global install:

```sh
npx pp --help
```

The package exposes three binaries:

- `pp` for the CLI
- `pp-mcp` for the MCP server
- `pp-ui` for the browser UI launcher

### Windows

Download `pp-setup.exe` from the latest [GitHub Release](../../releases) and run the installer. Leave **Add pp to PATH** checked to use `pp`, `pp-mcp`, and `pp-ui` from PowerShell.

For unreleased builds, download the `pp-windows-<commit>` artifact from the latest successful CI workflow run.

## Quick start

Log in with a browser-based auth flow:

```sh
pp auth login myaccount
```

Add a Dataverse environment:

```sh
pp env add dev --url https://myorg.crm.dynamics.com --account myaccount
```

Verify connectivity:

```sh
pp whoami --env dev
```

Send a Dataverse request:

```sh
pp dv /accounts --env dev
```

## CLI reference

| Command | Description |
|---|---|
| `pp auth login <account>` | Create or update an account and run a login flow |
| `pp auth list` | List configured accounts |
| `pp auth inspect <account>` | Show account details |
| `pp auth remove <account>` | Remove an account |
| `pp env list` | List configured environments |
| `pp env inspect <alias>` | Show environment details |
| `pp env discover <account>` | Discover environments accessible to an account |
| `pp env add <alias>` | Add an environment (`--url URL --account ACCOUNT`) |
| `pp env remove <alias>` | Remove an environment |
| `pp request <path> --env ALIAS` | Send an authenticated API request |
| `pp whoami --env ALIAS` | Run Dataverse WhoAmI |
| `pp ping --env ALIAS` | Check API connectivity |
| `pp token --env ALIAS` | Print a bearer token |
| `pp ui` | Start or reuse the web UI |
| `pp mcp` | Start the MCP server |
| `pp migrate-config` | Migrate legacy config |
| `pp completion [zsh\|bash\|powershell]` | Print shell completion script |

All commands accept `--help` for usage details. Most commands accept `--config-dir DIR` to override the config location and `--no-interactive-auth` to disable browser-based auth prompts.

### Auth flows

The `pp auth login` command supports multiple authentication methods:

- `--browser` (default) -- Interactive browser login via MSAL
- `--device-code` -- Device code flow for headless environments
- `--client-secret` -- Service principal auth (`--tenant-id`, `--client-id`, `--client-secret-env` required)
- `--env-token` -- Read a token from an environment variable (`--env-var` required)
- `--static-token` -- Use a fixed token string (`--token` required)

### API shortcuts

The commands `pp dv`, `pp flow`, `pp graph`, `pp bap`, and `pp powerapps` are shortcuts for `pp request --api <type>`. They accept the same flags as `pp request`. `pp canvas-authoring` provides canvas authoring helpers and falls back to the same request shortcut when the first argument is not a helper command.

```sh
# Dataverse query
pp dv /accounts --env dev --query '$top=5'

# Graph request
pp graph /me --env dev

# Power Automate flows
pp flow /flows --env dev

# Power Apps canvas authoring cluster discovery
pp canvas-authoring /gateway/cluster --env dev --read

# Power Apps canvas authoring session start
pp canvas-authoring session start --env dev --app <app-id>
```

The `--api` flag on `pp request` also accepts `custom` for arbitrary endpoints.

`canvas-authoring` targets the Power Apps canvas authoring service used by Studio and the Microsoft canvas authoring MCP server. Relative paths are rooted at the environment cluster-discovery host (`https://<environment>.ce.environment.api.powerplatform.com`), so `/gateway/cluster` is the first low-level probe. Fully qualified authoring gateway URLs are preserved and authenticated with the canvas authoring resource. The `session start` helper wraps the known cluster discovery and authoring session start flow, and redacts session secrets from output unless `--raw` is provided.

Canvas authoring is a first-party Microsoft resource that rejects pp's normal public client during interactive auth. For user and device-code accounts that do not already specify `--client-id`, pp uses the Power Apps Studio public client for `canvas-authoring` requests only, defaults that login to device code because the Studio client does not allow pp's localhost browser callback, and keeps that token in a separate cache entry so other APIs continue to use the normal pp client.

### jq response transforms

Request commands can apply a jq expression to JSON responses before printing the result:

```sh
pp dv /accounts --env dev --query '$select=name,accountid' --query '$top=50' --jq '.value | map({name, accountid})'
```

This runs jq in-process through WebAssembly; it does not shell out to a local `jq` binary. Prefer API-native filters such as `$select`, `$filter`, and `$top` first, then use `--jq` to trim or reshape the JSON that is returned.

## Web UI

```sh
pp ui
```

Starts or reuses a localhost HTTP server and opens a browser. If another `pp ui` instance is already running for the same config directory, the command reuses it instead of starting a duplicate process. If the default port is busy, `pp ui` automatically falls back to another localhost port.

[![pp UI light-mode walkthrough](docs/images/pp-ui-light-walkthrough.gif)](docs/videos/pp-ui-light-walkthrough.mp4)

Click the walkthrough for the full MP4.

![pp UI setup status in light mode](docs/images/pp-ui-setup-light.png)

![pp UI API console in light mode](docs/images/pp-ui-console-light.png)

![pp UI Dataverse explorer in light mode](docs/images/pp-ui-dataverse-light.png)

The UI provides:

- **Setup** -- Manage accounts and environments
- **Explorer** -- Browse Dataverse entities and metadata
- **Query Lab** -- Build and run OData queries
- **FetchXML** -- Execute FetchXML queries

Options:

- `--port PORT` -- Set the server port (default: auto-assigned)
- `--no-open` -- Don't open a browser on startup
- `--config-dir DIR` -- Override config directory
- `--lan` -- Listen on the local network instead of localhost (requires `--pair`)
- `--pair` -- Require a short-lived pairing code before browsers can use the UI

### LAN access

To serve the UI to another browser on the same trusted network:

```sh
pp ui --lan --pair --no-open
```

The command prints LAN URLs plus a short-lived pairing URL/code. Open the pairing URL from the client browser, or open the LAN URL and enter the code shown on the host. Pairing is in-memory and lasts only for the running UI process; restart `pp ui` to revoke paired browsers. LAN mode uses plain HTTP, so use it only on a trusted LAN or behind your own HTTPS/VPN layer.

## MCP server

The MCP server exposes Power Platform operations as tools for AI assistants (e.g., Claude Desktop). It uses stdio transport.

```sh
pp mcp        # or: pp-mcp
```

Options:

- `--config-dir DIR` -- Override config directory
- `--allow-interactive-auth` -- Enable browser-based auth prompts (disabled by default in MCP mode)
- `--tool-name-style dotted|underscore` -- Expose default dotted tool names (`pp.account.list`) or Copilot-compatible underscore names (`pp_account_list`)

### Tool names

By default, tools are namespaced under `pp.`:

- `pp.account.list`, `pp.account.inspect`, `pp.account.login`, `pp.account.remove`
- `pp.environment.list`, `pp.environment.inspect`, `pp.environment.add`, `pp.environment.discover`, `pp.environment.remove`
- `pp.request`, `pp.dv_request`, `pp.flow_request`, `pp.graph_request`, `pp.bap_request`, `pp.powerapps_request`
- `pp.whoami`, `pp.ping`, `pp.token`

When started with `--tool-name-style underscore`, dots are replaced by underscores (e.g. `pp_account_list`).

### jq in MCP tools

The request tools accept `jq` to transform JSON responses before the MCP result is returned:

```json
{
  "environment": "dev",
  "path": "/accounts",
  "query": { "$select": "name,accountid", "$top": "50" },
  "jq": ".value | map({name, accountid})"
}
```

For advanced limits, pass an object:

```json
{
  "jq": {
    "expr": ".value[] | {name, accountid}",
    "maxOutputBytes": 50000,
    "timeoutMs": 2000
  }
}
```

Use `raw: true` when the jq expression intentionally returns text instead of JSON.

### Client setup

See [docs/mcp-clients.md](docs/mcp-clients.md) for setup instructions for Claude Code, Codex CLI, GitHub Copilot CLI, and GitHub Copilot in VS Code.

## Library usage

The package exports three entry points:

### `pp` (main)

The core library for account management, environment management, and API requests.

```ts
import { listAccountSummaries, executeApiRequest } from 'pp';
```

### `pp/mcp`

Functions to create and start an MCP server programmatically.

```ts
import { createPpMcpServer, startPpMcpServer } from 'pp/mcp';

// Create a server instance
const server = createPpMcpServer({ configDir: '/path/to/config' });

// Or start with stdio transport
const { server, transport } = await startPpMcpServer();
```

### `pp/mcp-server`

Standalone MCP server entry point. Starts the server immediately on import.

## Development

### Build from source

```sh
pnpm install
pnpm build
```

This produces ESM and CJS outputs in `dist/`, including the `pp`, `pp-mcp`, and `pp-ui` binaries. The build bundles browser-side vendor modules up front so `pp ui` does not depend on resolving `node_modules` at runtime.

### Windows packaging

Build self-contained executables with:

```sh
pnpm run build:sea
```

This emits `pp.exe`, `pp-mcp.exe`, and `pp-ui.exe` under `release/win32-x64/`. The SEA build currently runs on Windows hosts only.

The Inno Setup installer definition at `packaging/windows/pp.iss` installs into `Program Files\pp`, optionally adds the install directory to `PATH`, creates a Start menu shortcut for PP UI, and registers uninstall support.
