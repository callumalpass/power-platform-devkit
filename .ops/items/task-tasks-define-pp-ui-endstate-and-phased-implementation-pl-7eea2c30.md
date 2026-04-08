---
id: local:task:tasks/Define pp ui endstate and phased implementation plan.md
provider: local
kind: task
key: tasks/Define pp ui endstate and phased implementation plan.md
external_ref: tasks/Define pp ui endstate and phased implementation plan.md
target_path: tasks/Define pp ui endstate and phased implementation plan.md
remote_title: Define pp ui endstate and phased implementation plan
remote_state: open
remote_url: tasks/Define pp ui endstate and phased implementation plan.md
remote_updated_at: 2026-04-07T14:10:33Z
last_seen_remote_updated_at: 2026-04-07T14:10:33Z
local_status: triaged
priority: high
difficulty: medium
risk: medium
owner: codex
tags:
  - pp-ui
  - architecture
  - planning
sync_state: clean
last_analyzed_at: 2026-04-07T14:10:33Z
type: item_state
---

## Summary

`pp ui` should converge on a Power Platform workbench rather than continuing as
a Dataverse-only explorer with a few generic setup affordances around it. The
endstate should preserve the deep Dataverse tooling that already exists while
adding a first-class generic console for every supported API and selectively
introducing specialized workspaces only where they materially improve on the
generic experience.

## Analysis

The current implementation has a healthy split between transport and product
surface:

- The request/auth layer already supports `dv`, `flow`, `graph`, `bap`, and
  `powerapps`.
- The UI layer is tightly centered on Dataverse entities, Dataverse metadata,
  Dataverse query composition, and FetchXML.
- Setup and health-check functionality are generic enough to survive a broader
  UI without major conceptual change.

That means the main problem is not API reach; it is UI architecture. Today the
app implicitly assumes this sequence:

1. Pick environment.
2. Load Dataverse entities.
3. Use Dataverse entity state to drive the rest of the experience.

That model does not generalize cleanly:

- Flow and Power Apps are environment-scoped, but the useful UX is inventory and
  operations, not entity metadata.
- BAP is partly environment-scoped and partly platform-admin/inventory-oriented.
- Graph is account-scoped first, not environment-scoped first.

The durable center of the product should instead be:

1. Pick scope.
2. Pick API/workspace.
3. Use either a generic console or a specialized surface appropriate to that
   API.

The key shift is from an app-global Dataverse entity model to a capability model
that can represent:

- scope: `environment` or `account`
- API identity: `dv`, `flow`, `graph`, `bap`, `powerapps`
- surface type: `console`, `inventory`, `metadata`, `query-builder`,
  `operation-view`
- API-specific presets and affordances

### Proposed Product Endstate

The intended user-facing information architecture is:

1. `Setup`
   Central place for accounts, environments, auth posture, and MCP launch
   details. This largely keeps the current responsibilities.

2. `API Console`
   A generic request workbench that supports every API. This is the universal
   escape hatch and the default path for any API surface that does not yet have
   deep productized support.

3. `Dataverse`
   A specialized workspace for entity exploration, metadata inspection, OData
   query building, record previews, and FetchXML. Dataverse remains the richest
   custom workspace because its domain structure justifies it.

4. `Automate`
   A Flow workspace focused on listing flows, inspecting flow details, runs,
   ownership, and related maker-environment resources.

5. `Apps`
   A Power Apps workspace focused on app inventory, metadata, ownership,
   connections, and publish/admin-oriented inspection tasks.

6. `Platform`
   A BAP-oriented workspace for environment inventory, policies, connectors, and
   other platform-level management/discovery operations.

Graph should initially live inside `API Console` rather than receiving a
top-level bespoke workspace. It is structurally different from the Power
Platform APIs and will otherwise distort the rest of the app’s scope model. If
later usage reveals a narrow, repeated Graph workflow that merits promotion, it
can be elevated selectively.

### Scope Model

The UI should distinguish between at least two scope types:

- `environment` scope
  Used by Dataverse, Flow, Power Apps, and most BAP interactions.

- `account` scope
  Used by Graph-first workflows and by any future cross-environment or tenant
  operations that are not naturally rooted in a Dataverse URL.

The current header-global environment selector should evolve into a more general
scope control:

- when a workspace is environment-scoped, show environment selection
- when a workspace is account-scoped, show account selection
- when a workspace can use either, expose both intentionally rather than
  deriving one from the other implicitly

### Capability Registry

The implementation should stop scattering API-specific behavior across client
modules and instead define a small registry of API/workspace capabilities. Each
entry should describe:

- internal API key
- display label
- scope kind
- default base-path behavior
- default query parameter behavior
- supported surface types
- canned/preset requests
- health check strategy
- optional explorer loaders

That registry becomes the single place that answers questions like:

- which selector to render in the header
- what defaults to use in the console
- whether a workspace can show an inventory browser
- whether the app can offer “quick actions” for a given API

### Generic Console Requirements

The `API Console` should be good enough that every API is already useful even
before bespoke workspace work begins. It should include:

- API selector
- scope selector
- method selector
- path input
- query parameter editor
- header editor
- request body editor
- per-API default query handling
- response viewer with status and headers
- request history
- saved or pinned requests
- starter presets for common operations

High-value initial presets:

- Dataverse `WhoAmI`, list table rows, metadata lookup
- Flow list flows in environment
- Power Apps list apps in environment
- BAP list environments
- Graph `/me`, `/organization`, and maybe `/users?$top=10`

### Workspace Guidance By API

Dataverse:
- keep and refine the existing Explorer, Query, and FetchXML surfaces
- eventually consider moving Query and FetchXML under a Dataverse workspace
  instead of presenting them as app-global tabs

Flow:
- favor inventory and operational views over schema-heavy builders
- likely panes: flows list, selected flow detail, recent runs, ownership, and
  quick links to inspect related resources

Power Apps:
- similar to Flow in shape: inventory and app detail views
- emphasize app metadata, owner/publisher context, connections, and admin tasks

BAP:
- focus on inventory and platform/admin operations rather than pretending it is
  record-centric
- likely views: environment inventory, policy-related inspection, connectors,
  and tenant/platform metadata

Graph:
- keep it console-first
- avoid forcing it into the environment-driven navigation model

### State Architecture Endstate

The client should move away from a single mutable global state centered on
Dataverse entities. A more durable model is:

- global registry state
  accounts, environments, auth posture, MCP metadata

- session UI state
  active workspace, active API, active scope, persisted preferences

- workspace state
  Dataverse explorer state, console request state, Flow inventory state, etc.

- cached resource state
  entity metadata, flow lists, app lists, recent responses, request history

This can still stay simple and framework-free if desired, but the boundaries
should be explicit. The current pattern of having generic shared state fields
that are actually Dataverse-only should be phased out.

## Plan

1. Phase 1: Establish the generic multi-API foundation.
   - Add an `API Console` tab or workspace that can execute requests against
     every supported API using the existing request layer.
   - Introduce an API capability registry to centralize labels, scope rules,
     defaults, and presets.
   - Add generic response/history components.
   - Extend Setup health checks to show status across all supported APIs in a
     more explicit, consolidated way.

2. Phase 2: Reframe navigation around workspaces rather than Dataverse-first
   globals.
   - Replace the app-global assumption that an environment change should always
     load Dataverse entities.
   - Move from a single environment selector to a workspace-aware scope control.
   - Keep Dataverse entity preloading only inside the Dataverse workspace.

3. Phase 3: Normalize Dataverse into the new architecture without reducing
   capability.
   - Fold Explorer, Query, and FetchXML into a single Dataverse workspace.
   - Reuse shared console/history components where appropriate.
   - Keep Dataverse-specific query builders and metadata tooling specialized.

4. Phase 4: Add lightweight specialized workspaces for Flow and Power Apps.
   - Start with inventory/detail surfaces rather than attempting full generic
     builders.
   - Add high-value quick actions and common inspection flows.

5. Phase 5: Add a BAP platform workspace if usage justifies it.
   - Focus on platform inventory and admin-oriented operations.
   - Avoid overfitting the UI to hypothetical workflows before concrete demand.

6. Phase 6: Evaluate whether any Graph workflow deserves promotion out of the
   console.
   - Default answer should remain “no” unless repeated usage demonstrates a
     narrow, valuable specialized surface.

### Suggested Module Refactor Sequence

1. Introduce `src/ui-capabilities.ts` or similar.
   - Define API metadata and workspace descriptors.

2. Introduce a generic request service wrapper for the UI.
   - Add server routes like `/api/request/execute` and optionally
     `/api/request/presets`.
   - Keep current Dataverse routes during migration.

3. Split client state by workspace.
   - Create state containers for console vs. Dataverse vs. setup.

4. Convert top-level tab rendering to be registry-driven.
   - This reduces the amount of hand-wired Dataverse-only control flow.

5. Migrate Dataverse workspace to consume shared primitives.
   - Response viewer, request history, selectors, and diagnostics handling
     should not be bespoke where reuse is straightforward.

6. Add Flow and Power Apps inventory loaders.
   - Only after the generic and Dataverse restructuring is stable.

## Notes

This plan deliberately avoids the trap of forcing every API into the same
surface. “Parity” should mean equal access and coherent navigation, not equal
visual treatment.

The immediate implementation priority should be the generic console and scope
model, because those produce broad coverage quickly and create the architectural
base needed for every later workspace.

A useful acceptance test for the endstate is:

- A new user can authenticate, choose a scope, run useful requests against any
  supported API, and understand where to go next.
- A Dataverse-heavy user still gets a rich schema-aware workspace.
- A Flow or Power Apps user does not feel like they are operating inside a
  Dataverse tool by accident.

## Handoff

If implementation starts later, begin with the smallest vertical slice:

1. Add the capability registry.
2. Add a generic console route and UI.
3. Stop auto-loading Dataverse entities on every environment change.

That sequence preserves existing value while moving the architecture toward the
target endstate instead of deepening Dataverse-specific coupling.
