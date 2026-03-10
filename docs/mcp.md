# MCP

`@pp/mcp` now ships a runnable stdio MCP server for the first read-first agent
surface.

## What it exposes

- `pp.environment.list`
- `pp.solution.list`
- `pp.solution.inspect`
- `pp.dataverse.query`
- `pp.connection-reference.inspect`
- `pp.environment-variable.inspect`
- `pp.model-app.inspect`
- `pp.project.inspect`
- `pp.analysis.context`
- `pp.domain.list`

Every tool returns a structured envelope that preserves:

- `success`
- `data`
- `diagnostics`
- `warnings`
- `supportTier`
- `provenance`
- `knownLimitations`
- a `mutationPolicy` block stating that this release is read-only

## Running the server

From source:

```bash
pnpm --filter @pp/mcp build
node packages/mcp/dist/server.js --config-dir ~/.config/pp --project .
```

With the package bin after linking or installation:

```bash
pp-mcp --config-dir ~/.config/pp --project .
```

## Safety and mutation boundary

- The server only registers read-only tools.
- Mutation tools are intentionally absent from the MCP surface.
- Interactive browser auth is disabled by default for MCP requests.
- To opt in to interactive auth for a session, start the server with
  `--allow-interactive-auth`, or pass `allowInteractiveAuth: true` on a remote
  tool call.

This keeps the first MCP release safe for agent use in unattended contexts
while still allowing explicit operator opt-in when needed.

## Notes

- The MCP layer is interface glue over existing `@pp/config`, `@pp/project`,
  `@pp/analysis`, `@pp/dataverse`, `@pp/solution`, and `@pp/model` services.
- No MCP-specific business logic fork was introduced for the read-first tools.
