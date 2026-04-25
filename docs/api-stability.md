# API Stability

`pp` follows SemVer for the stable JavaScript/TypeScript API documented in `README.md`, `docs/library.md`, package `exports`, and generated TypeScript declarations.

## Stable Surface

The stable JS/TS surface is:

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

`pp/config` is intentionally stable. It is the supported way for JS/TS tools to share the same account aliases, environment aliases, config directory resolution, and auth-related configuration used by the CLI and desktop app.

For non-JS tools, the stable integration surface is the `pp` CLI's JSON output for account, environment, token, and request commands. Non-JS tools should prefer invoking `pp` commands and parsing JSON rather than editing config files directly.

The on-disk config file is read-compatible and may gain fields over time. Tools may read documented account and environment data for interoperability, but should mutate config through the JS/TS library or `pp` CLI commands.

## Experimental Surface

`pp/experimental/*` entry points are not covered by the same compatibility guarantee. They may change in minor or patch releases when upstream Power Platform, Studio, or MCP-backed behavior changes.

## Not API

CLI help wording, diagnostic `detail` text, generated `dist/chunk-*` files, internal source modules that are not exported from `package.json`, and desktop renderer implementation details are not stable API.
