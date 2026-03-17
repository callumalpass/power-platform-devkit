# Flow artifacts

Flow support in `pp` serves two related purposes. On the remote side, it
provides Dataverse-backed discovery, inspection, and export for cloud flows in
a target environment. On the local side, it defines a canonical
`pp.flow.artifact` JSON format and provides normalization and validation
tooling for offline flow work.

If you are evaluating `pp` overall, start with [quickstart.md](quickstart.md)
and [dataverse-and-solutions.md](dataverse-and-solutions.md) first. Flow
support is worth using when you need it, but it is not the first workflow most
users should learn.

## Getting started

The most common flow tasks are inspecting remote flows, exporting them into
local artifacts, validating local artifacts, and reactivating stuck flows.

To discover and inspect flows in a remote environment, use `flow list` to see
what is available and `flow inspect` to get detailed metadata about a specific
flow. Both commands accept `--solution` to scope the results to a particular
solution.

```bash
pp flow list --env dev
pp flow inspect "Invoice Sync" --env dev --solution Core --no-interactive-auth
```

To bring a remote flow into the local canonical format, export it. This writes
a normalized `flow.json` artifact that can then be validated, patched, or
redeployed.

```bash
pp flow export "Invoice Sync" --env dev --solution Core --out ./flows/invoice-remote --no-interactive-auth
```

Local artifacts can be validated and normalized without any remote connection.
Validation checks the artifact structure, connection-reference coherence,
expression references, and workflow metadata. Normalization strips noisy
metadata and applies stable ordering.

```bash
pp flow validate ./flows/invoice
pp flow normalize ./flows/invoice
```

To check whether a flow's connection references are healthy in the target
environment, use `flow connrefs`. This is useful before activation or
deployment.

```bash
pp flow connrefs "Invoice Sync" --env dev --solution Core --no-interactive-auth
```

When a solution-scoped cloud flow is stuck in `draft` or `suspended` state, you
can reactivate it with `flow activate`, which re-applies the flow definition
with its workflow state forced to `activated`.

```bash
pp flow activate crd_InvoiceSync --env dev --solution Core
```

Two additional CLI commands handle solution attachment and access management.
`flow attach` adds a flow to a solution, and `flow access` manages sharing.

```bash
pp flow attach <name|id|uniqueName> --env dev --solution Core
pp flow access <name|id|uniqueName> --env dev
```

## Remote inspection output

When you inspect a remote flow, `pp` returns the flow's identity (id, name,
unique name, and description), workflow-shell metadata such as `type`, `mode`,
`ondemand`, and `primaryentity`, and normalized workflow state labels alongside
the underlying state and status codes. The output also indicates whether
client-definition data was present and lists parsed connection-reference names,
parameter references, and environment-variable references detected from
expressions.

## Local artifact format

The canonical unpacked artifact is a `flow.json` file with a stable schema.
The `metadata` block captures the flow's identity, connection references,
parameters, and environment-variable dependencies. The `definition` block holds
the workflow definition itself, and `unknown` preserves any fields that `pp`
does not recognize so they survive round-trips.

```json
{
  "schemaVersion": 1,
  "kind": "pp.flow.artifact",
  "metadata": {
    "name": "Invoice Flow",
    "displayName": "Invoice Flow",
    "description": "Synchronize invoice payloads to downstream systems.",
    "category": 5,
    "workflowMetadata": {
      "type": 1,
      "mode": 0,
      "onDemand": false,
      "primaryEntity": "none"
    },
    "connectionReferences": [
      {
        "name": "shared_office365",
        "connectionReferenceLogicalName": "shared_office365"
      }
    ],
    "parameters": {
      "ApiBaseUrl": "https://example.test"
    },
    "environmentVariables": ["pp_ApiUrl"]
  },
  "definition": {
    "actions": {}
  },
  "unknown": {}
}
```

The normalizer accepts a canonical `pp.flow.artifact`, a raw exported flow JSON
payload with `properties.definition`, or a directory containing `flow.json`.

## Normalization

The normalizer converts raw exports into the canonical artifact shape, strips
obviously noisy metadata such as `createdTime` and `lastModifiedTime`, preserves
unknown fields in both `definition` and the top-level `unknown` bucket, and
applies stable JSON key ordering through the shared artifact helpers. The result
is a deterministic representation that diffs cleanly across exports.

## Validation

Validation covers the artifact's structural integrity and semantic coherence.
It confirms that the artifact has a name and definition, that connection
reference names are present and non-duplicated, and that declared connection
references stay coherent with the `$connections` values in the definition
parameters. Expression references are resolved for `parameters(...)`,
`variables(...)`, `actions(...)`, `body(...)`, and `outputs(...)` calls, and
`runAfter` dependencies are checked against known trigger and action nodes.
Variable write operations are verified against declared variables.

Validation also checks workflow metadata: `statecode`/`statuscode`
combinations, category values (cloud flows require `5`), and workflow shell
metadata values. Reliability warnings surface when trigger or action concurrency
is enabled or retry counts are unusually high.

The validation output includes a `semanticSummary` with trigger, action, and
scope counts, expression counts, variable names, and reference counts.

## Library-only capabilities

The `@pp/flow` package exposes additional functions that are not currently wired
as CLI commands but are available to library consumers and through the MCP
server.

For artifact manipulation, the library provides `unpackFlowArtifact()` to
convert raw exports into canonical form, `packFlowArtifact()` to repack a
canonical artifact back into raw export shape, and `patchFlowArtifact()` to
apply structured patches. `graphFlowArtifact()` builds a dependency-oriented
graph report.

For remote lifecycle operations, `deployFlowArtifact()` deploys a local
artifact to a remote environment and `promoteRemoteFlowArtifact()` promotes a
flow between environments. Runtime inspection is available through
`FlowService.runs()` for recent run summaries, `FlowService.errors()` for
grouped error analysis, `FlowService.doctor()` for pre-triaged diagnostics, and
`FlowService.monitor()` for health classification.

These capabilities are accessible through the MCP tools `pp.flow.deploy`,
`pp.flow.runs`, `pp.flow.errors`, `pp.flow.doctor`, and `pp.flow.monitor`.
`flow runs` is also available as a CLI command; `errors`, `doctor`, and
`monitor` are MCP-only to encourage direct run inspection over automated
summaries.

### Patch model

The library patch document supports renaming actions, variables, and connection
references, updating parameter values, and modifying expression values or
literal values at dotted paths within the artifact.

### Graph report

The graph report produces normalized workflow nodes with child scopes,
`runAfter` dependencies, reverse dependents, and per-node reference counts. It
emits typed graph edges for containment, control-flow, action-output reads,
parameter and environment-variable reads, connection-reference reads, and
variable reads and writes. It also includes declared resource summaries and a
hotspot summary highlighting high-fan-in, high-fan-out, and reference-dense
nodes.

### Intermediate representation

The flow package exposes a parsed IR over unpacked artifacts. Every trigger,
action, and scope receives a stable hierarchical id, and scope-like actions are
modeled explicitly as scope nodes. Parent-child relationships, branch
membership, and `runAfter` dependencies are preserved. Each parsed node carries
resolved and unresolved `runAfter` edges, expression occurrences,
dynamic-content references, and variable targets.

## Cloud flow run history

Cloud flow run history is available through `pp flow runs` on the CLI and
through the MCP tools `pp.flow.runs`, `pp.flow.errors`, `pp.flow.doctor`, and
`pp.flow.monitor`.

When the target environment has a `makerEnvironmentId` configured on its
environment alias, `pp` queries the Power Automate management API
(`api.flow.microsoft.com`) for run history. This is the correct data source for
cloud flow runs — the Dataverse `flowruns` table only contains desktop flow run
records. If the Power Automate API call fails or `makerEnvironmentId` is not
configured, `pp` falls back transparently to the Dataverse `flowruns` table.

To enable the Power Automate API path, either pass `--maker-env-id` when
registering the environment alias, or use `pp env resolve-maker-id` to discover
and persist it:

```bash
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user --maker-env-id <guid>
# or
pp env resolve-maker-id dev
```

Run data includes each run's status, start and end times, computed duration, and
error codes and messages when applicable. When `includeActions` is set (or
`--include-actions` on the CLI), each run also includes per-action step detail
showing the name, status, timing, and error information for every action that
executed within the run. Action detail is only available through the Power
Automate API path.

## Current limitations

Runtime analysis depends on runtime evidence being present and fresh enough to
be meaningful. Deploy and promote operate against the supported cloud-flow
contract and do not cover every possible workflow shell or imported artifact
shape. Some solution-packaged or Maker-driven workflows still require adjacent
tools or manual steps. The runtime tables are treated as read-only evidence, not
a mutation surface.
