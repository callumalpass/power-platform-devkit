# MCP client setup

Setup instructions for using the `pp` MCP server with specific AI coding tools.

The MCP server is the `pp-mcp` executable. It is installed by the Windows installer when the **MCP server** component is selected, and by `npm install -g pp` as part of the npm package. PP Desktop does not host MCP itself; MCP clients launch `pp-mcp` as a separate stdio process.

`pp-mcp` reads the same pp config and auth cache as PP Desktop and the CLI. Interactive auth caches use OS credential storage when available, with file fallback for headless environments. A common setup is to sign in and add environments in PP Desktop or with `pp auth login` / `pp env add`, then point your MCP client at `pp-mcp`.

If the Windows installer did not add pp to `PATH`, use the full command path in client configs:

```text
C:\Program Files\PP\pp-mcp.exe
```

## Claude Code

```sh
claude mcp add --scope user pp -- pp-mcp
```

Or add this to a Claude MCP JSON config:

```json
{
  "mcpServers": {
    "pp": {
      "command": "pp-mcp"
    }
  }
}
```

Verify with:

```sh
claude mcp get pp
```

Claude Code exposes the tools as `mcp__pp__pp_account_list`, `mcp__pp__pp_environment_list`, and so on.

## Codex CLI

```sh
codex mcp add pp -- pp-mcp
```

Verify with:

```sh
codex mcp get pp
```

Codex can then use the default dotted MCP tools such as `pp.account.list`.

## GitHub Copilot CLI

Copilot CLI can use MCP servers configured in `~/.copilot/mcp-config.json`. Use underscore tool names for Copilot compatibility:

```json
{
  "mcpServers": {
    "pp": {
      "type": "local",
      "command": "pp-mcp",
      "args": ["--tool-name-style", "underscore"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```

You can also add the server from Copilot interactive mode with `/mcp add`; choose `STDIO` or `Local`, set the command to `pp-mcp --tool-name-style underscore`, and include all tools.

In Copilot prompts, refer to underscore tool names such as `pp_account_list`.

## GitHub Copilot in VS Code

For a repo-local VS Code configuration, create `.vscode/mcp.json`:

```json
{
  "servers": {
    "pp": {
      "command": "pp-mcp",
      "args": ["--tool-name-style", "underscore"]
    }
  }
}
```

Use **MCP: List Servers** from the VS Code command palette to start and verify the server.
