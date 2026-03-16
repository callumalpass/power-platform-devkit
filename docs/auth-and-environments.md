# Auth and environments

This guide covers the first thing most `pp` users need to get right:
authentication and environment targeting.

`pp` separates authentication from environment aliases. An **auth profile**
describes how to acquire a token (interactive login, service principal, device
code, etc.), while an **environment alias** pairs a Dataverse URL with the auth
profile that should be used to reach it. That split makes it practical to manage
several users, several service principals, and several environments in one local
config store.

If you only need the shortest working path, use:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
pp dv whoami --env dev
```

Use the rest of this guide when you need multiple profile types, browser
profiles, or isolated config directories.

## Global config location

By default:

```text
Windows: %APPDATA%\pp\config.json
macOS/Linux: ~/.config/pp/config.json
```

You can override the config location for any command with the `--config-dir`
flag. This is useful for keeping project-specific credentials separate from your
global config.

```bash
pp auth profile list --config-dir ./.tmp/pp-config
```

## Profile types

### `user`

Browser-first login with silent cache reuse. This is the easiest interactive
path.

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
```

For normal Dataverse sign-in, prefer `--resource`. `pp` will derive the usual
delegated Dataverse scope from that URL. Treat `--scope` as an advanced escape
hatch when you intentionally need exact OAuth scopes instead of the Dataverse
default.

A user profile authenticates through Microsoft's public client by default and
targets tenant `common` unless you supply `--tenant-id`. When a `--resource` is
set, `pp` derives the delegated scope as `<resource>/user_impersonation`;
explicit `--scope` values on the profile override that derivation. Each profile
gets its own MSAL token cache keyed by profile name, though you can share a
cache across profiles by passing `--cache-key`. Cached tokens are reused
silently before `pp` prompts for interactive login again, and if the interactive
flow fails, `pp` can fall back to device code. You can also assign a named
browser profile to keep interactive sessions isolated per tenant or identity.

The following example shows several of these options together. The
`--browser-profile` flag directs interactive login through a managed browser
context, `--login-hint` pre-fills the username field, and `--force-prompt`
skips any cached session and always shows the sign-in page.

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

Use a device-code profile for headless environments or situations where browser
sign-in is awkward. You create the profile, then log in with the `--device-code`
flag.

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

These commands let you list all profiles, inspect one in detail, or remove one
you no longer need.

```bash
pp auth profile list
pp auth profile inspect dev-user
pp auth profile inspect --env dev
pp auth profile remove temp
```

The profile summary includes the effective client ID, tenant, cache key, and
stored account identifiers for user-style profiles. That matters when several
named identities live on the same machine.

When the workflow already has an environment alias, `pp auth profile inspect --env <alias>` resolves the bound auth profile first so you do not need to translate the alias back to its profile name manually.

When you inspect through an environment alias, the output also includes
`resolvedEnvironmentUrl` (the Dataverse URL bound to that alias),
`targetResource` (the resource `pp` will target for environment-scoped
commands), `profileDefaultResource` (the profile's stored home resource when it
differs from the environment target), and
`defaultResourceMatchesResolvedEnvironment` (which is `false` when those two
diverge). That makes stale profile defaults explicit without forcing a separate
`env inspect` just to confirm which org the alias actually points at, while
keeping the environment target as the primary resource in view.

## Browser profiles

Browser profiles let interactive auth launch a dedicated persistent browser
context instead of the generic system browser flow. This is especially useful
when you work across multiple tenants and need each one's cookies and sessions
isolated from the others.

To create and inspect a browser profile:

```bash
pp auth browser-profile add --name tenant-a --kind edge
pp auth browser-profile inspect tenant-a
```

The `--kind` flag accepts `edge`, `chrome`, `chromium`, or `custom`.

When using `custom`, you can specify the browser executable and additional
arguments. The `--directory` flag controls where the browser's persistent data
is stored.

```bash
pp auth browser-profile add \
  --name customer-b \
  --kind custom \
  --command /usr/bin/google-chrome \
  --arg '--disable-sync' \
  --directory ./browser-profiles/customer-b
```

Managed browser data is stored separately from the MSAL token cache. If
`--config-dir` points at a repo-local directory, the browser profiles become
repo-scoped; otherwise they live under the user config root, typically
`%APPDATA%\pp\browser-profiles\<name>` on Windows or
`~/.config/pp/browser-profiles/<name>` on macOS/Linux. When no browser profile
is configured on an auth profile, browser-backed auth falls back safely to the
normal system browser flow.

### Bootstrapping a browser profile

For browser-driven Power Apps work, interactive token login is not always enough
to seed a reusable maker-session cookie jar. If Studio automation still lands on
Microsoft sign-in, bootstrap the browser profile once:

```bash
pp auth browser-profile bootstrap tenant-a
```

Bootstrapping opens the managed browser profile at a target URL, where you
complete the one-time Microsoft / Power Apps web sign-in manually. When you
confirm completion, `pp` records `lastBootstrapUrl` and `lastBootstrappedAt` on
the browser profile. If you just want to open the profile without recording the
bootstrap, pass `--no-wait`.

You can pass a specific `--url` to warm the browser session for a particular
surface. For example, to bootstrap for the Power Apps maker portal:

```bash
pp auth browser-profile bootstrap tenant-a --url https://make.powerapps.com/
```

Or to target a specific canvas app editor directly:

```bash
pp auth browser-profile bootstrap tenant-a --url 'https://make.powerapps.com/e/<env>/canvas/?action=edit&app-id=/providers/Microsoft.PowerApps/apps/<app-id>'
```

For model-driven designer or sitemap work, pass the exact `make.powerapps.com`
designer URL with `--url` so the same managed browser profile is warmed for the
surface you plan to automate or capture.

## Getting tokens directly

If you want to inspect the raw token:

```bash
pp auth token --profile dev-user --resource https://example.crm.dynamics.com
```

If the profile already has a default resource or explicit scopes, `--resource` can be omitted.

## Environment aliases

An environment alias ties a Dataverse URL to an auth profile so you can refer to
the pair by a short name in every command.

```bash
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
```

Beyond the required `--url` and `--profile`, you can attach optional metadata
with `--default-solution`, `--display-name`, `--maker-env-id`, `--tenant-id`,
and `--api-path`.

The `--maker-env-id` flag deserves a brief explanation. It does not affect
Dataverse resolution at all; it is optional metadata that lets `pp` print exact
Maker deep links for workflows such as the current canvas create/import fallback
guidance.

For one-off runs, `pp canvas create` and `pp canvas import` also accept
`--maker-env-id` directly so you do not have to persist that metadata on the
alias first. When the alias does not already store `makerEnvironmentId`, those
canvas fallback commands try to discover it live from the authenticated Power
Platform environments API before falling back to generic Maker guidance. On real
create/import runs, `pp` also caches the discovered id back onto the saved alias
so later Maker handoffs do not need to rediscover or re-enter it.

### Inspecting, listing, and removing aliases

The following commands let you inspect an alias in detail, snapshot an
environment baseline, resolve a maker environment ID, list all aliases, or
remove one.

```bash
pp env inspect dev
pp env baseline dev --prefix ppHarness20260310T013401820Z --format json
pp env resolve-maker-id dev
pp env list
pp env remove dev
```

`pp env resolve-maker-id <alias>` uses the alias's bound auth profile to query
the Power Platform environments API, persists the discovered
`makerEnvironmentId` back onto that alias, and returns the updated alias
record. Use this when a harness or Maker handoff needs exact `make.powerapps`
deep links but the alias was originally registered without `--maker-env-id`.

### Understanding `env inspect` output

`pp env inspect <alias>` expands the bound auth profile summary and includes a
tooling advisory block. You can output it as JSON for scripting:

```bash
pp env inspect test --format json
```

The `auth.status` field confirms whether the bound profile is configured
locally, while `auth.type` and `auth.browserProfile` tell you whether the alias
is browser-backed.

The `tooling.pac` section makes a common failure mode explicit: `pac` does not
read `pp` auth profiles, browser-profile bootstrap state, or cached `pp`
sessions. A successful `pp dv whoami --env <alias>` only proves the alias works
inside `pp`. The `tooling.pac.sharesPpAuthContext` field (currently `false`)
states this directly. The section also provides
`tooling.pac.organizationUrl` and `tooling.pac.verificationCommand` so the pac
target URL check is explicit instead of implied. For non-interactive work,
`tooling.pac.nonInteractiveVerification` clarifies the contract: use `pp` for
`--no-interactive-auth` checks instead of assuming the same flag exists on
`pac`. Check `tooling.pac.risk` and `tooling.pac.reason` before assuming a `pac`
fallback will stay non-interactive.

For harness and fallback workflows, use that output as the contract. Prefer
staying inside `pp` when possible; if `pac` is unavoidable, treat it as a
separately authenticated tool and verify it explicitly before relying on it in
the middle of a scenario step.

### Working with `pac` alongside `pp`

When a browser-mediated fallback still needs Playwright or another automation
tool to capture portal evidence, do not point that tool directly at a live
managed browser profile if Chromium left a `SingletonLock` in place. Keep the
saved `pp` browser profile as the bootstrap source of truth, but copy it into a
run-local directory before launching read-only provenance capture from a second
process. Record that distinction in the harness/report notes so later triage can
tell whether the fallback proved reusable `pp` session state or only harvested
evidence from a safe local clone.

Treat `--no-interactive-auth` as a `pp` contract, not a `pac` contract. Use
`pp env inspect <alias>` plus `pp dv whoami --no-interactive-auth` for the
non-interactive preflight, then use `pac auth list` only to verify whether pac
is separately authenticated to the same org URL.

For canvas workflows in particular, do not assume `pac canvas list` or
`pac canvas download` can reuse a working `pp` browser-backed alias. If
`tooling.pac.sharesPpAuthContext` is `false`, finish the `pp` path first
(`pp canvas download`, delegated Maker create, or a recorded fixture fallback)
before you decide whether `pac` is still necessary.

When `pac` is genuinely required, bootstrap it as its own setup step instead of
discovering that requirement mid-run:

```bash
pac auth list
pac auth create --name test-pac --deviceCode --environment https://example.crm.dynamics.com
pac auth select --name test-pac
pac auth who
```

Compare the active `pac auth list` URL with `tooling.pac.organizationUrl` from
`pp env inspect`. Use the Dataverse org URL from the target environment alias,
not the fact that `pp dv whoami --env <alias>` succeeded, as the input contract
for that bootstrap.

### Environment baselines

For disposable bootstrap flows, use
`pp env baseline <alias> --prefix <runPrefix> [--expect-absent-solution <name>]`
to get one machine-readable pre-mutation report. That combines `env inspect`,
prefix collision checks, and optional prior-solution absence checks behind one
`readyForBootstrap` result.

Prefix-scoped cleanup and reset capabilities are available through the MCP
server (`pp.environment.cleanup-plan` and `pp.environment.cleanup`) but are not
currently wired as CLI subcommands.

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
