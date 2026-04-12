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
remote_updated_at: 2026-04-09T11:06:31Z
last_seen_remote_updated_at: 2026-04-09T11:06:31Z
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
  - onboarding
sync_state: clean
last_analyzed_at: 2026-04-09T11:06:31Z
type: item_state
---

## Summary

`pp` is currently much closer to a developer-oriented Node CLI than a
Windows-native product. The main work is not core capability; it is packaging,
install, launch, and startup UX. The goal of this item is to make `pp`
installable and usable by non-technical Windows users with minimal terminal
knowledge.

## Analysis

The current repo already has some runtime Windows awareness:

- config defaults to `%APPDATA%\\pp`
- browser opening supports `cmd /c start`
- the UI is browser-based rather than Electron-native

That means the product does not need a Windows-specific rewrite. The friction is
primarily in distribution and process model:

- install instructions are source-build oriented rather than end-user oriented
- the package is not yet positioned as a clean distributable artifact
- `pp ui` still behaves like a terminal-launched localhost server
- there is no installer, Start menu integration, PATH management, or uninstall
  story

For non-technical users, the target experience should look more like:

1. Download installer.
2. Click through a normal Windows setup flow.
3. Launch `PP UI` from the Start menu without seeing a terminal.
4. Optionally use `pp` from PowerShell if needed.
5. Receive future updates through a simple release channel.

### Distribution Model

The recommended packaging stack is:

1. Build self-contained Windows executables for:
   - `pp.exe`
   - `pp-mcp.exe`
   - `pp-ui.exe` as a dedicated UI launcher

2. Wrap those executables in a standard Windows installer, likely Inno Setup.

This separates concerns cleanly:

- the executable build solves "runs without Node installed"
- the installer solves "installs to a sensible location, adds PATH, creates
  shortcuts, and registers uninstall support"

### Executable Strategy

The preferred long-term executable path is Node SEA-based packaging with fully
bundled entrypoints. The important constraint is that the current UI server
still resolves browser vendor modules from the package filesystem at runtime, so
the UI path is not yet truly self-contained. To produce reliable `.exe`
artifacts, the app should:

- bundle each CLI entrypoint into a single deployable script
- remove runtime dependence on loose `node_modules` resolution for UI vendor
  assets
- either prebundle browser dependencies into shipped UI assets or embed them as
  executable assets

### Installer Expectations

The Windows installer should:

- install under `C:\\Program Files\\pp\\`
- optionally add that directory to `PATH`
- create a Start menu shortcut for `PP UI`
- optionally create a desktop shortcut
- register uninstall metadata
- preserve user config/data stored in `%APPDATA%\\pp`

### UI Launch Expectations

`pp ui` should be improved so the UI path does not feel like "a browser tab
opened by a CLI". The desired behavior is:

- start without requiring a terminal window to remain open
- detect an existing running instance and reuse it
- only open the browser once the server is ready
- recover gracefully if the preferred port is already in use
- offer a dedicated launcher path for Start menu usage

The likely product split is:

- `pp.exe` for CLI and scripting
- `pp-mcp.exe` for MCP/assistant integration
- `pp-ui.exe` or equivalent launcher behavior for non-terminal UI startup

This avoids overloading one console-first entrypoint with conflicting UX goals.

### Documentation Expectations

The docs should be rewritten around end-user install paths rather than source
build instructions. The Windows path should explicitly document:

- installer-based setup
- config location
- how to open `PP UI`
- when PowerShell usage is optional vs required
- fallback auth guidance such as device-code flow for locked-down environments

## Plan

1. Make the package releaseable.
   - Remove publish blockers in package metadata.
   - Restrict shipped files to release artifacts and docs.
   - Add explicit runtime/version requirements.
   - Add release-oriented README install docs for CLI and UI users.

2. Make the UI path self-contained enough for executable packaging.
   - Replace runtime filesystem resolution of UI vendor modules with bundled or
     embedded assets.
   - Ensure `pp`, `pp-mcp`, and any UI launcher entrypoint can run without a
     repo checkout or loose dependency tree.
   - Add smoke tests for packaged startup on Windows.

3. Produce Windows executables.
   - Add a repeatable build for `pp.exe` and `pp-mcp.exe` and `pp-ui.exe`
   - Validate that auth, config, browser launch, and MCP startup all work in
     packaged builds.

4. Add an installer.
   - Create an Inno Setup script that installs to `Program Files`.
   - Add optional PATH modification for CLI usage.
   - Add Start menu shortcut(s), uninstall support, and versioned upgrades.
   - Keep `%APPDATA%\\pp` outside the install directory so updates do not remove
     user state.

5. Improve `pp ui` startup semantics.
   - Add single-instance detection and browser reuse.
   - Add readiness gating before opening a browser tab.
   - Add automatic fallback when the preferred port is occupied.
   - Add a non-console launcher path suitable for Start menu invocation.

6. Add a release pipeline.
   - Build and verify Windows artifacts in CI.
   - Publish versioned executables and installer assets.
   - Optionally add `winget` or Scoop later for CLI-first users.

## Notes

Recommended sequencing is package cleanup -> self-contained UI assets ->
Windows executable build -> installer -> release automation. Doing the installer
first would harden the wrong artifact shape.

The highest implementation risk is not Windows itself; it is ensuring the UI
path no longer assumes a package-style filesystem layout at runtime. That should
be addressed before committing heavily to installer polish.

## Hand off

If a later session picks this up, start by auditing:

- package metadata and publishability
- UI asset loading and runtime module resolution
- feasible entrypoint split for `pp`, `pp-mcp`, and `pp-ui`
- whether the first milestone should target a raw `.exe` release or go straight
  to an installer
