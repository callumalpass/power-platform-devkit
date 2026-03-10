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
pp auth profile remove temp
```

The profile summary includes the effective client ID, tenant, cache key, and stored account identifiers for user-style profiles. That matters when several named identities live on the same machine.

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
to persist that metadata on the alias first.

Inspect and remove aliases:

```bash
pp env inspect dev
pp env list
pp env remove dev
```

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
