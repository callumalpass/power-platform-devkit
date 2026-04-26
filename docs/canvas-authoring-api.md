# Canvas Authoring API Notes

These notes document the low-level Power Apps canvas authoring service used by the Microsoft
`Microsoft.PowerApps.CanvasAuthoring.McpServer` package and by Power Apps Studio. This surface is
internal and may change without notice. Treat endpoint names, payloads, and auth details as observed
behavior, not a public contract.

The useful pattern is:

1. Discover the environment's authoring cluster.
2. Start an app-scoped authoring session.
3. Call versioned document endpoints under the returned authoring host using the session headers.

## Identity

The public cloud canvas authoring resource is:

```text
c6c4e5e1-0bc0-4d7d-b69b-954a907287e4/.default
```

The Microsoft MCP server maps public cloud to resource id
`c6c4e5e1-0bc0-4d7d-b69b-954a907287e4`; test/preprod maps to
`7f96ed90-4ea5-48c1-b589-81ac94ade0aa`.

The MCP server itself uses public client id:

```text
d8624097-bc66-4676-9a96-55b1de2010bd
```

`pp` currently uses a separate first-party client for `canvas-authoring` token acquisition, because
the normal public client is not preauthorized for this resource.

## Cluster Discovery

Cluster discovery starts from the environment API host:

```http
GET https://<encoded-environment-id>.environment.api.powerplatform.com/gateway/cluster
```

For prod non-default environments, the MCP package encodes the environment id by removing dashes and
splitting the final two characters into a suffix:

```text
f3f934b0-7b79-e09e-b393-f0b21c05fcce
=> f3f934b07b79e09eb393f0b21c05fc.ce
```

So the discovery URL is:

```text
https://f3f934b07b79e09eb393f0b21c05fc.ce.environment.api.powerplatform.com/gateway/cluster
```

Observed response shape:

```json
{
  "clusterNumber": "102",
  "geoName": "au",
  "environment": "Prod",
  "clusterType": "IslandCluster",
  "clusterCategory": "Prod",
  "clusterName": "prdil102seau",
  "geoLongName": "australia"
}
```

The MCP server builds an initial authoring host from `geoName`, `clusterNumber`, and `environment`:

```text
https://authoring.<geoName>-il<clusterNumber>.gateway.<environment>.island.powerapps.com/
```

In practice the session-start call may return HTTP `412` with a `redirectionUrl`; retry against that
URL and update the authoring host to the redirected origin. The session response may also include
`clientConfig.directOriginBaseUrl`; subsequent document calls should use that origin if present.

## Authoring Session

Start an authoring session:

```http
POST https://authoring.<geo>-il<cluster>.gateway.<env>.island.powerapps.com/api/authoringsession/start?environment-name=<env-id>&environment-update-cadence=Frequent
```

Important headers for app-scoped sessions:

```text
x-ms-client-session-id: <new-guid>
x-ms-client-request-id: <new-guid>
x-ms-environment-name: <environment-id>
x-ms-environment-update-cadence: Frequent
x-ms-app-name: /providers/Microsoft.PowerApps/apps/<app-id>
```

Observed response fields:

```json
{
  "clientConfig": {
    "webAuthoringVersion": "v3.26035.11.365639676",
    "directOriginBaseUrl": "https://authoring..."
  },
  "sessionState": "<opaque>",
  "domainName": "...",
  "authoringHostVersion": "...",
  "isCoauthoringEnabled": true,
  "isCoauthoringWithMultipleWritersEnabled": true
}
```

The MCP server keeps the original generated `x-ms-client-session-id` as its document session id. It
does not read a separate `sessionId` field from this response.

Versioned document calls use:

```text
https://<authoring-origin>/<clientConfig.webAuthoringVersion>/<path>
```

And these headers:

```text
x-ms-client-session-id: <session-id-from-start-header>
x-ms-session-state: <sessionState-from-start-response>
x-ms-client-request-id: <new-guid>
```

Dispose an authoring session:

```http
POST /<webAuthoringVersion>/api/authoringsession/dispose
```

The MCP server only calls dispose during shutdown.

## MCP Tool Endpoints

The Microsoft MCP server exposes these tools and maps them to the following endpoints.

| MCP tool                   | Method and path                                        | Notes                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compile_canvas`           | `POST /<version>/api/yaml/validate-directory`          | Validates a set of `.pa.yaml` files. Observed behavior: in an active coauthoring session this can also apply the YAML into the live dirty Studio document. |
| `sync_canvas`              | `GET /<version>/api/yaml/fetch`                        | Returns source-control YAML files from the live authoring session. Component support is incomplete; see "Component limitations" below.                     |
| `list_controls`            | `GET /<version>/api/yaml/controls`                     | Lists controls available in the current authoring session.                                                                                                 |
| `describe_control`         | `GET /<version>/api/yaml/controls/{controlName}`       | Returns metadata, variants, input properties, and output properties.                                                                                       |
| `list_apis`                | `GET /<version>/api/yaml/apis`                         | Lists APIs/connectors available in the current authoring session.                                                                                          |
| `describe_api`             | `GET /<version>/api/yaml/apis/{apiName}`               | Returns connector operations and parameters.                                                                                                               |
| `list_data_sources`        | `GET /<version>/api/yaml/datasources`                  | Lists data sources in the current app/session.                                                                                                             |
| `get_data_source_schema`   | `GET /<version>/api/yaml/datasources/{dataSourceName}` | Returns columns and Power Fx types for one data source.                                                                                                    |
| `get_accessibility_errors` | `GET /<version>/api/yaml/accessibility-errors`         | Dynamically registered only for server versions `v3.26041+`.                                                                                               |

## Request And Response Shapes

### `POST /api/yaml/validate-directory`

Request:

```json
{
  "files": [
    {
      "path": "Src/App.pa.yaml",
      "content": "..."
    }
  ]
}
```

Response:

```json
{
  "isValid": true,
  "hasActiveCoauthoringSession": true,
  "diagnostics": []
}
```

### `GET /api/yaml/fetch`

Response:

```json
{
  "files": [
    {
      "path": "App.pa.yaml",
      "content": "..."
    },
    {
      "path": "Screen1.pa.yaml",
      "content": "..."
    }
  ]
}
```

The MCP sync tool writes these files directly under the target directory. In a downloaded `.msapp`,
the source-control files live under `Src/`; the authoring API response paths may omit that prefix.

### Component limitations

As of the tested authoring host version `v3.26035.11.365639676`, the YAML workflow is not reliable
for Canvas apps that use components.

Observed behavior:

- `GET /api/yaml/fetch` returned only `App.pa.yaml` and screen files for an app that had component
  source in the downloaded `.msapp`.
- The corresponding `.msapp` contained `Src/Components/component_test.pa.yaml` and component package
  metadata, but the authoring YAML fetch response omitted those files.
- `POST /api/yaml/validate-directory` worked and applied changes for ordinary app/screen YAML.
- The same endpoint returned `isValid: false`, `hasActiveCoauthoringSession: false`, and no
  diagnostics when validating `.msapp`-derived source that included `CanvasComponent` usage and
  `ComponentDefinitions`.
- Removing the component instance and component definition from the same package-derived source made
  validation return `isValid: true` and `hasActiveCoauthoringSession: true`.

There is a related upstream report in `microsoft/power-platform-skills`:
[#86: sync_canvas does not include component libraries, blocking all edits on apps that reference them](https://github.com/microsoft/power-platform-skills/issues/86).
That issue describes external component libraries rather than an in-app custom component, but the
failure mode is the same class: component definitions are missing or unusable in the current
MCP/YAML round trip, so unrelated edits can be blocked.

Until the backend/MCP service supports components more completely, prefer this workflow:

- Use `yaml fetch` / `yaml validate` for apps and screens that do not reference Canvas components.
- Avoid introducing custom Canvas components or component libraries into apps managed through this
  YAML workflow.
- If a component is already present, treat successful validation of component-aware `.msapp` source
  as unsupported unless `hasActiveCoauthoringSession` is `true` and diagnostics are clean.
- Make component edits manually in Maker/Studio, or remove component usage before using
  `validate-directory` for unrelated screen changes.

### `GET /api/yaml/controls`

Response:

```json
{
  "count": 117,
  "controls": [{ "name": "Button" }, { "name": "Label" }, { "name": "Gallery" }]
}
```

Observed examples include:

```text
AddMedia
Button
Classic/Button
Classic/TextInput
Gallery
GroupContainer
Label
ModernCard
ModernCombobox
ModernDataGrid
ModernText
ModernTextInput
Table
Text
TextInput
Toolbar
```

### `GET /api/yaml/controls/{controlName}`

Response:

```json
{
  "name": "label",
  "type": "label",
  "templateName": "label",
  "family": "Classic",
  "variants": [],
  "inputProperties": [
    {
      "name": "Text",
      "type": "Text"
    },
    {
      "name": "Align",
      "type": "Enum",
      "enumInfo": {
        "name": "Align",
        "enumValues": ["Center", "Justify", "Left", "Right"]
      }
    }
  ],
  "outputProperties": [
    {
      "name": "Text",
      "type": "Text"
    }
  ]
}
```

Friendly names are resolved by the server. For example, `button` can resolve to the modern Fluent
control:

```json
{
  "name": "powerapps_corecontrols_buttoncanvas",
  "type": "button",
  "templateName": "PowerApps_CoreControls_ButtonCanvas",
  "family": "FluentV9"
}
```

### `GET /api/yaml/apis`

Response:

```json
{
  "count": 1,
  "apis": [
    {
      "name": "Office365Users"
    }
  ]
}
```

This list is scoped to the current app/session. In an app with no connector references it returned:

```json
{
  "count": 0,
  "apis": []
}
```

After adding the Office 365 Users connector to the same app, it returned `Office365Users`.

### `GET /api/yaml/apis/{apiName}`

Response:

```json
{
  "name": "Office365Users",
  "operations": [
    {
      "name": "SearchUser",
      "returnType": "Table",
      "returnSchema": "...",
      "description": "...",
      "isBehaviorOnly": false,
      "requiredParameters": [],
      "optionalParameters": []
    }
  ]
}
```

Observed operation names for `Office365Users` included:

```text
DirectReports
DirectReportsV2
HttpRequest
Manager
ManagerV2
MyProfile
MyProfileV2
MyTrendingDocuments
RelevantPeople
SearchUser
SearchUserV2
TrendingDocuments
UpdateMyPhoto
UpdateMyProfile
UserPhoto
UserPhotoMetadata
UserPhotoV2
UserProfile
UserProfileV2
```

Operation parameters are split into `requiredParameters` and `optionalParameters`; each parameter
has `name`, `type`, and optional `description`. `HttpRequest` is marked `isBehaviorOnly: true` and
requires `Uri`, `Method`, and `file` parameters.

If the API is not referenced by the current app/session, the endpoint returns `404`:

```json
{
  "error": "API 'Office365Users' not found."
}
```

### `GET /api/yaml/datasources`

Response:

```json
{
  "count": 2,
  "dataSources": [
    {
      "name": "Bug Projects",
      "kind": "CdsNative",
      "isWritable": true,
      "isDelegatable": true
    },
    {
      "name": "Bug Tasks",
      "kind": "CdsNative",
      "isWritable": true,
      "isDelegatable": true
    }
  ]
}
```

This list is also scoped to the current app/session. Before Dataverse tables were added to the app,
the same endpoint returned:

```json
{
  "count": 0,
  "dataSources": []
}
```

### `GET /api/yaml/datasources/{dataSourceName}`

Response:

```json
{
  "name": "Bug Tasks",
  "kind": "CdsNative",
  "columns": [
    {
      "logicalName": "pp_bugtaskid",
      "displayName": "Bug Task",
      "type": "Guid"
    },
    {
      "logicalName": "pp_name",
      "displayName": "Name",
      "type": "String"
    },
    {
      "logicalName": "pp_ProjectId",
      "displayName": "Project",
      "type": "DataEntity"
    },
    {
      "logicalName": "statecode",
      "displayName": "Status",
      "type": "OptionSetValue",
      "optionSetInfo": {
        "name": "Status (Bug Tasks)",
        "values": ["Active", "Inactive"]
      }
    },
    {
      "logicalName": "_ownerid_value",
      "displayName": "Owner",
      "type": "Polymorphic"
    },
    {
      "logicalName": "{Attachments}",
      "displayName": "Attachments",
      "type": "LazyTable"
    }
  ]
}
```

Observed Dataverse column types include `Guid`, `String`, `DateTime`, `OptionSetValue`,
`DataEntity`, `Polymorphic`, and `LazyTable`. Option-set columns may include `optionSetInfo` with a
display name and allowed values.

If the data source is not referenced by the current app/session, the endpoint returns `404`:

```json
{
  "error": "Data source 'Accounts' not found."
}
```

### `GET /api/yaml/accessibility-errors`

Response:

```json
{
  "count": 0,
  "errors": [
    {
      "screenName": "Screen1",
      "controlName": "Button1",
      "propertyName": "AccessibleLabel",
      "severity": "Error",
      "message": "..."
    }
  ]
}
```

## Low-Level `pp` Usage

`pp canvas-authoring session start` wraps cluster discovery and session start. Use `--raw` if you
need the `sessionState` for direct document calls:

```sh
pp canvas-authoring session start --env dev --app <app-id> --raw
```

Then call a document endpoint with manual session headers:

```sh
pp canvas-authoring 'https://authoring.<geo>-il<cluster>.gateway.prod.island.powerapps.com/<version>/api/yaml/controls' \
  --env dev \
  --read \
  --header 'x-ms-client-session-id: <session-id>' \
  --header 'x-ms-session-state: <session-state>' \
  --header 'x-ms-client-request-id: <guid>'
```

This is intentionally low-level. Helper commands can wrap common flows later without hiding the raw
API shape from agents.

For session-aware REST calls, use `session request`:

```sh
pp canvas-authoring session request \
  --env dev \
  --app <app-id> \
  --path /api/yaml/fetch \
  --read
```

`session request` starts or reuses a saved authoring session, prefixes relative paths with the
current `webAuthoringVersion`, and sends the session id/session state headers required by the
authoring host.

Thin helpers wrap the known MCP-style REST endpoints:

```sh
pp canvas-authoring yaml fetch --env dev --app <app-id> --out ./canvas-src
pp canvas-authoring yaml validate --env dev --app <app-id> --dir ./canvas-src
pp canvas-authoring controls list --env dev --app <app-id>
pp canvas-authoring controls describe --env dev --app <app-id> Label
pp canvas-authoring apis list --env dev --app <app-id>
pp canvas-authoring apis describe --env dev --app <app-id> <api-name>
pp canvas-authoring datasources list --env dev --app <app-id>
pp canvas-authoring datasources describe --env dev --app <app-id> <data-source-name>
pp canvas-authoring accessibility --env dev --app <app-id>
```

These helpers are deliberately thin: they only map command names to `/api/yaml/...` paths and do
not interpret the Canvas document model.

`yaml validate` deserves special care. Despite the name, `POST /api/yaml/validate-directory` is
session-backed. In an active coauthoring session, a valid payload can update the live dirty draft
visible in Maker/Studio. Invalid YAML returns compiler/formula diagnostics and should not cleanly
apply. Treat it as "validate and possibly apply to the active authoring draft", not as a purely
offline linter.

For document-server RPC, use `invoke`:

```sh
pp canvas-authoring invoke \
  --env dev \
  --app <app-id> \
  --class documentservicev2 \
  --oid 1 \
  --method keepalive
```

The helper starts a session unless `--session-id`, `--session-state`, `--authoring-base-url`, and
`--web-authoring-version` are provided. It builds the versioned `/api/v2/invoke` URL and supplies
the required session and reliable-wire headers. Payloads can be passed with `--payload JSON` or
`--payload-file FILE`.

For RPC methods whose result is delivered over Studio's SignalR channel, use `rpc`:

```sh
pp canvas-authoring rpc \
  --env dev \
  --app <app-id> \
  --class document \
  --oid 2 \
  --method geterrorsasync
```

`rpc` starts or reuses an authoring session, negotiates the SignalR diagnostics hub, sends the same
logical invoke envelope as the web client, waits for the matching request id, and decodes `GZip`
responses when the service uses them. It is useful for read-style document methods that return an
empty HTTP body from `/api/v2/invoke`.

## Adjacent Endpoints

These are related to Canvas or Studio behavior but are not MCP YAML document endpoints.

### Authoring host configuration and sessions

Studio uses a few authoring-host endpoints outside the MCP YAML surface.

Configuration is available without a version prefix:

```http
GET /api/webauthconfig
```

Observed response fields overlap with the session-start `clientConfig`:

```json
{
  "webAuthoringVersion": "v3.26035.11.365639676",
  "aadClientId": "0cb2a3b9-c0b0-4f92-95e2-8955085f78c2",
  "language": "en-US",
  "docLanguage": "en-US",
  "cdnConfig": {
    "assetVersion": "3.26035.11.365639676",
    "cdnUrl": "https://content.powerapps.com/resource/webauth",
    "backupCdnUrl": "https://static.powerapps.com/resource/webauth"
  },
  "directOriginBaseUrl": "https://authoring.seau-il102.gateway.prod.island.powerapps.com"
}
```

The Studio bundle also references:

```http
POST /api/authoringsession/newinstance
POST /api/authoringsession/joinsession
GET  /api/authoringsession/newjointoken
POST /api/authoringsession/dispose
```

`newinstance` returned a full session response in a live probe. `joinsession` and `newjointoken`
returned `404` when called without the surrounding join-token flow, so they likely require a
coauthoring join context rather than a normal app-open context.

### Document RPC

The Studio bundle contains a versioned invoke endpoint:

```http
POST /<webAuthoringVersion>/api/v2/invoke
```

A malformed probe returned `400`, while `/api/invoke` returned `404`, which confirms that
`/api/v2/invoke` is a live document RPC endpoint rather than another static route. Browser traces
show the same logical invoke traffic can also flow over SignalR:

```text
/<webAuthoringVersion>/api/signalr/diagnosticshub
```

The RPC payload shape observed in SignalR traces contains:

```json
{
  "options": {
    "classname": "document",
    "oid": "2",
    "methodname": "setsaveappcontext",
    "x-ms-session-state": "<opaque>",
    "x-ms-environment-name": "<environment-id>",
    "x-ms-app-name": "/providers/Microsoft.PowerApps/apps/<app-id>"
  },
  "executionParameters": {
    "customLoggingDimensions": {
      "classNames": "document",
      "methodNames": "setsaveappcontext"
    }
  },
  "payload": "{\"dcall:document/2/setsaveappcontext\":{...}}"
}
```

`pp canvas-authoring rpc` sends that envelope through the SignalR hub protocol and waits for a
matching `Invoke` response. The raw response generally contains a string `result`; `decodedResult`
contains the parsed JSON or decoded text. Some DTO fields remain in the web client's transport
shape, for example arrays under `{ "f": [...] }` and union values under `{ "d": ..., "v": "..." }`.

The web client bundle has a large method id table for this RPC layer. Relevant method families
observed in `AppMagic.WebAuthoring.js` include:

```text
document_createconnecteddatasource
document_createconnectedservice
document_createcdsdatasourcesasync
document_patchconnecteddatasource
document_refreshcdsdatasourcesasync
document_batchrefreshcdpdatasources
document_notifydatasourceaddedtocoauthorsasync
document_notifydatasourcerefreshedtocoauthorsasync
document_removedatasource
document_getunuseddatasourcesasync
document_getunusedflowsasync
document_importcomponentsasync
document_importpowerappscontrolasync
document_importpowerappscontrolsasync
document_replacecontroltemplate
document_updatecontrolsubtreeasync
document_updatethirdpartycontrolsasync
document_publishtoblobasync
document_save
documentservicev2_publishandload
documentservicev2_componenttemplatefactorycreatecontroltemplate
documentservicev2_screentemplatefactorycreatecontroltemplate
documentservicev2_connectsessiontogitasync
documentservicev2_creategitbranchasync
documentservicev2_disconnectappfromgit
documentservicev2_staticdataimportgetexceltables
documentservicev2_staticdataimportimportsampledata
documentservicev2_staticdataimportimporttables
irefreshdatasourcecommand_executeasync
irefreshdatasourcecommand_executemanyasync
icaptureschemacommand_executeasync
isetpropertycommand_executeasync
isearchappcommand_executeasync
iclipboardmanager_cutyamlasync
iclipboardmanager_pasteserializedcontrols
```

See [Canvas Authoring RPC Method Catalog](canvas-authoring-rpc-methods.md) for the full observed
method-id list extracted from the Studio bundle.

This is a lower-level document-server API, not the MCP YAML REST API. It should be treated as
stateful RPC: object ids such as `document/2` and `documentservicev2/1` come from the live document
session, method DTOs are generated by the web client, and save/publish operations can mutate the app.

Observed with `pp canvas-authoring invoke`:

```text
documentservicev2/1/keepalive -> 200
document/2/save with an empty payload -> 200, but did not persist a prior YAML-applied dirty change
```

That suggests `document.save` is not sufficient by itself for cloud persistence. Studio's manual
save path likely needs the fuller generated DTOs and/or a different save pipeline method.

### App Checker and diagnostics

There are two useful diagnostic surfaces:

```http
POST /<webAuthoringVersion>/api/yaml/validate-directory
```

This MCP REST endpoint returns compiler and formula diagnostics for the YAML payload. A bad formula
such as `Text: =ThisIsNotAValidFunction(` returned diagnostics for `Label1.Text`, including:

```text
Expected an operand.
Unexpected characters. The formula contains 'Eof' where 'ParenClose' is expected.
'ThisIsNotAValidFunction' is an unknown or unsupported function.
```

The same formula errors are also available through document RPC:

```sh
pp canvas-authoring rpc \
  --env dev \
  --app <app-id> \
  --class document \
  --oid 2 \
  --method geterrorsasync
```

Observed App Checker category RPC methods:

```text
document/2/geterrorsasync
document/2/getappcheckerdatasourceresponsesasync
document/2/getappcheckerofflineresponsesasync
document/2/getappcheckerperformanceresponsesasync
```

In a live probe, `geterrorsasync` returned the injected formula errors over SignalR. The performance
category returned an empty result list:

```json
[{ "dresult": { "f": [] } }, { "seq": 1 }]
```

The MCP also has an accessibility checker endpoint:

```http
GET /<webAuthoringVersion>/api/yaml/accessibility-errors
```

However, the Microsoft MCP server only registers `get_accessibility_errors` for authoring host
versions `v3.26041+`. The tested host version `v3.26035.11.365639676` returned `404` for this
endpoint.

### Power Apps app package

The Power Apps app API returns a signed `.msapp` URL:

```http
GET https://api.powerapps.com/providers/Microsoft.PowerApps/apps/<app-id>
```

Field:

```text
properties.appUris.documentUri.value
```

The `.msapp` package contains:

```text
Src/App.pa.yaml
Src/*.pa.yaml
Src/Components/*.pa.yaml
References/Templates.json
References/Themes.json
```

`References/Templates.json` appears to include templates used by the app; it is not the same as the
authoring-session-wide `list_controls` endpoint.

### Dataverse Canvas and PCF tables

Dataverse exposes Canvas app rows in `canvasapps` and PCF/code components in `customcontrols`.
Canvas-capable PCF controls can be queried with:

```http
GET /api/data/v9.2/customcontrols?$select=name,version,supportedplatform,componentstate,authoringmanifest&$filter=contains(supportedplatform,'Canvas')
```

This is useful for PCF/code components, not the built-in Canvas control catalog.

### Maker/Studio shell calls

Observed in browser network traces:

```http
POST https://<encoded-env>.environment.api.powerplatform.com/powerapps/apps/<app-id>/sessions/<session-id>/refreshSession?api-version=1
POST https://<encoded-env>.environment.api.powerplatform.com/powerapps/evaluateDlpPoliciesForApp?api-version=1
POST https://<encoded-env>.environment.api.powerplatform.com/powerapps/apps/<app-id>/publish?api-version=1
```

These use the Power Platform API audience (`https://api.powerplatform.com`) in the browser and are
separate from the canvas authoring resource. The normal `pp` public client was not preauthorized for
that audience during testing.

## Probed But Not Found

The following authoring-host paths returned `404` in a live app session on
`v3.26035.11.365639676`:

```text
/api/components
/api/component
/api/controls
/api/controlcatalog
/api/control-catalog
/api/templates
/api/template
/api/metadata
/api/authoring/controls
/api/authoring/components
/api/studio/components
/api/studio/controls
/api/document/templates
/api/document/controls
```

The working catalog endpoints are under `/api/yaml/...`.
