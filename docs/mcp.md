# MCP

`@pp/mcp` ships a runnable stdio MCP server for both read-first inspection and
controlled deploy automation.

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
- `pp.analysis.portfolio`
- `pp.analysis.drift`
- `pp.analysis.usage`
- `pp.analysis.policy`
- `pp.deploy.plan`
- `pp.deploy.apply`
- `pp.domain.list`

Every tool returns a structured envelope that preserves:

- `success`
- `data`
- `diagnostics`
- `warnings`
- `supportTier`
- `provenance`
- `knownLimitations`
- a `mutationPolicy` block describing whether the tool is read-only or a
  controlled mutation surface

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

- Read helpers remain available with the same read-only contract.
- Mutation is currently limited to deploy orchestration through:
  - `pp.deploy.plan`
  - `pp.deploy.apply`
- `pp.deploy.plan` resolves the workspace, produces the shared deploy preview,
  and stores an in-memory MCP plan session.
- `pp.deploy.apply` only executes a stored session. Live apply requires
  `approval.confirmed: true` plus the exact `approval.sessionId` that matches
  the planned session.
- If approval is omitted or does not match the stored session, MCP returns a
  blocked apply result instead of mutating anything.
- Plan sessions are intentionally ephemeral and server-local. Restarting the MCP
  server invalidates them.
- Interactive browser auth is disabled by default for MCP requests.
- To opt in to interactive auth for a session, start the server with
  `--allow-interactive-auth`, or pass `allowInteractiveAuth: true` on a remote
  tool call.

This keeps the mutation boundary conservative while still allowing a bounded
plan-then-apply workflow through one interface.

## Example workflow

Plan a bounded deploy session:

```json
{
  "name": "pp.deploy.plan",
  "arguments": {
    "projectPath": ".",
    "stage": "prod"
  }
}
```

The response includes `data.session.id`, workspace context, and the shared
deploy preview.

Attempt apply without approval:

```json
{
  "name": "pp.deploy.apply",
  "arguments": {
    "sessionId": "7a9f9a57-6c2e-44d4-bb2e-b2ef6fd9f6d5"
  }
}
```

That returns a blocked confirmation state.

Authorize live apply for the exact stored plan:

```json
{
  "name": "pp.deploy.apply",
  "arguments": {
    "sessionId": "7a9f9a57-6c2e-44d4-bb2e-b2ef6fd9f6d5",
    "approval": {
      "confirmed": true,
      "sessionId": "7a9f9a57-6c2e-44d4-bb2e-b2ef6fd9f6d5",
      "reason": "operator approved this bounded deploy"
    }
  }
}
```

Use `mode: "dry-run"` on `pp.deploy.apply` when an agent needs to re-check the
stored plan without writing.

## Notes

- The MCP layer is interface glue over existing `@pp/config`, `@pp/project`,
  `@pp/analysis`, `@pp/dataverse`, `@pp/deploy`, `@pp/solution`, and
  `@pp/model` services.
- Deploy mutation semantics still come from the shared deploy engine. MCP adds
  session storage, approval binding, and tool-level mutation policy metadata.
