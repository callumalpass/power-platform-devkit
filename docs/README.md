# `pp` Documentation

These docs should help you use `pp` to do practical work.

The most important workflows in `pp` today are:

- signing in and managing environment aliases
- inspecting Dataverse and solutions
- modeling a repo with `pp.config.yaml`
- planning and applying controlled deploys

The docs below are organized around those jobs first. Architecture, extension
mechanics, and long-term product spec material are still available, but they
are reference material, not the starting point.

## Start here

If you are new to `pp`, read these in order:

1. [Quickstart](quickstart.md): first successful session from repo checkout to
   `pp project doctor`, `pp dv whoami`, and `pp solution inspect`
2. [Auth and environments](auth-and-environments.md): how sign-in works, how
   to save profiles, and how aliases map commands to Dataverse environments
3. [Dataverse and solutions](dataverse-and-solutions.md): the core remote
   workflow in `pp`
4. [Project config](project-config.md): how to model a repo so analysis and
   deploy commands share the same contract
5. [Deploy](deploy.md): how to preview and apply supported deploy operations

## Common tasks

Use these guides when you already know the job you need to do:

- [Set up auth and environment aliases](auth-and-environments.md)
- [Inspect Dataverse tables, rows, and metadata](dataverse-and-solutions.md)
- [Create, inspect, and export solutions](dataverse-and-solutions.md)
- [Initialize a repo with `pp.config.yaml`](project-config.md)
- [Run project diagnostics and analysis](project-config.md)
- [Plan and apply a deployment](deploy.md)
- [Install the CLI, package it, and collect diagnostics](operability.md)

## Product boundaries

Read these when you need to understand what is recommended, what is specialized,
and what is still incomplete:

- [Supported surfaces](supported-surfaces.md): adoption guidance and current
  limitations
- [Safety and provenance](safety-and-provenance.md): mutation safety,
  structured result metadata, and provenance expectations
- [Command contract](command-contract.md): output formats and shared command
  behavior

## Domain guides

These are useful after you know the core workflow you want:

- [Canvas](canvas.md): offline inspection, validation, build, diff, workspace
  inspection, and registry-backed authoring
- [Canvas harvesting](canvas-harvesting.md): how pinned canvas registries are
  refreshed from a controlled environment
- [Flow](flow.md): remote inspection plus local `flow.json` normalize,
  validate, patch, pack, deploy, and promote workflows
- [Model-driven apps](model.md): model app inspection and create/attach authoring

## Contributor and platform reference

These are important, but they are not the best first read for a new operator:

- [Architecture](architecture.md): package ownership, layering, and repo shape
- [Extensions](extensions.md): extension contract, trust policy, and
  contribution model
- [MCP](mcp.md): MCP server surface and current tool boundaries
- [Operability](operability.md): packaging, shell completion, diagnostics, and
  large-repo usage
- [Testing](testing.md): fixture refresh and live validation lanes
- [Skills](skills.md): skill packaging conventions used in this repo

## Planning and spec material

The main docs focus on the implemented surface. Longer-term spec material lives
separately:

- [Engineering toolkit spec copy](specs/power_platform_cli_spec.md)

## What to expect from these docs

- The docs should tell you what `pp` is good at today.
- They should prefer task-oriented usage over package inventory.
- They should be explicit about real limitations.
- They should treat roadmap or long-term architecture as secondary material.
