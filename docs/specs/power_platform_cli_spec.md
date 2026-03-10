# Power Platform Engineering Toolkit Spec

**Working names:** `pp`, `powercli`, `power-platform-toolkit`  
**Status:** Draft v0.1  
**Primary target stack:** TypeScript / Node.js / npm  
**Primary interfaces:** CLI, library API, MCP server

## 1. Overview

This project is a **library-first, agent-friendly Power Platform engineering toolkit** for working with Power Platform assets from the command line and from other tools.

The toolkit is intended to provide a coherent, scriptable layer over:

- Dataverse-backed assets and metadata
- Power Platform ALM concepts such as solutions, environment variables, and connection references
- artifact-based assets such as canvas apps and cloud flows
- runtime diagnostics such as cloud flow runs and deployment troubleshooting

The toolkit should support three modes of use:

1. **CLI** for day-to-day engineering work
2. **Library API** for use in other Node.js / TypeScript tools
3. **MCP server** for AI-agent access

The project is not intended to be a thin wrapper around existing tools only. It should provide a stable domain model and workflow primitives, while reusing official tooling where that is the most robust implementation choice.

---

## 2. Problem Statement

Power Platform development work is fragmented across:

- maker-oriented web UIs
- solution exports and unpacked artifacts
- Dataverse Web API
- PAC CLI
- XrmToolBox-style utilities
- ad hoc scripts

This makes several common workflows harder than they should be:

- switching between environments and solutions
- querying and mutating Dataverse-backed platform assets
- inspecting and fixing connection references and environment variables
- building or packaging canvas apps from local source
- treating cloud flows as source-controlled artifacts
- inspecting flow runs and failures from the command line
- using AI agents safely and effectively against Power Platform assets

The project exists to provide a **single programmable surface** for these workflows.

---

## 3. Product Positioning

This toolkit should sit between several existing categories:

- **broader and more composable than XrmToolBox**
- **more programmable and workflow-oriented than PAC alone**
- **broader than a Dataverse-only library**
- **more Power Platform engineering-focused than general Microsoft cloud CLIs**
- **usable directly by engineers, CI systems, and AI agents**

A concise positioning statement:

> A library-first, npm-distributed Power Platform engineering toolkit for environments, Dataverse, solutions, canvas apps, cloud flows, and agents.

---

## 4. Goals

### 4.1 Primary goals

- Provide a **consistent environment and solution abstraction** across Power Platform assets.
- Make Power Platform assets **inspectable, scriptable, and automatable** from the CLI.
- Support **agent-friendly workflows** with structured results, deterministic behavior, and safe mutation patterns.
- Support both **Dataverse-backed** and **artifact-backed** assets under one coherent architecture.
- Make cloud flows and canvas apps significantly more developer-friendly.
- Provide a reusable **TypeScript library API** rather than only a CLI.

### 4.2 Secondary goals

- Provide high-quality diff, normalization, and validation tooling.
- Support CI/CD workflows through stable commands and machine-readable outputs.
- Provide a clean path to MCP exposure.

---

## 5. Non-Goals

The project will not initially attempt to:

- replace every PAC feature
- replace every XrmToolBox plugin
- provide a full visual editor
- create a fully novel DSL for every asset type
- depend on unsupported private APIs as the core implementation strategy
- support every Power Platform component in the first release
- promise full parity with Microsoft Studio or PAC across all asset types
- claim universal canvas compilation from zero source when required control/template metadata is unavailable

The project should prefer reliable, explicit, well-bounded functionality over breadth for its own sake.

---

## 6. Target Users

### 6.1 Power Platform engineers
People working across multiple environments, solutions, and assets who want a serious engineering workflow.

### 6.2 Consultants and platform teams
Teams that need repeatable deployment, troubleshooting, and environment comparison workflows.

### 6.3 Tool builders
People building internal tools, scripts, GitHub Actions, or CI/CD pipelines around Power Platform.

### 6.4 AI agents and AI-assisted developers
Users who want to inspect, modify, validate, and deploy assets using agents or model-assisted workflows.

---

## 7. Product Principles

### 7.1 Library-first
All substantial functionality should exist in reusable packages. The CLI and MCP server should be thin layers over the same services.

### 7.2 Environment-aware
The toolkit should treat environments, auth profiles, and solutions as first-class concepts.

### 7.3 Inspect before mutate
Strong read and analysis commands should exist before broad mutation features.

### 7.4 Deterministic outputs
Builds, normalizations, and diffs should be stable and reproducible where possible.

### 7.5 Source-of-truth explicitness
Each asset type must declare its canonical source of truth and what is derived.

### 7.6 Artifact-first where needed
Where existing artifact formats are already deployment-capable, the toolkit should improve them rather than replace them prematurely.

### 7.7 Agent-safe operations
Commands should expose structured output, dry-run modes, validation, and bounded side effects.

### 7.8 Support-tier explicitness
Commands and library operations should declare their support tier and, where relevant, the provenance of external metadata they rely on.

Suggested support tiers:

- `stable` for public, documented, well-tested surfaces
- `preview` for useful but still-shifting features
- `experimental` for features that depend on brittle or environment-specific integrations

Suggested provenance classes:

- `official-api`
- `official-artifact`
- `harvested`
- `inferred`

### 7.9 Provider extensibility
Adjacent provider domains such as SharePoint or Power BI should be added as explicit provider packages. CI/CD systems should be modeled as adapters or deployment integrations, not as peer business domains unless a clear domain model justifies it.

### 7.10 Documentation-friendly outputs
The toolkit should expose structured facts, summaries, and context packs that help humans and coding agents produce accurate documentation. Free-form prose may be generated for convenience, but it must not become the canonical source of truth.

---

## 8. Asset Taxonomy

The project should classify supported assets into four categories.

### 8.1 Dataverse-native assets
These are primarily Dataverse records, metadata, or solution-aware entities.

Examples:

- tables
- columns
- relationships
- model-driven apps
- forms
- views
- charts
- connection references
- environment variables
- solution metadata

### 8.2 Service-layer assets on top of Dataverse
These may be represented partly through Dataverse or solution artifacts, but should not be treated as raw entity editing alone.

Examples:

- cloud flows
- desktop flows
- business process flows
- custom connectors

### 8.3 Artifact-native assets
These require local parsing, transformation, validation, or packaging logic.

Examples:

- canvas apps
- unpacked flow artifacts
- unpacked solution assets where normalization and patching are required

### 8.4 Adjacent provider assets
These belong to external Microsoft or delivery ecosystems that Power Platform teams commonly touch, but they should be modeled as provider domains or adapters rather than folded into the Power Platform core.

Examples:

- SharePoint sites, lists, drives, files, and permissions
- Power BI workspaces, datasets, reports, and deployment metadata
- CI/CD systems and release definitions as automation adapters rather than canonical business assets

This taxonomy should shape module boundaries and implementation choices.

---

## 9. Source of Truth Policy

The toolkit must be explicit about what is canonical for each asset type.

| Asset Type | Canonical Source | Local Editable Form | Derived Output |
|---|---|---|---|
| Dataverse rows / metadata | Platform state | Queries / patches / config files as needed | CLI output, cached metadata |
| Connection references | Platform state | Structured mutation commands | Updated records |
| Environment variables | Platform state | Structured mutation commands | Updated records |
| Model-driven apps | Platform state + solution artifacts | Retrieved metadata / unpacked solution content | Normalized views / patches |
| Canvas apps | Local source + pinned template metadata registry | Source files (`.pa.yaml` and related artifacts), harvested/exported template metadata, seed artifacts where needed | Packaged `.msapp` / deployable artifact |
| Cloud flows | Solution artifact representation | Normalized unpacked artifacts | Repacked solution / deployed state |
| SharePoint assets | SharePoint platform state | Structured commands and optional exported metadata where needed | Updated remote objects / normalized inspection output |
| Power BI assets | Power BI service state + exported artifacts where available | Retrieved metadata / exported definitions | Normalized views / deployment inputs |
| Project parameters | Project/workspace config | Local parameter definitions, secret refs, variable mappings | Resolved deploy/build/doc inputs |

Rules:

1. The toolkit should avoid introducing a new canonical representation unless it can round-trip reliably.
2. A convenience abstraction must never silently lose information.
3. Where unknown fields exist, they should be preserved unless explicitly removed.
4. For compiled artifact domains, required metadata inputs must have explicit provenance and version pinning.
5. Project-defined parameters are distinct from platform environment variables, though they may map to them during build or deploy workflows.

---

## 10. High-Level Architecture

The system should be structured around five layers.

## 10.1 Infrastructure layer
Shared primitives used by all higher layers.

Responsibilities:

- auth and token acquisition
- HTTP transport
- retries and throttling
- config loading
- secrets integration
- caching
- error and diagnostic model

## 10.2 Project layer
Local workspace and repository context that binds source trees to remote targets.

Responsibilities:

- workspace discovery
- project config loading
- local asset inventory
- default environment and solution bindings
- named provider target bindings
- project parameter and secret resolution
- build conventions
- registry and cache selection

## 10.3 Domain modules
Feature-specific packages built on the infrastructure and project layers.

Initial modules:

- `dataverse`
- `solution`
- `model`
- `canvas`
- `flow`
- `artifacts`
- `sharepoint`
- `powerbi`

Notes:

- CLI command groups do not need to imply package boundaries.
- `connref` and `envvar` may remain first-class user-facing command groups while being implemented as Dataverse- and solution-aware services rather than standalone packages.
- `flow` should be architected primarily as a Dataverse- and solution-backed domain with artifact helpers, not as a compiler pipeline like `canvas`.
- `canvas` should remain a dedicated artifact compilation domain because its build path depends on template metadata resolution and packaging logic that are not naturally shared with Dataverse-native assets.
- Adjacent providers such as SharePoint and Power BI should be added as provider packages, each with its own client and resource model.
- CI/CD systems should be represented through deployment workflows and automation adapters rather than as peer business-domain packages by default.

## 10.4 Application and analysis layer
Cross-domain orchestration built on the lower layers.

Responsibilities:

- deployment workflows
- preflight and doctor checks
- environment comparison
- multi-domain inspection and explanation
- cross-provider rollout coordination
- documentation-oriented reporting and context generation

## 10.5 Interface layers
Thin packages that expose the domain and application layers.

- CLI package
- MCP server package
- optional automation or CI adapters later

Interface layers must not become the home for provider-specific business logic or long-lived domain services. Existing tools may be wrapped initially, but reusable logic should be extracted into domain packages rather than copied into the CLI package.

### 10.6 Dependency direction

Preferred dependency rules:

- `solution -> dataverse`
- `model -> dataverse, solution`
- `flow -> dataverse, solution, artifacts, project`
- `canvas -> artifacts, project`
- `sharepoint -> http, auth, project`
- `powerbi -> http, auth, project`
- `deploy -> solution, flow, canvas, sharepoint, powerbi, project`
- `analysis -> dataverse, solution, model, flow, canvas, sharepoint, powerbi, project`
- `reporting/doc-context -> analysis, deploy, project` later if extracted
- `adapters/* -> deploy, analysis`
- `cli` and `mcp` depend on domain and application services only
- domain packages must not depend on `cli`, `mcp`, `deploy`, or `analysis`

---

## 11. Monorepo Structure

```text
packages/
  auth/
  http/
  diagnostics/
  cache/
  config/
  project/
  dataverse/
  solution/
  model/
  canvas/
  flow/
  artifacts/
  sharepoint/
  powerbi/
  analysis/
  deploy/
  adapters/
    github-actions/
    azure-devops/
    power-platform-pipelines/
  cli/
  mcp/
```

### 11.1 Recommended tooling

- `pnpm` workspaces
- TypeScript
- ESM packages
- `zod` for schema validation
- native `fetch` / `undici`
- `@azure/msal-node` for auth
- `vitest` for tests
- `tsup` or equivalent for builds

---

## 12. Core Domain Model

### 12.1 Profile
Represents an auth mechanism and tenant context.

Fields:

- name
- auth type
- tenant id
- client id if applicable
- secret reference if applicable
- default scopes / resource settings

### 12.2 Environment
Represents a named Power Platform environment alias.

Fields:

- alias
- environment URL
- tenant id
- auth profile
- display name if known
- default solution optional

### 12.3 Solution alias
Represents a named shortcut to a solution in an environment.

Fields:

- alias
- environment alias
- unique name

### 12.4 Project context
Represents the local engineering context for a repo or working directory.

Fields:

- project root
- local asset roots
- default environment alias optional
- default solution alias optional
- named provider bindings optional
- project parameter definitions optional
- secret references and variable mappings optional
- template registry locations
- cache locations
- build conventions optional

### 12.5 Asset reference
Represents a cross-domain identity.

Fields:

- kind
- environment
- solution optional
- logical name / unique name / id

### 12.6 Operation result
All commands should return a structured result with:

- success flag
- diagnostics
- primary payload
- warnings
- suggested next actions optional
- support tier
- provenance metadata optional
- known limitations optional

---

## 13. Package Responsibilities

## 13.1 `auth`
Responsibilities:

- profile loading and saving
- token acquisition
- multi-tenant support
- service principal and interactive login flows

## 13.2 `http`
Responsibilities:

- authenticated request pipeline
- retries and throttling
- transport policies
- serialization helpers
- provider-specific base client plumbing

## 13.3 `diagnostics`
Responsibilities:

- common error model
- structured diagnostics
- warning and limitation reporting
- operation result helpers

## 13.4 `cache`
Responsibilities:

- local cache primitives
- metadata snapshot storage
- template registry cache helpers
- safe cache invalidation

## 13.5 `config`
Responsibilities:

- config file discovery
- workspace config
- user config
- secret reference resolution

## 13.6 `project`
Responsibilities:

- project root discovery
- project config loading
- local asset inventory
- default environment and solution bindings
- named provider target bindings
- project parameter and secret resolution
- variable mapping into deploy and build inputs
- local registry discovery
- build convention resolution

## 13.7 `dataverse`
Responsibilities:

- generic Dataverse client
- CRUD helpers
- OData querying
- metadata lookup
- actions / functions
- paging helpers
- batch helpers later
- connection reference and environment variable service surfaces
- other Dataverse-native resource helpers that do not justify their own package

## 13.8 `solution`
Responsibilities:

- list and inspect solutions
- import/export wrappers
- unpack/pack orchestration where needed
- dependency and missing-component analysis
- deployment helpers

## 13.9 `model`
Responsibilities:

- list model-driven apps
- inspect model app metadata
- inspect site maps, pages, forms, and views
- dependency tracing

## 13.10 `artifacts`
Responsibilities:

- shared local-file helpers
- normalization primitives
- diff helpers
- patch application primitives
- unknown-field preservation utilities
- content hashing and stable ordering helpers

## 13.11 `canvas`
Responsibilities:

- parse source
- validate source and references
- template resolution
- build package artifacts
- inspect and diff extracted apps
- deterministic packaging

## 13.12 `flow`
Responsibilities:

- enumerate flows
- inspect and summarize flows
- export/unpack/normalize/repack flow artifacts
- validate flow artifacts
- patch flow artifacts safely
- inspect runs and failures
- inspect connection refs and environment variable usage
- build on `dataverse`, `solution`, and `artifacts` rather than re-owning those concerns

## 13.13 `analysis`
Responsibilities:

- preflight checks
- missing dependency detection
- environment comparison
- solution diagnostics
- doctor-style reports across multiple asset types
- deployment-oriented orchestration across multiple domains
- documentation-ready summaries, inventories, and context packs for human and agent authors

## 13.14 `sharepoint`
Responsibilities:

- SharePoint client and site resolution
- list, drive, file, and permission inspection
- safe mutation helpers for common automation tasks
- metadata retrieval for cross-domain analysis

## 13.15 `powerbi`
Responsibilities:

- Power BI workspace, dataset, and report inspection
- export/import wrappers where supported
- deployment-oriented metadata access
- metadata retrieval for cross-domain analysis

## 13.16 `deploy`
Responsibilities:

- environment-to-environment rollout workflows
- coordinated deploy plans across multiple domains
- preflight/apply/report execution model
- adapter-facing deployment service surface
- resolution of project parameters, secrets, and variable mappings into deploy operations

## 13.17 `adapters/*`
Responsibilities:

- CI/CD platform integration
- credential handoff into library services
- pipeline-friendly entrypoints and wrappers
- no business-domain logic

---

## 14. CLI Design

The CLI should follow a stable noun-verb pattern.

Command groups are a user-interface decision and do not need to map one-to-one to package boundaries.

Examples:

```bash
pp auth login
pp env add
pp env list
pp env use

pp dv query account --select name --top 10
pp dv get connectionreference <id>

pp solution list
pp solution set-metadata core --version 1.2.3.4
pp solution export core
pp solution analyze core

pp connref list
pp connref validate --solution core

pp envvar list
pp envvar set ApiBaseUrl https://example.com

pp model list
pp model inspect SalesHub

pp canvas validate ./apps/MyCanvas
pp canvas build ./apps/MyCanvas --out ./dist/MyCanvas.msapp
pp canvas inspect ./apps/MyCanvas

pp flow list
pp flow inspect MyFlow
pp flow unpack ./solution.zip --out ./src
pp flow validate ./src/MyFlow
pp flow patch ./src/MyFlow --file ./changes.json
pp flow runs MyFlow --status Failed --since 7d
pp flow errors MyFlow --group-by errorCode

pp sharepoint site inspect marketing
pp sharepoint list items --site marketing --list Campaigns

pp powerbi workspace inspect Finance
pp powerbi report list --workspace Finance

pp analysis report core --format markdown
pp analysis context --project . --asset flow:InvoiceSync

pp deploy plan --project .
pp deploy apply --plan ./dist/release-plan.json
```

### 14.1 Output modes
All commands should support:

- `table`
- `json`
- `yaml`
- `ndjson`
- `markdown` for report and documentation-oriented output where useful
- `raw` where useful

### 14.2 Safe mutation options
Mutation commands should support where practical:

- `--dry-run`
- `--plan`
- `--yes`
- `--output json`

### 14.3 Machine-friendly behavior
- exit codes should be reliable
- errors should be structured
- output should avoid mixing logs into JSON payloads

---

## 15. Config and State

The toolkit should support both global and project/workspace-level config.

### 15.1 Global config
Stores:

- auth profiles
- environment aliases
- default output mode
- user preferences

### 15.2 Project/workspace config
Stores:

- project-specific environment defaults
- solution aliases
- local asset mappings
- named provider bindings
- project parameter definitions
- secret-backed variable references
- local template registry locations
- optional build conventions

Project/workspace parameters are local inputs to build, deploy, analysis, and documentation workflows. They are not the same thing as Dataverse environment variables, though the toolkit may map them onto platform environment variables where appropriate.

### 15.3 Cache
A local cache may store:

- resolved environment metadata
- Dataverse metadata snapshots
- template metadata
- recent lookup information

The cache must be safe to clear.

---

## 16. Canvas Module Spec

Canvas apps are a special case and should be treated as a dedicated artifact pipeline.

### 16.1 Problem
Canvas source files are not by themselves the full deployable runtime form. Additional packaging and metadata generation logic is needed.

### 16.2 Objectives

- make local canvas editing viable
- validate YAML and Power Fx references
- generate required packaging artifacts deterministically
- support agent-friendly inspection and patching

### 16.3 Reality constraints

- Microsoft does not currently expose a complete, stable, public compiler contract for built-in canvas control definitions.
- The toolkit must therefore treat built-in control/template metadata as a required external input, not as something assumed to be derivable from source alone.
- From-zero builds are supported only when all required template metadata is available in the local registry or supplied seed artifacts.
- App-defined components may be source-authored, but built-in controls used within them still depend on external template metadata.
- The canvas module must be explicit about whether a build is `seeded`, `registry-backed`, or `unsupported`.

### 16.4 Core pipeline

1. parse source files
2. build intermediate model
3. resolve templates and defaults
4. validate structure and formulas
5. generate runtime artifacts
6. package into deployable output

### 16.5 Template metadata strategy

The canvas module should maintain a template registry with explicit provenance.

Acceptable registry sources:

- official/public schema documentation for baseline validation only
- exported app artifacts such as `References/Templates.json`, `Controls/*.json`, `ControlTemplates.json`, and `pkgs/*.xml`
- curated or imported local catalogs checked into a repository or cache
- optional environment-backed harvesters, isolated behind experimental adapters

Registry entries should capture at minimum:

- template name
- template version
- aliases used in source (display name, constructor, YAML short name)
- provenance class
- acquisition date
- source app or artifact identifier when available
- source platform/app version when known
- content hash

The registry should support:

- offline use once metadata has been acquired
- pinning and diffing
- deterministic resolution
- explicit failure when required metadata is missing

### 16.6 Build modes

Suggested build modes:

- `strict` (default): fail if required template metadata is missing
- `seeded`: resolve only from metadata supplied with the source app or seed artifacts
- `registry`: resolve from a local pinned template registry

The build path should not attempt live harvesting during normal package creation. Metadata acquisition should be a separate workflow.

### 16.7 Internal components

- source parser
- semantic validator
- template registry
- template provenance tracker
- support matrix resolver
- control graph builder
- package builder
- inspector
- diff engine

### 16.8 Commands

- `canvas validate`
- `canvas build`
- `canvas inspect`
- `canvas diff`
- `canvas templates inspect`
- `canvas templates import`
- `canvas templates harvest` later (experimental)

---

## 17. Flow Module Spec

Flows should be treated as **artifact-first, semantics-enhanced**, not DSL-first.

### 17.1 Problem
The existing flow artifact representation is deployment-capable, but the authoring and diagnostic experience is poor for engineering and agent use.

### 17.2 Objectives

- treat flow artifacts as source-controlled assets
- make exported flow artifacts easier to inspect and patch
- provide runtime observability from CLI
- provide safe deployment workflows

### 17.3 Scope

Initial scope:

- enumerate flows in an environment and solution
- inspect flow metadata and relationships
- unpack and normalize flow artifacts
- validate artifact structure
- patch artifacts safely
- inspect runs and failures
- inspect connection references and variable usage

### 17.4 Out of scope for MVP

- full custom flow DSL as the canonical source format
- attempt to replace the full maker UI
- lossy round-trip abstractions

### 17.5 Flow local workflow

1. export solution or select flow artifact source
2. unpack flow artifacts
3. normalize file structure and noisy metadata
4. inspect / query / patch
5. validate
6. repack or deploy
7. inspect runs post-deploy

### 17.6 Normalization rules

Possible normalization behaviors:

- stable property ordering
- removal or segregation of obviously noisy metadata
- separation of metadata and definition content where safe
- consistent formatting
- preservation of unknown fields

### 17.7 Safe patch model
Rather than inventing a full new DSL, the toolkit should support structured patch operations against the real artifact format.

Examples:

- replace connection reference id
- update parameter expressions
- replace action input nodes
- inject environment-specific values

### 17.8 Runtime diagnostics
The flow module should expose:

- run listings
- failure summaries
- duration and retry insights
- grouping by error code or connector
- related parent/child run investigation where possible

### 17.9 Commands

- `flow list`
- `flow inspect`
- `flow unpack`
- `flow normalize`
- `flow validate`
- `flow patch`
- `flow deploy`
- `flow runs`
- `flow errors`
- `flow connrefs`
- `flow doctor`

---

## 18. Model-Driven Module Spec

Model-driven apps should be supported as a Dataverse-backed, solution-aware domain.

### 18.1 Objectives

- list and inspect model-driven apps
- inspect app composition
- inspect related forms, views, tables, and site maps
- trace dependencies and missing components

### 18.2 Commands

- `model list`
- `model inspect`
- `model sitemap`
- `model forms`
- `model views`
- `model dependencies`

---

## 19. Solution and Analysis Spec

Solutions provide the primary ALM boundary across many asset types.

### 19.1 Objectives

- inspect solutions and components
- compare environments
- identify missing dependencies
- explain import/export failures better
- provide preflight checks before deployment

### 19.2 Commands

- `solution list`
- `solution inspect`
- `solution export`
- `solution import`
- `solution components`
- `solution dependencies`
- `solution analyze`
- `solution compare`

### 19.3 Analysis capabilities

- missing connection reference detection
- missing environment variable detection
- missing component detection
- cross-environment drift detection
- asset usage reports

---

## 20. API and Library Design

The library API should expose stable service interfaces rather than forcing consumers to shell out.

### 20.1 Service style
Each domain package should expose one or more service objects and typed request / response models.

Example style:

```ts
const client = await createToolkitClient({ environment: 'uat' })
const flows = await client.flow.list()
const runs = await client.flow.getRuns({ flow: 'InvoiceSync', status: 'Failed' })
```

### 20.2 Design guidelines

- typed inputs and outputs
- no hidden global state
- explicit environment selection
- explicit mutation methods
- reusable error model across domains

### 20.3 Public API stability
The project should use explicit package exports and avoid leaking internal deep imports.

---

## 21. MCP Design

The MCP package should wrap stable library operations rather than implementing its own business logic.

### 21.1 Initial MCP tool surface
Potential tools:

- list environments
- list solutions
- query Dataverse
- inspect connection references
- inspect environment variables
- inspect model-driven apps
- inspect flow runs
- inspect SharePoint assets
- inspect Power BI assets
- validate canvas source
- build canvas package
- plan deployment workflows
- generate documentation/context packs

### 21.2 Mutation policy
The MCP surface should default to conservative behavior.

Suggested approach:

- read-first initial tools
- explicit opt-in for mutation tools
- dry-run support where possible
- clear structured validation output before apply

---

## 22. Safety and Reliability Requirements

### 22.1 Mutation safety
- commands should be bounded and explicit
- destructive operations should require clear confirmation or flags
- dry-run should be supported where practical

### 22.2 Determinism
- normalization should be stable
- packaging should be reproducible where possible
- IDs or generated fields should be stable where possible

### 22.3 Unknown-field preservation
For artifact editing, unknown fields must be preserved unless the user explicitly requests otherwise.

### 22.4 Auth safety
- secrets should never be stored in plaintext unnecessarily
- secret references should support environment or secure store integration
- logs must avoid leaking tokens or secrets

---

## 23. Testing Strategy

The project needs strong automated coverage because it will manipulate deployment-critical artifacts.

### 23.1 Unit tests
- parsers
- normalizers
- patch engines
- command argument parsing
- config loading

### 23.2 Golden file tests
Especially for:

- canvas builds
- canvas template registry imports
- flow normalization
- flow patching
- solution analysis outputs

### 23.3 Integration tests
- auth flows where feasible
- Dataverse Web API against test environments
- end-to-end CLI commands against fixtures

### 23.4 Round-trip tests
Required for any artifact mutation path:

- unpack
- normalize
- patch
- validate
- repack

### 23.5 Live-environment and harvester tests
Some capabilities depend on external environments and should be tested separately from normal fast CI.

Examples:

- gated smoke tests against a dedicated Power Platform development environment
- canvas template harvesting against a dedicated seed app
- import/build verification for curated supported canvas fixtures

These tests should run on isolated schedules or manual triggers, not on every pull request.

---

## 24. Packaging and Distribution

### 24.1 Distribution goals
- installable from npm
- usable as a CLI executable via `bin`
- consumable as library packages

### 24.2 Package strategy
Potential published packages:

- `@scope/pp-core`
- `@scope/pp-dataverse`
- `@scope/pp-canvas`
- `@scope/pp-flow`
- `@scope/pp-cli`
- `@scope/pp-mcp`

### 24.3 Versioning
Use semver. Public library and CLI stability should be managed explicitly.

---

## 25. MVP Definition

### 25.1 MVP objective
Prove the core architecture and establish clear value in real engineering workflows.

### 25.2 MVP scope

- auth profiles
- environment registry
- Dataverse query and get commands
- solution listing and analysis basics
- connection reference list / validate
- environment variable list / set
- canvas validate / build for an explicitly supported control and template-version matrix, using the existing canvas work adapted into the new architecture and backed by pinned template metadata
- flow list / inspect / runs / errors
- flow unpack / normalize / validate / patch basics

### 25.3 Explicit MVP exclusions
- full custom flow DSL
- support for every Power Platform asset type
- desktop flow deep support
- rich editor integrations
- advanced plugin marketplace

---

## 26. Roadmap

### Phase 1: core foundation
- monorepo setup
- auth
- env registry
- config
- Dataverse client
- base CLI and output model

### Phase 2: Dataverse and ALM basics
- Dataverse queries
- solution list / inspect
- connection references
- environment variables
- analysis basics

### Phase 3: canvas integration
- migrate or wrap current canvas tooling
- define the template registry schema, provenance model, and support matrix
- validate / build / inspect
- add template import workflows
- keep harvesting as an experimental, separately triggered capability

### Phase 4: flow artifact and runtime tooling
- flow discovery
- artifact normalization
- runtime diagnostics
- safe patching

### Phase 5: model-driven and MCP
- model-driven inspection
- initial MCP server with read-focused tools

---

## 27. Success Criteria

The project will be successful if:

- engineers can move between environments and assets without UI friction
- common ALM and diagnostic tasks become scriptable
- canvas apps within the declared support matrix can be built from local source reliably
- flows can be inspected, normalized, patched, validated, and observed from CLI
- AI agents can use the toolkit safely through structured outputs and bounded operations
- the library is useful independently of the CLI

---

## 28. Key Risks

### 28.1 Unsupported or unstable surfaces
Some useful operations may depend on surfaces that are not ideal to build a product around.

Mitigation:
- clearly classify supported versus best-effort features
- isolate risky integrations behind adapters

### 28.2 Artifact round-trip fragility
Flow and canvas artifacts may contain edge cases that make editing hard.

Mitigation:
- preserve unknown fields
- emphasize validation and golden tests
- avoid lossy abstractions

### 28.3 Scope explosion
Power Platform is broad, and feature requests can multiply quickly.

Mitigation:
- focus on a clear asset taxonomy and phased roadmap
- prioritize inspectable, reusable primitives

### 28.4 Agent safety
A powerful tool can also be dangerous when used by agents.

Mitigation:
- dry-run modes
- conservative defaults
- explicit mutation APIs

### 28.5 Canvas template availability and drift
Canvas compilation may depend on metadata that is not published as a complete stable public feed.

Mitigation:
- pin template metadata with provenance
- define and publish an explicit support matrix
- keep harvesting separate from normal build flows
- fail clearly when required metadata is missing rather than guessing

---

## 29. Open Questions

1. What exact package and CLI name should be used?
2. How much of solution import/export should rely on official external tooling versus direct implementation?
3. Should the first release include any write support for model-driven app metadata, or inspection only?
4. Should flow deployment initially operate at solution scope only, or allow flow-targeted workflows as a convenience layer?
5. Should workspace config support project-specific asset maps from day one?
6. What degree of caching is acceptable before staleness becomes confusing?
7. How much mutation capability should the first MCP release expose?
8. What is the initial canvas template acquisition strategy: seed artifacts only, imported catalogs, or an experimental harvester?
9. What exact control/version support matrix defines canvas MVP?

---

## 30. Immediate Next Steps

1. Choose a project name and repository structure.
2. Define the core TypeScript packages and public interfaces.
3. Implement auth, env registry, and Dataverse query support first.
4. Decide how the existing canvas code will be integrated or ported.
5. Define the canvas template registry schema, provenance model, and initial support matrix.
6. Decide whether any canvas template harvesting workflow lives in-repo as experimental infrastructure or in a separate refresh pipeline.
7. Build a first flow artifact spike to prove normalize / inspect / patch reliability.
8. Audit `dvcli` for reusable auth/env/http/output patterns, but avoid importing its monolithic CLI structure into the new architecture.
9. Draft a command naming guide before too many commands accumulate.

---

## 31. Summary

This project should be built as a **TypeScript monorepo for Power Platform engineering**, centered on:

- a shared environment-aware core
- a strong Dataverse substrate
- dedicated artifact tooling for canvas and flows
- robust inspection and diagnostics
- safe automation and agent integration

The key strategic choices are:

- **library-first rather than CLI-only**
- **artifact-first for flows rather than DSL-first**
- **compiler/build treatment for canvas apps**
- **solution-aware analysis as a core feature**
- **deterministic, inspectable, agent-safe operations throughout**
