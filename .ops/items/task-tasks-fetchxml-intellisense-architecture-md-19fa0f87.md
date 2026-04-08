---
id: 'local:task:tasks/FetchXML IntelliSense architecture.md'
provider: 'local'
kind: 'task'
key: 'tasks/FetchXML IntelliSense architecture.md'
external_ref: 'tasks/FetchXML IntelliSense architecture.md'
target_path: 'tasks/FetchXML IntelliSense architecture.md'
remote_title: 'FetchXML IntelliSense architecture'
remote_state: 'open'
remote_url: 'tasks/FetchXML IntelliSense architecture.md'
remote_updated_at: '2026-04-07T23:20:00+10:00'
last_seen_remote_updated_at: '2026-04-07T23:20:00+10:00'
local_status: 'done'
priority: 'high'
difficulty: 'medium'
risk: 'medium'
owner: 'codex'
tags:
  - 'fetchxml'
  - 'ui'
  - 'architecture'
sync_state: 'clean'
last_analyzed_at: '2026-04-07T23:20:00+10:00'
type: 'item_state'
---

## Summary
Design and implement a well-architected FetchXML IntelliSense subsystem for the raw XML override editor in pp ui.

## Analysis
Implemented as a server-side language subsystem rather than browser-only hints. The core now does tolerant XML structure parsing, cursor-context detection, semantic validation, and metadata-backed completion generation. Dataverse metadata is resolved through a dedicated catalog with environment-scoped caching so the editor can ask for completions and diagnostics without owning metadata rules.

## Plan
1. Add a FetchXML language core with cursor context parsing and semantic rule evaluation. Done.
2. Add a metadata service that resolves entities, attributes, relationships, and operator compatibility from Dataverse metadata. Done.
3. Integrate a real editor surface through CodeMirror with a thin adapter that consumes completions and diagnostics from the language layer. Done.
4. Keep the editor host separate from the language subsystem so the same logic can later support UI, CLI validation, or editor integrations. Done.

## Notes
Added `src/fetchxml-language.ts` for parsing, context resolution, completions, and diagnostics.
Added `src/fetchxml-language-service.ts` for environment-aware metadata loading and caching.
Added `/api/dv/fetchxml/intellisense` plus a vendor-module asset route in `src/ui-server.ts`.
Replaced the raw FetchXML textarea with a CodeMirror editor host in the UI, while keeping the hidden form field as the source of truth for preview and execute requests.
Verified with `pnpm typecheck`, `pnpm build`, browser-module syntax checks via emitted UI assets, and an HTTP smoke test covering the vendor route and IntelliSense endpoint.
