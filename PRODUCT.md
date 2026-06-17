# Product Context

## Register

product

## Product Purpose

`pp` is a task-focused desktop, CLI, setup, and MCP toolkit for working with Microsoft Power Platform APIs. PP Desktop is the graphical workspace for configuring accounts and environments, inspecting Dataverse metadata and records, debugging Power Automate flows, launching canvas authoring sessions, and sending authenticated API requests.

## Users

- Power Platform developers who move between Dataverse, Power Automate, Power Apps, SharePoint, Graph, and BAP APIs.
- Consultants and administrators who manage multiple tenants, accounts, and environments.
- Agent-assisted developers who need a dependable local MCP and CLI companion.
- Advanced users who need raw API visibility without losing setup and auth guardrails.

## UX Principles

- Keep environment and account context visible. A user should always know which environment, account, access mode, and auth state their next action will use.
- Prefer inline recovery over transient error reporting. Auth, permission, API, and setup failures should show the affected resource, concise diagnosis, retry action, and relevant CLI or Console path.
- Make the command line and desktop reinforce each other. Where a desktop action maps to a CLI or API request, expose a copyable command or a Console handoff.
- Preserve work by environment. Switching environments should feel reversible, with recent tab, filters, selected entities, and panel widths remembered where safe.
- Treat dense data as legitimate. Tables, JSON, metadata, and flow definitions should support scanning, filtering, sorting, copying, and drill-in without unnecessary decoration.
- Use familiar product patterns. Tabs, sidebars, command palette, drawers, split views, tables, and forms are preferred over novel controls.

## Tone

Direct, precise, and operational. Copy should name the thing that happened and the next useful action. Avoid marketing language, tutorial filler, and vague success messages.

## Anti-References

- Marketing dashboards with oversized metric cards.
- Decorative motion, glass effects, gradient text, or ornamental color.
- Modal-first workflows for routine detail inspection.
- Errors that only say a request failed without naming the API, environment, account, or recovery step.
