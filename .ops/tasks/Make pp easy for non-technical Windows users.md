---
title: Make pp easy for non-technical Windows users
status: open
priority: high
owner: codex
tags:
  - windows
  - packaging
  - installer
  - ui
  - desktop
  - electron
  - mcp
  - onboarding
created_at: 2026-04-09T11:06:31Z
updated_at: 2026-04-19T03:01:58Z
type: task
---

Make the overall `pp` product significantly easier for non-technical Windows
users to discover, install, launch, and update. Cover both CLI and UI paths,
including self-contained Windows executables, a standard installer, Start menu
entry points, and a smoother `pp ui` startup experience that does not require
keeping a terminal open.

## Current Direction

Move from a CLI-owned browser UI toward separate user-facing artifacts that all
share the same implementation library and config:

- `PP Desktop`: Electron app for non-technical and technical users who want a
  polished Windows application.
- `pp.exe`: CLI for terminal, scripting, automation, and advanced workflows.
- `pp-mcp.exe`: stdio MCP server for AI clients.

The CLI, MCP server, and desktop app should all call shared core modules
directly. They should not shell out to each other for normal behavior.

## Shared Core

Make the shared library boundary explicit. It should own:

- config location and schema migrations
- account and environment services
- MSAL/token cache handling
- request execution
- Dataverse, Flow, Graph, BAP, Power Apps, and Canvas Authoring service clients
- validation, language, and helper logic used by more than one host

Split language features into reusable layers:

- pure language engines in shared core, such as FetchXML parsing/completions/
  diagnostics and Power Automate workflow/expression analysis
- metadata-backed language services in shared core, such as FetchXML analysis
  enriched with Dataverse entity metadata or future Power Automate connector
  metadata
- renderer-only editor adapters for CodeMirror/Monaco integration, completion
  UI mapping, diagnostics rendering, debounce, and cancellation

All hosts should use the same default config directory so a user can sign in in
Desktop and then use the same accounts/environments from CLI or MCP.

## Desktop

Treat Electron as the long-term desktop host and target typed Electron IPC from
the first desktop implementation. Do not make the initial Desktop app a wrapper
around the existing localhost `pp ui` server. The Electron main process should
own app lifecycle and expose a narrow IPC/preload API backed by shared core
services.

Desktop IPC should expose language operations where config, auth, API metadata,
or shared caches are involved. The renderer may import pure language engines
directly only when they do not need config, auth, or network-backed enrichment.

Desktop should become the default user-facing experience from the installer. It
needs proper app identity, Start menu integration, single-instance behavior,
clean quit/reopen behavior, diagnostics export, and setup/auth recovery paths
that do not assume terminal knowledge.

## CLI

Keep the CLI focused on terminal workflows. Remove the `pp ui` command and the
`pp-ui` artifact as part of the Desktop split:

- remove `pp ui` from CLI help and docs
- stop building/installing `pp-ui`
- migrate UI tests and development workflows to Desktop/renderer harnesses
- retire localhost UI/LAN mode rather than preserving it as compatibility

## MCP

Keep MCP as its own installed artifact, not as a subcommand that requires the
CLI artifact. It should use shared core and shared config directly.

Default MCP behavior should stay non-interactive. Desktop or CLI should own
account setup, while MCP consumes the already-configured accounts and
environments. Installer-generated MCP client config should prefer absolute paths
when PATH is not selected, for example `C:\Program Files\PP\pp-mcp.exe`.

## Installer

Restructure the Windows installer around optional components:

- `PP Desktop`
- `MCP server`
- optional MCP client configuration for detected clients
- `Command-line tools`
- optional `Add pp to PATH`

The installer should launch `PP Desktop`, not `pp-ui`, after installation.
