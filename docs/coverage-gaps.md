# Coverage Visibility Notes

`pnpm run test:coverage` runs the Node test suite with Node's built-in coverage reporter. CI prints this summary without enforcing a percentage threshold.

Initial critical pure-logic focus areas from `code-quality-improvement-spec.md`:

- Request building and API normalization: covered by `test/request-executor.test.ts`; add branch coverage around API detection edge cases and OData query composition as the request surface grows.
- Config loading, writing, and migration: covered by `test/config.test.ts`; migration dry-run and apply paths should be reviewed before setting thresholds.
- Auth/account normalization: covered by `test/auth.test.ts`; interactive/device-code branches remain intentionally hard to exercise in unit tests.
- FetchXML and Flow language parsing: covered by language and editor tests; `test/fetchxml-builder.test.ts` covers the extracted FetchXML builder payload helpers. Keep fixtures representative as the editor surfaces expand.
- Desktop API input validation: covered by `test/ui-request-parsing.test.ts` and `test/desktop-api.test.ts`; add route-specific cases as schemas move into more handlers.
- Canvas authoring URL/session helpers: covered by `test/canvas-authoring.test.ts`; SignalR/RPC paths still need isolated protocol tests before coverage thresholds are useful.
