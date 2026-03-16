# Architecture

This guide is for contributors who need to understand where behavior belongs in the repo. It is not the best starting point for learning how to use `pp` -- for that, start with the [Quickstart](quickstart.md) or [Dataverse and solutions](dataverse-and-solutions.md) guide.

## Mental model

`pp` is a package-first monorepo. The CLI is the main shipped interface, but most behavior lives in narrower workspace packages with explicit contracts. The repo has three practical layers: core infrastructure and shared contracts, domain packages for Power Platform services, and interface layers such as the CLI and MCP server. That split matters because most user-facing commands are compositions of the same underlying services -- a `pp solution export` call, for example, depends on auth, config, the Dataverse client, and the solution package, all coordinated by the CLI layer.

## Package map

The **core packages** provide infrastructure that every other package depends on. `@pp/auth` handles auth profiles, browser-profile management, and token acquisition. `@pp/config` owns persisted configuration for auth profiles, environment aliases, and project config file discovery (`pp.config.json|yaml|yml`). `@pp/diagnostics` defines `OperationResult`, diagnostics, and failure helpers that give the CLI a consistent way to report outcomes. `@pp/http` provides shared HTTP helpers, `@pp/artifacts` handles stable JSON and YAML artifact IO, and `@pp/cache` provides local cache primitives and metadata snapshot storage.

The **domain packages** sit on top of that core layer and each own one Power Platform service area. `@pp/dataverse` covers Dataverse client resolution, rows, metadata, connection references, and environment variables. `@pp/solution` handles solution lifecycle operations: analysis, compare, pack/unpack, and import/export. `@pp/canvas` provides template registries, offline validation and build, diff, LSP support, and harvesting helpers. `@pp/flow` covers flow discovery, runtime inspection, artifact lifecycle, graph traversal, and patch helpers. `@pp/model` handles model-driven app inspection and dependency tracing. Keeping these separate from the core means each domain can evolve its API surface without entangling unrelated services.

The **interface packages** are what users and tools interact with directly. `@pp/cli` is the main command-line interface. `@pp/mcp` exposes the same domain packages through an MCP server. `@pp/flow-language-server` is a standalone flow LSP server, and `@pp/vscode` is the VS Code extension for canvas and flow language support.

## Runtime flow

A typical CLI command follows a consistent path through these layers. First, `@pp/cli` parses argv and shared output flags. It then resolves configuration through `@pp/config`, including auth profiles and environment aliases. Next, it calls into a domain package such as `@pp/dataverse`, `@pp/solution`, or `@pp/flow` to do the actual work. Finally, the result is normalized through `@pp/diagnostics` and rendered according to the shared command contract.

## What matters most in practice

The strongest current slices are auth/config, Dataverse inspection and metadata authoring, solution lifecycle, canvas offline validation/build, and flow artifact lifecycle. MCP exposes a growing read and bounded-mutation surface over the same domain packages.

Use [supported-surfaces.md](supported-surfaces.md) for product adoption guidance. Use this architecture guide only when you need to place new code or reason about ownership boundaries.
