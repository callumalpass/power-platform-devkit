# SharePoint

`pp sharepoint` exposes an inspect-first SharePoint surface over Microsoft
Graph. It reuses the existing `pp` auth model:

- `--environment` resolves to the auth profile bound to that alias
- token acquisition still goes through `AuthService` and `createTokenProvider`
- the effective auth resource comes from `--resource` first, then the profile
  `defaultResource`

Because this module currently uses Microsoft Graph, pass
`--resource https://graph.microsoft.com` when the stored profile still defaults
to a Dataverse resource URL.

## Commands

```bash
pp sharepoint site list --environment graph-dev [--search Finance] [--top 20]
pp sharepoint site inspect <site-id|hostname:/path|url> --environment graph-dev

pp sharepoint list list --environment graph-dev --site https://contoso.sharepoint.com/sites/Finance
pp sharepoint list items Campaigns --environment graph-dev --site https://contoso.sharepoint.com/sites/Finance

pp sharepoint file list --environment graph-dev --site https://contoso.sharepoint.com/sites/Finance
pp sharepoint file inspect /Shared Documents/Budget.xlsx --environment graph-dev --site https://contoso.sharepoint.com/sites/Finance

pp sharepoint permission list --environment graph-dev --site https://contoso.sharepoint.com/sites/Finance
pp sharepoint permission list --environment graph-dev --site https://contoso.sharepoint.com/sites/Finance --file /Shared Documents/Budget.xlsx
```

## Behavior notes

- `site inspect` accepts a Graph site id, a `hostname:/path` reference, or a
  full SharePoint site URL.
- `list items` resolves the list by id first, then by name/display name within
  the selected site.
- `file list` uses the default site drive unless `--drive` is supplied.
- `file inspect` accepts a drive item id, a server-relative path, or a full URL.
- `permission list` works at site scope by default and can narrow to one list
  or one drive item with `--list` or `--file`.

## Current boundary

The implemented SharePoint surface is read-only. No SharePoint write commands
are exposed yet, so `--plan` and `--dry-run` remain relevant to other `pp`
domains but are not used by current SharePoint commands.
