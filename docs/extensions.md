# Extensions

`pp` now has a narrow extension contract in [`@pp/extensions`](/home/calluma/projects/pp/packages/extensions/src/index.ts) for adding new provider packages, analysis modules, deploy adapters, CLI commands, and MCP tools without forking the core packages.

## Design goals

- keep the extension surface explicit and typed rather than hook-heavy
- let first-party, repo-local, and third-party modules participate in the same support-tier and diagnostics model
- preserve reproducibility by making compatibility and trust policy part of loading, not an afterthought

## Extension model

An extension module exports:

- `manifest`: identity, version, support tier, support model, trust level, and compatibility
- `activate(context)`: returns concrete contributions for one or more surfaces

Supported contribution surfaces:

- `provider`
- `analysis`
- `deploy-adapter`
- `cli-command`
- `mcp-tool`

The registry normalizes each contribution into capability-discovery metadata so interfaces can report:

- which extension supplied the capability
- whether it is `stable`, `preview`, or `experimental`
- whether it is first-party, repo-local, or third-party
- whether policy treated it as `trusted` or `experimental`

## Loading and trust policy

The registry is policy-driven. A host chooses:

- `apiVersion`: current extension API contract version
- `coreVersion`: current `pp` core version
- `allowExperimental`: whether experimental extensions may load at all
- `allowedSources`: which source kinds are permitted: `builtin`, `repo-local`, `package`

Registration fails when:

- the source kind is disabled
- an extension is marked experimental and policy blocks it
- the extension API major version is incompatible
- the declared core-version patterns do not match the running core
- two extensions try to register the same contribution id for the same surface

This keeps command discovery and capability reporting deterministic.

## Compatibility rules

The first contract uses:

- API compatibility by major version
- core compatibility by simple exact or wildcard patterns such as `0.1.x`

That is intentionally narrow. It is enough to pin loader expectations without introducing a full marketplace or dynamic resolution layer yet.

## Example

```ts
import type { PpExtensionModule } from '@pp/extensions';

export const contosoExtension: PpExtensionModule = {
  manifest: {
    name: 'repo.local.contoso',
    version: '1.0.0',
    supportTier: 'preview',
    supportModel: 'repo-local',
    trustLevel: 'trusted',
    compatibility: {
      apiVersion: '1.0.0',
      coreVersions: ['0.1.x'],
    },
  },
  activate() {
    return {
      providers: [
        {
          kind: 'provider',
          id: 'provider.contoso.docs',
          providerKind: 'contoso-docs',
          title: 'Contoso Docs Provider',
          description: 'Adds a repo-local provider surface.',
        },
      ],
      cliCommands: [
        {
          kind: 'cli-command',
          id: 'cli.contoso.policy-report',
          command: 'contoso policy-report',
          title: 'Contoso Policy Report',
          description: 'Adds a repo-local CLI command.',
        },
      ],
    };
  },
};
```

See [`packages/extensions/src/index.test.ts`](/home/calluma/projects/pp/packages/extensions/src/index.test.ts) for end-to-end examples covering repo-local and package extensions across provider, analysis, deploy-adapter, CLI, and MCP surfaces.
