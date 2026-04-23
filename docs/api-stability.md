# API Stability

`pp` follows SemVer for the stable library API documented in `README.md`, `docs/library.md`, package `exports`, and generated TypeScript declarations.

## Stable Surface

The stable surface is:

- the root `pp` export
- `pp/accounts`
- `pp/api`
- `pp/auth`
- `pp/client`
- `pp/config`
- `pp/dataverse`
- `pp/diagnostics`
- `pp/environments`
- `pp/fetchxml-language`
- `pp/flow-language`
- `pp/request`
- `pp/mcp`

Breaking changes to these entry points require a major version bump. Compatible additions use a minor version. Bug fixes and documentation-only changes use a patch version.

## Experimental Surface

`pp/experimental/*` entry points are not covered by the same compatibility guarantee. They may change in minor or patch releases when upstream Power Platform, Studio, or MCP-backed behavior changes.

## Not API

CLI help wording, diagnostic `detail` text, generated `dist/chunk-*` files, internal source modules that are not exported from `package.json`, and desktop renderer implementation details are not stable API.
