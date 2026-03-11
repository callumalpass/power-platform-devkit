# Auth and environments

`pp` separates authentication from environment aliases.

- auth profile: how to acquire a token
- environment alias: which Dataverse URL to use, and which auth profile should be applied there

That split makes it practical to manage several users, several service principals, and several environments in one local config store.

## Global config location

By default:

```text
~/.config/pp/config.json
```

Override per command with:

```bash
pp auth profile list --config-dir ./.tmp/pp-config
```

## Profile types

### `user`

Browser-first login with silent cache reuse. This is the easiest interactive path.

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
```

Notes:

- uses Microsoft’s public client by default
- defaults to tenant `common` unless `--tenant-id` is supplied
- derives the delegated Dataverse scope as `<resource>/user_impersonation` unless explicit `--scope` values are stored on the profile
- stores a separate MSAL cache per profile name unless `--cache-key` is supplied
- can target a named browser profile for isolated interactive sessions
- reuses cached tokens silently before prompting again
- can fall back to device code if interactive login fails

Useful options:

```bash
pp auth login \
  --name dev-user \
  --resource https://example.crm.dynamics.com \
  --browser-profile tenant-a \
  --login-hint user@contoso.com \
  --force-prompt
```

You can also store a user profile without authenticating immediately:

```bash
pp auth profile add-user --name dev-user --resource https://example.crm.dynamics.com --browser-profile tenant-a
```

### `device-code`

Explicit device-code profile, useful for headless environments or where browser sign-in is awkward:

```bash
pp auth profile add-device-code --name build-user --resource https://example.crm.dynamics.com
pp auth login --name build-user --resource https://example.crm.dynamics.com --device-code
```

Like `user` profiles, device-code profiles derive `<resource>/user_impersonation` unless you store explicit scopes.

### `environment-token`

Read a bearer token from an environment variable:

```bash
pp auth profile add-env --name env-token --env-var PP_TOKEN --resource https://example.crm.dynamics.com
PP_TOKEN=... pp auth token --profile env-token
```

### `client-secret`

Service principal auth with client secret loaded from an environment variable:

```bash
pp auth profile add-client-secret \
  --name build-sp \
  --tenant-id <tenant-id> \
  --client-id <client-id> \
  --secret-env PP_CLIENT_SECRET \
  --resource https://example.crm.dynamics.com
```

Client-secret profiles derive the application scope as `<resource>/.default` unless explicit `--scope` values are stored.

### `static-token`

Mostly useful for quick experiments:

```bash
pp auth profile add-static --name temp --token <bearer-token>
```

## Managing several profiles

List, inspect, and remove profiles:

```bash
pp auth profile list
pp auth profile inspect dev-user
pp auth profile inspect --env dev
pp auth profile remove temp
```

The profile summary includes the effective client ID, tenant, cache key, and stored account identifiers for user-style profiles. That matters when several named identities live on the same machine.

When the workflow already has an environment alias, `pp auth profile inspect --env <alias>` resolves the bound auth profile first so you do not need to translate the alias back to its profile name manually.

When you inspect through an environment alias, the output also includes:

- `resolvedEnvironmentUrl`, the Dataverse URL bound to that alias
- `targetResource`, the resource `pp` will target for environment-scoped commands
- `profileDefaultResource`, the profile's stored home resource when it differs from the environment target you are inspecting through
- `defaultResourceMatchesResolvedEnvironment`, which is `false` when the stored profile home resource differs from the resolved environment URL

That makes stale profile defaults explicit without forcing a separate `env inspect`
just to confirm which org the alias actually points at, while keeping the
environment target as the primary resource in view.

## Browser profiles

Browser profiles let interactive auth launch a dedicated persistent browser
context instead of the generic system browser flow.

Create one:

```bash
pp auth browser-profile add --name tenant-a --kind edge
pp auth browser-profile inspect tenant-a
```

Supported kinds:

- `edge`
- `chrome`
- `chromium`
- `custom`

Useful options:

```bash
pp auth browser-profile add \
  --name customer-b \
  --kind custom \
  --command /usr/bin/google-chrome \
  --arg '--disable-sync' \
  --directory ./browser-profiles/customer-b
```

Behavior:

- managed browser data is stored separately from the MSAL token cache
- if `--config-dir` points at a repo-local directory, browser profiles become
  repo-scoped
- otherwise they live under the user config root, typically
  `~/.config/pp/browser-profiles/<name>`
- browser-backed auth still falls back safely to normal behavior when no
  browser profile is configured

For browser-driven Power Apps work, interactive token login is not always enough
to seed a reusable maker-session cookie jar. If Studio automation still lands on
Microsoft sign-in, bootstrap the browser profile once:

```bash
pp auth browser-profile bootstrap tenant-a
```

Useful options:

```bash
pp auth browser-profile bootstrap tenant-a --url https://make.powerapps.com/
pp auth browser-profile bootstrap tenant-a --url 'https://make.powerapps.com/e/<env>/canvas/?action=edit&app-id=/providers/Microsoft.PowerApps/apps/<app-id>'
```

Behavior:

- opens the managed browser profile at the target URL
- you complete the one-time Microsoft / Power Apps web sign-in manually
- when you confirm completion, `pp` records `lastBootstrapUrl` and
  `lastBootstrappedAt` on the browser profile
- `--no-wait` opens the profile and exits immediately without recording the
  bootstrap completion

## Getting tokens directly

If you want to inspect the raw token:

```bash
pp auth token --profile dev-user --resource https://example.crm.dynamics.com
```

If the profile already has a default resource or explicit scopes, `--resource` can be omitted.

## Environment aliases

Create an alias:

```bash
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
```

Optional fields supported today:

- `--default-solution`
- `--display-name`
- `--maker-env-id`
- `--tenant-id`
- `--api-path`

`--maker-env-id` does not affect Dataverse resolution. It is optional metadata
that lets `pp` print exact Maker deep links for workflows such as the current
canvas create/import fallback guidance. For one-off runs, `pp canvas create`
and `pp canvas import` also accept `--maker-env-id` directly so you do not have
to persist that metadata on the alias first. When the alias does not already
store `makerEnvironmentId`, those canvas fallback commands now also try to
discover it live from the authenticated Power Platform environments API before
they fall back to generic Maker guidance. On real create/import runs, `pp` also
caches the discovered id back onto the saved alias so later Maker handoffs do
not need to rediscover or re-enter it.

Inspect and remove aliases:

```bash
pp env inspect dev
pp env resolve-maker-id dev
pp env cleanup-plan dev --prefix ppHarness20260310T013401820Z --format json
pp env cleanup dev --prefix ppHarness20260310T013401820Z --dry-run --format json
pp env list
pp env remove dev
```

`pp env resolve-maker-id <alias>` uses the alias's bound auth profile to query
the Power Platform environments API, persists the discovered
`makerEnvironmentId` back onto that alias, and returns the updated alias
record. Use this when a harness or Maker handoff needs exact `make.powerapps`
deep links but the alias was originally registered without `--maker-env-id`.

`pp env inspect <alias>` now also expands the bound auth profile summary and a
tooling advisory block. The `tooling.pac` section is there to make a common
failure mode explicit: `pac` does not read `pp` auth profiles, browser-profile
bootstrap state, or cached `pp` sessions. A successful
`pp dv whoami --env <alias>` only proves the alias works inside `pp`.

Example:

```bash
pp env inspect test --format json
```

Look for:

- `auth.status` to confirm the bound profile is configured locally
- `auth.type` and `auth.browserProfile` to see whether the alias is
  browser-backed
- `tooling.pac.sharesPpAuthContext`, which is currently `false`
- `tooling.pac.risk` and `tooling.pac.reason` before assuming a `pac` fallback
  will stay non-interactive

For harness and fallback workflows, use that output as the contract. Prefer
staying inside `pp` when possible; if `pac` is unavoidable, treat it as a
separately authenticated tool and verify it explicitly before relying on it in
the middle of a scenario step.

For canvas workflows in particular, do not assume `pac canvas list` or
`pac canvas download` can reuse a working `pp` browser-backed alias. If
`tooling.pac.sharesPpAuthContext` is `false`, finish the `pp` path first
(`pp canvas download`, delegated Maker create, or a recorded fixture fallback)
before you decide whether `pac` is still necessary.

When `pac` is genuinely required, bootstrap it as its own setup step instead of
discovering that requirement mid-run:

```bash
pac auth create --name test-pac --deviceCode --environment https://example.crm.dynamics.com
pac auth select --name test-pac
pac auth who
```

Use the Dataverse org URL from the target environment alias, not the fact that
`pp dv whoami --env <alias>` succeeded, as the input contract for that
bootstrap.

For disposable bootstrap flows, `pp env cleanup-plan <alias> --prefix <runPrefix>`
lists solutions whose unique name or friendly name starts with that prefix.
`pp env reset <alias> --prefix <runPrefix>` then deletes those matches through
the typed `pp` solution path, with `--dry-run` or `--plan` available when you
want a non-mutating preview first. `pp env cleanup` remains available as the
lower-level equivalent deletion verb.

## Typical flows

### Interactive developer flow

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
pp dv whoami --env dev
```

### CI or automation flow

```bash
pp auth profile add-client-secret \
  --name ci-sp \
  --tenant-id <tenant-id> \
  --client-id <client-id> \
  --secret-env PP_CLIENT_SECRET \
  --resource https://example.crm.dynamics.com

pp env add --name build --url https://example.crm.dynamics.com --profile ci-sp
pp solution list --env build
```
