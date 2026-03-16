# Supported surfaces

This guide helps you decide what to confidently use in `pp` today, what is
worth using when you need it, and what is still incomplete.

## Recommended for routine use

The best place to start with `pp` is its core infrastructure: auth profile
management and environment aliases, Dataverse reads and generic Web API access,
Dataverse metadata inspection and the current typed metadata authoring surface,
solution lifecycle commands, and the shared diagnostics, output formatting, and
support bundle tooling. If you are adopting `pp` for real work, start here.

## Good, but more specialized

Several areas are useful and documented, but they are usually a second step
after the core workflows above. Canvas offline inspection, validation, lint,
build, diff, workspace inspection, and template registry management are all
solid. Flow local artifact normalization and validation work well through the
CLI, as do flow remote discovery, export, inspect, activate, and connection
reference inspection. More advanced flow capabilities like deploy, promote,
runs, errors, doctor, monitor, graph, pack, and patch are available through the
library API and MCP rather than the CLI. Model-driven app inspection and
create/attach authoring are useful for solution composition work. The MCP server
exposes bounded read and mutation tools across all these domains.

These are not weak areas. They are simply not the first workflows most users
should learn.

## Still incomplete

Some areas should be described plainly as incomplete. Remote canvas create and
import paths still depend on Maker handoff guidance or delegated browser
automation. Flow runtime correlation is limited when the required runtime
evidence is missing or thin. MCP as a broad automation surface does not yet
cover everything beyond the current implemented tool set. Packaging and
installation ergonomics are still stronger for repo users than for general CLI
distribution.

## Practical adoption order

The most reliable path through the product is to start by setting up auth
profiles and environment aliases, then use `pp dv` and `pp solution` for
inspection and controlled changes. Add flow, canvas, or model workflows when
your project actually needs them.

## Specific limitations that matter

Some live workflows still depend on browser-mediated auth or maker-session
bootstrapping. Canvas registry quality depends on the harvested metadata you
commit to the repo. Flow remote deploy and promotion are library and MCP
capabilities, not CLI commands. Packaging and install ergonomics are still
stronger for repo users than for general CLI distribution.

## How to read the rest of the docs

Start with [quickstart.md](quickstart.md) if you are new. Read
[dataverse-and-solutions.md](dataverse-and-solutions.md) for the core remote
workflow. Read [architecture.md](architecture.md) only when package ownership
or repo layering actually matters to the task in front of you.
