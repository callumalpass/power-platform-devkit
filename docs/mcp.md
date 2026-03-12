# MCP

`@pp/mcp` ships a runnable stdio MCP server for both read-first inspection and
controlled deploy automation.

## What it exposes

- `pp.environment.list`
- `pp.solution.list`
- `pp.solution.inspect`
- `pp.solution.sync-status`
- `pp.solution.create`
- `pp.solution.set-metadata`
- `pp.solution.publish`
- `pp.solution.export`
- `pp.solution.import`
- `pp.solution.checkpoint`
- `pp.dataverse.metadata.apply`
- `pp.dataverse.query`
- `pp.dataverse.whoami`
- `pp.flow.inspect`
- `pp.flow.connrefs`
- `pp.flow.monitor`
- `pp.flow.activate`
- `pp.flow.deploy`
- `pp.flow.export`
- `pp.canvas-app.inspect`
- `pp.canvas-app.access`
- `pp.canvas-app.attach`
- `pp.canvas-app.download`
- `pp.canvas-app.import`
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
- Mutation is currently limited to:
  - one bounded unmanaged solution-shell create through `pp.solution.create`
  - one bounded solution metadata update through `pp.solution.set-metadata`
  - one bounded solution publish through `pp.solution.publish`
  - one bounded solution package export through `pp.solution.export`
  - one bounded solution package import through `pp.solution.import`
  - one bounded rollback-oriented solution checkpoint through `pp.solution.checkpoint`
  - one bounded in-place flow activation attempt through `pp.flow.activate`
  - one bounded flow artifact deploy through `pp.flow.deploy`
  - one bounded flow artifact export through `pp.flow.export`
  - one bounded remote canvas export through `pp.canvas-app.download`
  - one bounded remote canvas replace/import through `pp.canvas-app.import`
  - deploy orchestration through `pp.deploy.plan`
  - `pp.deploy.apply`
- `pp.solution.create` creates exactly one solution in one named environment and
  requires an explicit publisher id or publisher unique name so the mutation
  stays bounded and reviewable from the request itself.
- `pp.solution.set-metadata` updates exactly one solution in one named
  environment and only changes version and publisher bindings for that
  solution.
- `pp.solution.publish` triggers one Dataverse `PublishAllXml` action for one
  named solution and can optionally wait for the same export-backed readiness
  checkpoint used by the CLI publish path.
- `pp.solution.sync-status` is the read-only preflight for solution export
  readiness. It captures solution readback, packaged blockers such as draft
  workflows, and one export-backed readiness probe without mutating the
  environment.
- `pp.solution.export` requires an explicit local output path and performs one
  export for one named solution. The structured response includes mutation
  policy metadata so agents can distinguish the bounded write from the read
  surface.
- `pp.solution.import` requires one explicit local package path and performs one
  import into one named environment with optional workflow publish and
  holding-solution flags.
- `pp.solution.checkpoint` captures one pre-import rollback checkpoint by
  combining export, release manifest preservation, solution readback, and
  component inventory into one written checkpoint document.
- `pp.dataverse.metadata.apply` previews or applies one repo-local metadata
  manifest for tables, columns, option sets, and relationships, so schema
  authoring can stay inside MCP for both dry-run and apply.
- `pp.flow.inspect` lists all visible remote flows when `identifier` is omitted,
  or inspects one flow when it is present. This keeps discovery and metadata
  inspection inside MCP.
- `pp.flow.connrefs` exposes the same connection-reference and
  environment-variable health slice as the CLI `flow connrefs` path.
- `pp.flow.monitor` exposes the same follow-up runtime summary as the CLI
  `flow monitor` path, so agents can confirm that runtime stayed quiet,
  degraded, or blocked without leaving MCP.
- `pp.flow.activate` attempts one in-place activation for one explicit remote
  flow and preserves the same structured blocker diagnostics used by the CLI
  when Dataverse rejects the update path.
- `pp.flow.deploy` takes one explicit local artifact path and one named remote
  environment, with optional `solutionUniqueName`, `target`, and
  `createIfMissing` controls for bounded remote authoring.
- `pp.flow.export` takes one explicit remote flow identifier and one explicit
  local output path for post-create inspection or patching.
- `pp.canvas-app.inspect` lists remote canvas apps or resolves one app inside an
  optional solution scope without leaving MCP.
- `pp.canvas-app.access` exposes the same ownership and explicit-share readback
  as the CLI `pp canvas access` command, so share-state validation no longer
  requires dropping out of MCP.
- `pp.canvas-app.download` exports one remote canvas app through its containing
  solution and writes one `.msapp` artifact plus optional extracted source to
  explicit local paths.
- `pp.canvas-app.import` replaces one explicit remote canvas app inside one
  named solution from one explicit local `.msapp` artifact.
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

This keeps the mutation boundary conservative while still allowing bounded
solution-shell creation, publish confirmation, read-only solution export
preflight, bounded flow activation/export/deploy actions, and plan-then-apply
workflows through one interface.

Discover the current read and mutation boundary:

```json
{
  "name": "pp.domain.list",
  "arguments": {}
}
```

The `solution-lifecycle` domain reports `pp.solution.sync-status` under
`readTools` and `pp.solution.create`, `pp.solution.set-metadata`,
`pp.solution.publish`, `pp.solution.export`, and `pp.solution.checkpoint` under
`mutationTools`. The `flow-lifecycle` domain reports `pp.flow.inspect`,
`pp.flow.connrefs`, and `pp.flow.monitor` under `readTools` and
`pp.flow.activate`, `pp.flow.deploy`, plus `pp.flow.export` under
`mutationTools`. The `canvas-lifecycle` domain reports `pp.canvas-app.inspect` and
`pp.canvas-app.access` under `readTools` and `pp.canvas-app.attach`,
`pp.canvas-app.download`, and `pp.canvas-app.import` under `mutationTools`.

## Current operator notes

- MCP is still read-first overall. Publish/export readiness, cleanup, and some
  flow-runtime confirmation paths remain more complete in the CLI even when MCP
  can discover the same asset.
- `pp.dataverse.query` now warns explicitly when a successful zero-row result
  can still reflect a security-filtered slice. Treat an empty query as
  security-ambiguous unless a broader or known-good follow-up read proves the
  scope is actually empty.
- Not-found and confirmation semantics have improved, but some live workflows
  still require reading `diagnostics`, `warnings`, or follow-up status outputs
  rather than relying on one decisive boolean field.

Create a disposable unmanaged shell directly through MCP:

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

Update the shell version or publisher without leaving MCP:

```json
{
  "name": "pp.solution.set-metadata",
  "arguments": {
    "environment": "dev",
    "uniqueName": "HarnessShell",
    "version": "2026.3.12.1140",
    "publisherUniqueName": "DefaultPublisher"
  }
}
```

When the workflow only knows a run prefix, keep discovery bounded before
choosing a publish or sync-status target:

```json
{
  "name": "pp.solution.list",
  "arguments": {
    "environment": "dev",
    "prefix": "ppHarness20260312T205428716Z"
  }
}
```

Publish one solution and wait for the export-backed readiness checkpoint without
dropping to CLI:

```json
{
  "name": "pp.solution.publish",
  "arguments": {
    "environment": "dev",
    "uniqueName": "HarnessShell",
    "waitForExport": true,
    "timeoutMs": 180000
  }
}
```

Preflight one solution before deciding whether export is worth attempting:

```json
{
  "name": "pp.solution.sync-status",
  "arguments": {
    "environment": "dev",
    "uniqueName": "Core"
  }
}
```

Attempt one bounded activation of a draft solution flow without dropping to CLI:

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

Capture a rollback-ready solution checkpoint in one MCP call:

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

`pp.solution.checkpoint` is intentionally solution-scoped. It captures the
exported package, release manifest, sync-status readback, and component
inventory for one solution, but it does not snapshot Dataverse row data or
dependencies outside that exported solution boundary.

Preview a repo-local Dataverse schema manifest before applying it:

```json
{
  "name": "pp.dataverse.metadata.apply",
  "arguments": {
    "environment": "dev",
    "manifestPath": "solutions/Core/metadata/schema.apply.yaml",
    "solutionUniqueName": "Core",
    "mode": "dry-run"
  }
}
```

Inspect or discover remote flows without leaving MCP:

```json
{
  "name": "pp.flow.inspect",
  "arguments": {
    "environment": "dev",
    "solutionUniqueName": "Core"
  }
}
```

Capture one remote flow's follow-up runtime summary without leaving MCP:

```json
{
  "name": "pp.flow.monitor",
  "arguments": {
    "environment": "dev",
    "identifier": "Invoice Sync",
    "solutionUniqueName": "Core",
    "since": "2h"
  }
}
```

Deploy one local flow artifact into a solution-scoped remote target:

```json
{
  "name": "pp.flow.deploy",
  "arguments": {
    "environment": "dev",
    "inputPath": "flows/invoice/flow.json",
    "solutionUniqueName": "Core",
    "createIfMissing": true,
    "workflowState": "draft"
  }
}
```

Download one remote canvas app and preserve extracted source without leaving
MCP:

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

Replace one remote canvas app from a local `.msapp` artifact through MCP:

```json
{
  "name": "pp.canvas-app.import",
  "arguments": {
    "environment": "dev",
    "identifier": "Harness Canvas",
    "solutionUniqueName": "Core",
    "importPath": "dist/HarnessCanvas.msapp"
  }
}
```

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
