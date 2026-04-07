# pp

CLI and library for working with Microsoft Power Platform.

`pp` provides authenticated access to Dataverse, Power Automate, Microsoft Graph, BAP, and Power Apps APIs. It includes an MCP server for AI assistant integration and a localhost web UI for managing accounts, environments, and querying Dataverse.

## Install and build

```sh
pnpm install
pnpm build
```

This produces ESM and CJS outputs in `dist/`. The package exposes two binaries: `pp` (CLI) and `pp-mcp` (MCP server).

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
| `pp ui` | Start the web UI |
| `pp mcp` | Start the MCP server |
| `pp migrate-config` | Migrate legacy config |
| `pp completion [zsh\|bash]` | Print shell completion script |

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

Starts a localhost HTTP server and opens a browser. The UI provides:

- **Setup** -- Manage accounts and environments
- **Explorer** -- Browse Dataverse entities and metadata
- **Query Lab** -- Build and run OData queries
- **FetchXML** -- Execute FetchXML queries

Options:

- `--port PORT` -- Set the server port (default: auto-assigned)
- `--no-open` -- Don't open a browser on startup
- `--config-dir DIR` -- Override config directory

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
