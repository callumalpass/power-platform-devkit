---
id: local:task:tasks/Make pp easy for non-technical Windows users.md
provider: local
kind: task
key: tasks/Make pp easy for non-technical Windows users.md
external_ref: tasks/Make pp easy for non-technical Windows users.md
target_path: tasks/Make pp easy for non-technical Windows users.md
remote_title: Make pp easy for non-technical Windows users
remote_state: open
remote_url: tasks/Make pp easy for non-technical Windows users.md
remote_updated_at: 2026-04-19T03:01:58Z
last_seen_remote_updated_at: 2026-04-19T03:01:58Z
local_status: triaged
priority: high
difficulty: hard
risk: medium
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
sync_state: clean
last_analyzed_at: 2026-04-19T03:01:58Z
type: item_state
---

## Summary

`pp` should evolve into three separate user-facing artifacts backed by one
shared implementation library and one shared config/auth state:

- `PP Desktop`: Electron app for non-technical and technical users who want a
  polished Windows application.
- `pp.exe`: CLI for terminal, scripting, automation, and advanced workflows.
- `pp-mcp.exe`: stdio MCP server for AI clients.

The desktop app should become the primary Windows product surface. The CLI and
MCP server should become companion tools that call the same core code directly
and point at the same config directory.

## Analysis

The current repo has already moved partway toward Windows distribution:

- config defaults to `%APPDATA%\\pp`
- there are separate `pp`, `pp-mcp`, and `pp-ui` package entrypoints
- the Windows installer installs separate executables into `Program Files`
- `pp-ui.exe` launches without a console window and opens an app-style Edge
  window on Windows

That shape worked for a CLI-owned browser UI, but the target audience now
includes non-technical users. For them, the product should open and behave like
a normal Windows application. A localhost browser tab or CLI-launched UI should
not be the primary experience.

Electron is the preferred long-term desktop host despite its size cost because
the repo is already TypeScript, Node, and React. Electron lets the desktop app
reuse existing auth, config, service, request, and React code without adding a
new .NET or Rust host boundary. WebView2 remains smaller, but it would likely
require a sidecar Node process or more host glue for the current codebase.

The durable architecture should be:

```text
shared core library
  config
  auth/token cache
  account/environment services
  request execution
  API clients
  validation/language helpers

PP Desktop -> shared core
pp.exe     -> shared core
pp-mcp.exe -> shared core
```

Avoid normal flows where Desktop invokes `pp.exe`, MCP invokes `pp.exe`, or the
CLI depends on Desktop. Sharing the config is correct; sharing process control
is not.

### Artifact Split

The product should ship separate artifacts:

- `PP Desktop.exe`: Electron app and default Start menu entry.
- `pp.exe`: optional CLI artifact.
- `pp-mcp.exe`: optional MCP artifact.

`pp-mcp.exe` should not require the CLI component to be installed. It should run
as a stdio server launched by MCP clients and read the same config/auth state as
Desktop and CLI.

### Config And Auth

The shared config layer needs to be robust enough for all three hosts:

- one default config directory
- shared MSAL/token cache conventions
- atomic config writes
- schema versioning and migrations
- clear errors when an older artifact sees a newer config schema
- conflict-safe account/environment saves where practical
- `--config-dir` for CLI/MCP, with an advanced Desktop launch flag or setting if
  needed

For non-technical users, Desktop should own sign-in and setup. MCP should remain
non-interactive by default and consume already-configured accounts.

### Language Logic

FetchXML and Power Automate language behavior should be part of the shared core,
not owned by Desktop or the renderer. Split the implementation into three
layers:

1. Pure language engines.
   - FetchXML parsing, cursor context, completions from supplied metadata, and
     diagnostics.
   - Power Automate workflow JSON parsing, outline generation, expression
     detection, completions, diagnostics, and symbol/reference analysis.
   - These modules should be host-agnostic and callable by Desktop, CLI, MCP,
     and tests.

2. Metadata-backed language services.
   - FetchXML services that load and cache Dataverse entity/entity-detail
     metadata, then invoke the pure analyzer.
   - Future Power Automate services that enrich analysis with connector/action
     metadata or environment-specific validation.
   - These services should use shared config/auth/API clients and normally run
     in Electron main, CLI, MCP, or tests.

3. Renderer editor adapters.
   - CodeMirror/Monaco integration.
   - Completion UI mapping, diagnostics display, debounce, cancellation, and
     editor commands.
   - These should not own token access, config, Dataverse metadata loading, or
     Power Platform API calls.

With IPC-first Desktop, language operations that require config, auth, API
metadata, or shared caches should go through typed preload APIs such as
`language.fetchXml.analyze`, `language.flow.analyze`, and
`language.flow.explain`. Pure analyzers may still be bundled into the renderer
when no backend state is needed and latency makes direct execution useful.

### Installer Expectations

The Windows installer should be organized around components:

```text
[x] PP Desktop
[x] MCP server
    [ ] Configure Claude Desktop / Claude Code / Codex / Copilot if detected
[ ] Command-line tools
    [ ] Add pp to PATH
```

The installer should install under a stable product directory, likely:

```text
C:\\Program Files\\PP\\
  PP Desktop.exe
  pp.exe
  pp-mcp.exe
  resources...
```

It should launch `PP Desktop` after install. It should not launch `pp-ui`.

When configuring MCP clients, prefer absolute paths if PATH is not selected:

```json
{
  "mcpServers": {
    "pp": {
      "command": "C:\\\\Program Files\\\\PP\\\\pp-mcp.exe"
    }
  }
}
```

Use `--tool-name-style underscore` for clients that need underscore tool names.

### CLI/UI Transition

`pp ui` should be removed as part of the Desktop split rather than retained as a
compatibility path:

- remove the `pp ui` command from the CLI
- remove the public `pp-ui` binary/artifact
- remove `pp-ui` from the installer and package `bin` map
- migrate tests/development workflows away from the localhost UI server
- make `PP Desktop` the only supported graphical UI path

This also means the Electron app should not start by wrapping the existing
localhost UI server. If useful implementation can be reused from `ui-routes`,
extract it into shared services or typed Desktop IPC handlers instead of keeping
HTTP as the Desktop boundary.

## Plan

1. Clarify the shared core boundary.
   - Move or name shared modules so Desktop, CLI, and MCP can depend on them
     without depending on each other.
   - Keep config, auth, token cache, account/environment services, request
     execution, API clients, and validation helpers in the shared layer.
   - Keep pure FetchXML and Power Automate language engines in the shared layer.
   - Keep metadata-backed language services in the shared layer, using shared
     config/auth/API clients where enrichment is needed.
   - Keep CodeMirror/Monaco adapters in the renderer only.

2. Add an Electron Desktop host.
   - Target typed Electron IPC from the first implementation.
   - Use a preload bridge that exposes a narrow renderer API backed by shared
     core services in the Electron main process.
   - Avoid using localhost HTTP as the Desktop boundary.
   - Expose metadata-backed language analysis through IPC instead of renderer
     network calls.
   - Add proper app identity, icon, single-instance behavior, window
     open/reopen handling, clean quit, and diagnostics export.

3. Rework Windows packaging around components.
   - Install `PP Desktop.exe`, `pp.exe`, and `pp-mcp.exe` as separate artifacts.
   - Stop installing or building `pp-ui`.
   - Make Desktop the default selected component and post-install launch target.
   - Make CLI/PATH optional.
   - Make MCP optional but independent from CLI.

4. Add MCP client configuration support.
   - Detect supported clients where practical.
   - Write configs using absolute `pp-mcp.exe` paths when PATH is not selected.
   - Preserve `--tool-name-style underscore` for Copilot-style clients.
   - Keep MCP non-interactive by default.

5. Transition away from public `pp ui`.
   - Remove `pp ui` from CLI commands, help, docs, package metadata, and tests.
   - Remove the public `pp-ui` artifact from SEA/package/installer outputs.
   - Delete or refactor the localhost UI server code once the Desktop IPC
     handlers cover the needed workflows.
   - Drop LAN UI mode unless a separate product requirement reintroduces it.

6. Update docs and product positioning.
   - Present `PP Desktop` as the recommended experience.
   - Present CLI as the advanced terminal/automation path.
   - Present MCP as AI assistant integration.
   - Explain that all three share config, so setup in one host is available to
     the others.

## Notes

Previous packaging work established separate `pp`, `pp-mcp`, and `pp-ui`
executables. The updated direction keeps the artifact split but removes `pp-ui`
and replaces it with `PP Desktop`.

The biggest product bet is accepting Electron's size cost in exchange for a
better long-term fit with the repo's TypeScript/Node/React stack and with the
desired Windows app polish.

The biggest engineering risk is config/auth concurrency across hosts. Atomic
writes, migrations, and clear schema/version errors should be handled before the
three-host story is treated as stable.

## Hand off

If a later session picks this up, start by auditing:

- which modules are already host-agnostic and which still assume CLI/UI
  ownership
- how current `pp ui` routes map to shared core services and first-class
  Electron IPC handlers
- which parts of `fetchxml-language`, `fetchxml-language-service`,
  `flow-language`, and `flow-language-service` are pure engines versus
  metadata-backed services or editor adapters
- the installer component model and whether Inno can configure detected MCP
  clients safely
- config write paths, migrations, and token cache sharing behavior when Desktop,
  CLI, and MCP run near each other
