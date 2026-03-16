# MCP

`pp` ships a stdio MCP server that exposes both read-first inspection and
controlled mutation across the same domain packages that back the CLI. The MCP
layer is interface glue over `@pp/config`, `@pp/dataverse`, `@pp/solution`,
`@pp/flow`, `@pp/canvas`, and `@pp/model`.

## Running the server

From source, build the CLI first and then launch the server.

```bash
pnpm --filter @pp/cli build
node packages/cli/dist/index.cjs mcp serve
```

With an installed CLI, run `pp mcp serve` directly. When `pp` is installed
through a Windows MSI, the MCP host should launch `pp mcp serve` on demand over
`stdio`; `pp` does not need a permanent Windows service.

```bash
pp mcp serve
```

A typical MCP host configuration looks like this.

```json
{
  "mcpServers": {
    "pp": {
      "command": "pp",
      "args": ["mcp", "serve"]
    }
  }
}
```

On Windows, if you need an explicit config root, add
`"--config-dir", "%APPDATA%\\\\pp"` to the args array.

## Available tools

The MCP server exposes tools across several domains.

**Environment and auth** tools cover environment alias management
(`pp.environment.list`, `pp.environment.inspect`, `pp.environment.add`,
`pp.environment.cleanup-plan`, `pp.environment.cleanup`), auth profile
lifecycle (`pp.auth-profile.list`, `pp.auth-profile.inspect`,
`pp.auth-profile.create`, `pp.auth-profile.authenticate`), and browser profile
management (`pp.browser-profile.list`, `pp.browser-profile.inspect`,
`pp.browser-profile.create`, `pp.browser-profile.bootstrap`).

**Dataverse** tools provide row queries and mutations (`pp.dataverse.query`,
`pp.dataverse.create`, `pp.dataverse.delete`, `pp.dataverse.whoami`) and
metadata authoring (`pp.dataverse.metadata.apply`,
`pp.dataverse.metadata.table`, `pp.dataverse.metadata.relationship`).

**Solution** tools cover the full solution lifecycle: listing and inspection
(`pp.solution.list`, `pp.solution.inspect`, `pp.solution.compare`,
`pp.solution.sync-status`), creation and metadata updates
(`pp.solution.create`, `pp.solution.set-metadata`), and lifecycle operations
(`pp.solution.publish`, `pp.solution.export`, `pp.solution.import`,
`pp.solution.checkpoint`).

**Flow** tools provide inspection and health analysis (`pp.flow.inspect`,
`pp.flow.connrefs`, `pp.flow.runs`, `pp.flow.errors`, `pp.flow.doctor`,
`pp.flow.monitor`) and lifecycle operations (`pp.flow.activate`,
`pp.flow.deploy`, `pp.flow.export`). Several of these, including deploy, runs,
errors, doctor, and monitor, are available through MCP but not yet wired as CLI
commands.

**Connection reference and environment variable** tools cover inspection and
management (`pp.connection-reference.inspect`,
`pp.connection-reference.create`, `pp.connection-reference.set`,
`pp.environment-variable.inspect`).

**Model-driven app** tools support inspection and authoring
(`pp.model-app.inspect`, `pp.model-app.create`, `pp.model-app.attach`).

**Canvas** tools cover app inspection and lifecycle (`pp.canvas-app.inspect`,
`pp.canvas-app.access`, `pp.canvas-app.plan-attach`, `pp.canvas-app.attach`,
`pp.canvas-app.download`, `pp.canvas-app.import`).

**Discovery** is available through `pp.domain.list`, which returns the current
read and mutation boundary so callers can discover what tools are available.

Every tool returns a structured envelope with `success`, `data`, `diagnostics`,
`warnings`, `supportTier`, `provenance`, `knownLimitations`, and a
`mutationPolicy` block indicating whether the tool is read-only or a controlled
mutation surface.

## Safety and mutation boundary

Read tools are always available. Mutation is limited to bounded operations
within each domain: solution lifecycle through create, set-metadata, publish,
export, import, and checkpoint; flow lifecycle through activate, deploy, and
export; canvas lifecycle through attach, download, and import; model-driven app
lifecycle through create and attach; Dataverse writes through create, delete,
and metadata apply; environment management through add, cleanup-plan, and
cleanup; connection reference management through create and set; and auth
profile and browser profile creation and authentication.

Interactive browser auth is disabled by default for MCP requests. To opt in for
a session, start the server with `--allow-interactive-auth`, or pass
`allowInteractiveAuth: true` on an individual tool call.

## Examples

To create a disposable unmanaged solution shell directly through MCP:

```json
{
  "name": "pp.solution.create",
  "arguments": {
    "environment": "dev",
    "uniqueName": "HarnessShell",
    "friendlyName": "Harness Shell",
    "publisherUniqueName": "DefaultPublisher"
  }
}
```

To inspect or discover remote flows scoped to a solution:

```json
{
  "name": "pp.flow.inspect",
  "arguments": {
    "environment": "dev",
    "solutionUniqueName": "Core"
  }
}
```

To activate a draft flow that is stuck in a non-running state:

```json
{
  "name": "pp.flow.activate",
  "arguments": {
    "environment": "dev",
    "identifier": "crd_InvoiceSync",
    "solutionUniqueName": "Core"
  }
}
```

To deploy a local flow artifact into a solution-scoped remote target:

```json
{
  "name": "pp.flow.deploy",
  "arguments": {
    "environment": "dev",
    "inputPath": "flows/invoice/flow.json",
    "solutionUniqueName": "Core",
    "createIfMissing": true,
    "workflowState": "draft",
    "resultOutPath": ".ops/runs/example/logs/flow-deploy.json"
  }
}
```

To download a remote canvas app and extract it into a local source tree:

```json
{
  "name": "pp.canvas-app.download",
  "arguments": {
    "environment": "dev",
    "identifier": "Harness Canvas",
    "solutionUniqueName": "Core",
    "outPath": "artifacts/HarnessCanvas.msapp",
    "extractToDirectory": "artifacts/HarnessCanvas"
  }
}
```

To capture a rollback-ready solution checkpoint before an import:

```json
{
  "name": "pp.solution.checkpoint",
  "arguments": {
    "environment": "dev",
    "uniqueName": "Core",
    "outPath": "artifacts/checkpoints/Core-pre-import.zip",
    "checkpointPath": "artifacts/checkpoints/Core-pre-import.pp-checkpoint.json"
  }
}
```

## Operator notes

MCP is still read-first overall. Some live workflows remain more complete in the
CLI even when MCP can discover the same asset. `pp.dataverse.query` warns
explicitly when a successful zero-row result might reflect a security-filtered
slice rather than genuinely empty data. Not-found and confirmation semantics
have improved, but some workflows still require reading `diagnostics`,
`warnings`, or follow-up status outputs rather than relying on a single
decisive boolean field.
