# Architecture Guardrails

The ESLint `no-restricted-imports` rules in `eslint.config.js` protect the highest-risk layering boundaries without changing runtime behavior.

Current enforced boundaries:

- `src/ui-react/**` must not import Node-only services, auth internals, request execution, desktop internals, or MCP server modules directly. UI code should use UI data helpers, desktop API clients, or typed shared DTOs.
- `src/services/**` and `src/experimental/**` must stay renderer-independent. They must not import React, React DOM, renderer modules, or desktop main-process modules.

Documented exceptions:

- Shared pure types and DTOs such as `src/config.ts` may be imported by UI modules when they do not pull in Node-only runtime behavior.
- Stable package entry points may continue to re-export intentional service APIs from `src/index.ts`, `src/accounts.ts`, `src/api.ts`, `src/dataverse.ts`, and `src/environments.ts`.
