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

The repo now includes a Windows packaging path:

- self-contained executables via `pnpm run build:sea`
- an Inno Setup installer script at `packaging/windows/pp.iss`

The intended installed experience is:

- `pp.exe` and `pp-mcp.exe` on `PATH`
- a Start menu shortcut for `PP UI`
- user state stored under `%APPDATA%\pp`

Building the Windows installer currently requires a Windows machine or Windows CI.

## Build From Source

```sh
pnpm install
pnpm build
```

This produces ESM and CJS outputs in `dist/`, including the `pp`, `pp-mcp`, and `pp-ui` binaries. The build now bundles browser-side vendor modules up front so `pp ui` no longer depends on resolving `node_modules` at runtime.

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

## API shortcuts

The commands `pp dv`, `pp flow`, `pp graph`, `pp bap`, and `pp powerapps` are shortcuts for `pp request --api <type>`. They accept the same flags as `pp request`.

```sh
# Dataverse query
pp dv /accounts --env dev --query '$top=5'

# Graph request
pp graph /me --env dev

# Power Automate flows
pp flow /flows --env dev
```

The `--api` flag on `pp request` also accepts `custom` for arbitrary endpoints.

## MCP server

The MCP server exposes Power Platform operations as tools for AI assistants (e.g., Claude Desktop). It uses stdio transport.

Start it from the CLI:

```sh
pp mcp
```

Or use the standalone binary:

```sh
pp-mcp
```

Options:

- `--config-dir DIR` -- Override config directory
- `--allow-interactive-auth` -- Enable browser-based auth prompts (disabled by default in MCP mode)

### Tool names

Tools are namespaced under `pp.`:

- `pp.account.list`, `pp.account.inspect`, `pp.account.login`, `pp.account.remove`
- `pp.environment.list`, `pp.environment.inspect`, `pp.environment.add`, `pp.environment.discover`, `pp.environment.remove`
- `pp.request`, `pp.dv_request`
- `pp.whoami`, `pp.ping`, `pp.token`

### Claude Desktop configuration

Add to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "pp": {
      "command": "pp-mcp"
    }
  }
}
```

## Web UI

```sh
pp ui
```

Starts or reuses a localhost HTTP server and opens a browser. If another `pp ui` instance is already running for the same config directory, the command reuses it instead of starting a duplicate process. If the default port is busy, `pp ui` automatically falls back to another localhost port.

To serve the UI to another browser on the same trusted network, start the host machine with LAN pairing enabled:

```sh
pp ui --lan --pair --no-open
```

The command prints LAN URLs plus a short-lived pairing URL/code. Open the pairing URL from the client browser, or open the LAN URL and enter the code shown on the host. Pairing is in-memory and lasts only for the running UI process; restart `pp ui` to revoke paired browsers. LAN mode uses plain HTTP, so use it only on a trusted LAN or behind your own HTTPS/VPN layer.

You can also launch the UI directly with:

```sh
pp-ui
```

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

### Windows UX notes

The intended non-technical Windows path is:

1. Install the packaged app.
2. Launch `PP UI` from the Start menu, which targets `pp-ui.exe`.
3. Use `pp.exe` from PowerShell only when CLI access is needed.

The installer is expected to preserve config under `%APPDATA%\pp` across upgrades.

## Packaging

### Self-contained Windows executables

On Windows, build self-contained executables with:

```sh
pnpm run build:sea
```

This emits release artifacts under `release/win32-x64/`:

- `pp.exe`
- `pp-mcp.exe`
- `pp-ui.exe`

The SEA build currently runs on Windows hosts only.

### Inno Setup installer

The Inno Setup definition lives at `packaging/windows/pp.iss`.

It is set up to:

- install into `Program Files\pp`
- optionally add the install directory to `PATH`
- create a Start menu shortcut for `PP UI`
- register uninstall support

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
