# `pp` Documentation

`pp` is a CLI tool for working with the Power Platform. It handles authentication, Dataverse inspection, solution lifecycle, canvas offline validation and build, flow artifact management, and model-driven app inspection. These docs are organized around those tasks, so you can get to the right guide quickly.

## Start here

If you are new to `pp`, the [Quickstart](quickstart.md) walks you through your first session -- from building the CLI to running `pp dv whoami` and `pp solution inspect`. After that, [Auth and environments](auth-and-environments.md) explains how sign-in works, how to save profiles, and how environment aliases let you avoid repeating Dataverse URLs. Once auth makes sense, [Dataverse and solutions](dataverse-and-solutions.md) covers the core remote workflow that most `pp` usage revolves around.

## Common tasks

When you already know what you need to do, jump straight to the relevant guide:

- [Set up auth and environment aliases](auth-and-environments.md)
- [Inspect Dataverse tables, rows, and metadata](dataverse-and-solutions.md)
- [Create, inspect, and export solutions](dataverse-and-solutions.md)
- [Install the CLI, package it, and collect diagnostics](operability.md)

## Product boundaries

These guides describe what `pp` covers well today, where there are known limitations, and how the command surface behaves.

- [Supported surfaces](supported-surfaces.md): adoption guidance and current limitations
- [Safety and provenance](safety-and-provenance.md): mutation safety, structured result metadata, and provenance expectations
- [Command contract](command-contract.md): output formats and shared command behavior

## Domain guides

Once you know the core workflow you want, these guides go deeper into individual Power Platform domains:

- [Canvas](canvas.md): offline inspection, validation, build, diff, workspace inspection, and registry-backed authoring
- [Canvas harvesting](canvas-harvesting.md): how pinned canvas registries are refreshed from a controlled environment
- [Flow](flow.md): remote inspection plus local `flow.json` artifact lifecycle
- [Model-driven apps](model.md): model app inspection and create/attach authoring

## Contributor and platform reference

These guides are aimed at contributors and people who need to understand the internals. They are not the best first read if you are trying to get work done with the CLI.

- [Architecture](architecture.md): package ownership, layering, and repo shape
- [MCP](mcp.md): MCP server surface and current tool boundaries
- [Operability](operability.md): packaging, shell completion, diagnostics, and large-repo usage
- [Testing](testing.md): fixture refresh and live validation lanes
- [Skills](skills.md): skill packaging conventions used in this repo

## Planning and spec material

The main docs focus on the implemented surface. Longer-term spec material lives separately in [the engineering toolkit spec](specs/power_platform_cli_spec.md).

## About these docs

The goal of this documentation is to tell you what `pp` can do today, with enough detail to actually use it. The guides prefer task-oriented explanations over package inventories, and they are explicit about real limitations rather than glossing over incomplete areas. Roadmap and long-term architecture are treated as secondary material -- useful context, but not the starting point.
