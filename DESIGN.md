# Design Context

## Surface

PP Desktop is a restrained product interface for repeated operational work. It should feel like a reliable developer tool: compact, readable, keyboard-friendly, and explicit about state.

## Color

- Strategy: restrained product palette.
- Use one primary accent for selection, focus, and primary actions.
- Use semantic colors only for state: success, warning, error, pending, disabled.
- Keep inactive navigation and chrome neutral. Avoid saturated inactive states.
- Light and dark themes should share the same information hierarchy.

## Typography

- Use a single system-oriented sans family for UI, labels, headings, and data.
- Use the configured monospace stack for paths, GUIDs, JSON, commands, resource names, and API snippets.
- Keep headings compact. Reserve large display type for documents, not app chrome.
- Body and help copy should stay under 75 characters per line where possible.

## Layout

- Standard screen order: context, primary actions, status, content.
- Favor persistent split views and drawers over transient modals for inspection.
- Keep table controls near the table they affect.
- Empty states should provide an action or a direct path to setup.
- Loading states should name the resource being loaded.

## Components

- Buttons: consistent shape, clear hierarchy, visible disabled states.
- Selects and inputs: consistent focus ring and sizing.
- Tables: sticky headers, sortable columns, optional quick filtering, copy affordances for identifiers.
- Diagnostics: persistent list, severity, code, message, detail, affected environment/account/API, retry or handoff action.
- Command palette: global entry point for environment switching, navigation, recent actions, health checks, and Console handoffs.

## Motion

- Motion is short, functional, and only for state changes: opening overlays, toasts, loading bars, and row reveals.
- Avoid page-load choreography.

## Accessibility

- Keyboard navigation must work for global navigation, command palette, setup forms, tables, and dialogs.
- Focus should return to the triggering control when overlays close.
- Icon-only controls need labels or titles.
- Text must not rely on color alone for status.
