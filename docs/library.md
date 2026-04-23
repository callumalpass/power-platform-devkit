# Library Usage

`pp` can be used as a side-effect-free TypeScript library. Importing `pp` does not start the CLI, open a browser, or start an MCP server.

## Entry Points

- `pp` - stable public API.
- `pp/api` - request helpers such as `executeApiRequest`.
- `pp/auth` - account and token provider primitives.
- `pp/client` - the `PpClient` convenience facade.
- `pp/config` - config file helpers and config model types.
- `pp/dataverse` - Dataverse metadata, query, create, and FetchXML helpers.
- `pp/diagnostics` - `OperationResult`, diagnostics, `ok`, and `fail`.
- `pp/environments` - environment management helpers.
- `pp/fetchxml-language` - FetchXML analysis and completions.
- `pp/flow-language` - Power Automate definition analysis and expression completions.
- `pp/request` - low-level request preparation and execution.
- `pp/mcp` - programmatic MCP server creation.
- `pp/experimental/canvas-authoring` - unstable Canvas Authoring helpers.

## Requests

```ts
import { PpClient } from 'pp';

const pp = new PpClient();

const result = await pp.request({
  env: 'dev',
  api: 'dv',
  path: '/accounts',
  query: { '$select': 'name,accountid', '$top': '5' },
  readIntent: true,
});

if (!result.success) {
  console.error(result.diagnostics);
} else {
  console.log(result.data.response);
}
```

Graph and SharePoint can be account-scoped:

```ts
import { executeApiRequest } from 'pp/api';

await executeApiRequest({
  accountName: 'work',
  api: 'graph',
  path: '/me',
  readIntent: true,
});
```

Use a generic when you know the response shape:

```ts
const result = await pp.request<{ value: Array<{ name?: string }> }>({
  env: 'dev',
  api: 'dv',
  path: '/accounts',
  query: { '$select': 'name' },
  readIntent: true,
});
```

The lower-level functions remain available for applications that prefer explicit dependency passing:

```ts
import { executeApiRequest } from 'pp/api';

await executeApiRequest(
  { environmentAlias: 'dev', api: 'dv', path: '/WhoAmI', readIntent: true },
  { configDir: './.pp-config' },
  { allowInteractive: false },
);
```

## Auth

The library uses the same config and MSAL cache as the CLI. To isolate a tool or test suite, pass `configDir`.

```ts
import { loginAccount } from 'pp/accounts';

await loginAccount(
  { name: 'work', kind: 'device-code' },
  {
    preferredFlow: 'device-code',
    onDeviceCode: ({ message }) => console.error(message),
  },
  { configDir: './.pp-config' },
);
```

For non-interactive tools, use `client-secret`, `environment-token`, or `static-token` accounts.

## Error Handling

Most library functions return `OperationResult<T>` instead of throwing for expected failures.

```ts
if (!result.success) {
  for (const diagnostic of result.diagnostics) {
    console.error(`${diagnostic.code}: ${diagnostic.message}`);
    if (diagnostic.hint) console.error(diagnostic.hint);
  }
}
```

Unexpected runtime errors, such as import failures or caller bugs, can still throw.

## Experimental APIs

Canvas Authoring helpers live under `pp/experimental/canvas-authoring`. They target observed Studio and MCP-backed endpoints, so endpoint availability and response shapes can change independently of `pp`.
