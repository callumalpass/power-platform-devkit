import { describe, expect, it } from 'vitest';
import { ExtensionRegistry, isExtensionCompatible, loadExtensions, type PpExtensionModule } from './index';

describe('ExtensionRegistry', () => {
  it('registers repo-local and package extensions across provider, analysis, adapter, CLI, and MCP surfaces', async () => {
    const repoLocalExtension: PpExtensionModule = {
      manifest: {
        name: 'repo.local.contoso',
        version: '1.2.0',
        displayName: 'Contoso Repo Extensions',
        description: 'Adds a provider, governance analysis, and repo-local commands.',
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
              description: 'Resolves repo-local document bundles as deploy targets.',
            },
          ],
          analyses: [
            {
              kind: 'analysis',
              id: 'analysis.contoso.policy',
              analysisKind: 'portfolio-policy',
              title: 'Contoso Policy Pack',
              description: 'Adds organization-specific portfolio governance checks.',
            },
          ],
          cliCommands: [
            {
              kind: 'cli-command',
              id: 'cli.contoso.policy-report',
              command: 'contoso policy-report',
              title: 'Contoso Policy Report',
              description: 'Runs the repo-local governance summary.',
            },
          ],
        };
      },
    };

    const packageExtension: PpExtensionModule = {
      manifest: {
        name: '@partner/deploy-bundle',
        version: '0.4.0',
        supportTier: 'experimental',
        supportModel: 'third-party',
        trustLevel: 'experimental',
        compatibility: {
          apiVersion: '1.0.0',
          coreVersions: ['0.1.x'],
        },
      },
      activate() {
        return {
          deployAdapters: [
            {
              kind: 'deploy-adapter',
              id: 'adapter.partner.release',
              adapterKind: 'partner-release',
              title: 'Partner Release Adapter',
              description: 'Bridges pp deploy plans into an external release orchestrator.',
            },
          ],
          mcpTools: [
            {
              kind: 'mcp-tool',
              id: 'mcp.partner.release.inspect',
              toolName: 'pp.partner.release.inspect',
              mutationMode: 'controlled',
              title: 'Inspect Partner Release',
              description: 'Exposes partner release state to MCP with the same support metadata model.',
            },
          ],
        };
      },
    };

    const result = await loadExtensions(
      [
        {
          source: {
            kind: 'repo-local',
            entrypoint: './tools/pp.contoso.extension.ts',
          },
          extension: repoLocalExtension,
        },
        {
          source: {
            kind: 'package',
            entrypoint: '@partner/deploy-bundle',
          },
          extension: packageExtension,
        },
      ],
      {
        apiVersion: '1.0.0',
        coreVersion: '0.1.0',
        allowExperimental: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.extensions).toHaveLength(2);
    expect(result.data?.providers.map((entry) => entry.providerKind)).toEqual(['contoso-docs']);
    expect(result.data?.analyses.map((entry) => entry.analysisKind)).toEqual(['portfolio-policy']);
    expect(result.data?.deployAdapters.map((entry) => entry.adapterKind)).toEqual(['partner-release']);
    expect(result.data?.cliCommands.map((entry) => entry.command)).toEqual(['contoso policy-report']);
    expect(result.data?.mcpTools.map((entry) => entry.toolName)).toEqual(['pp.partner.release.inspect']);
    const repoLocalSummary = result.data?.extensions.find((entry) => entry.name === 'repo.local.contoso');
    expect(repoLocalSummary?.capabilities.map((entry) => entry.kind)).toEqual(['provider', 'analysis', 'cli-command']);
  });

  it('blocks experimental extensions when policy does not allow them', async () => {
    const registry = new ExtensionRegistry({
      apiVersion: '1.0.0',
      coreVersion: '0.1.0',
    });

    const result = await registry.register({
      source: {
        kind: 'package',
        entrypoint: '@partner/deploy-bundle',
      },
      extension: {
        manifest: {
          name: '@partner/deploy-bundle',
          version: '0.4.0',
          supportTier: 'experimental',
          supportModel: 'third-party',
          trustLevel: 'experimental',
          compatibility: {
            apiVersion: '1.0.0',
          },
        },
        activate() {
          return {
            deployAdapters: [
              {
                kind: 'deploy-adapter',
                id: 'adapter.partner.release',
                adapterKind: 'partner-release',
                title: 'Partner Release Adapter',
                description: 'Bridges pp deploy plans into an external release orchestrator.',
              },
            ],
          };
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('EXTENSION_EXPERIMENTAL_BLOCKED');
  });

  it('rejects duplicate contribution ids to keep discovery deterministic', async () => {
    const registry = new ExtensionRegistry({
      apiVersion: '1.0.0',
      coreVersion: '0.1.0',
      allowExperimental: true,
    });

    const first = await registry.register({
      source: {
        kind: 'builtin',
        entrypoint: '@pp/builtin/contoso',
      },
      extension: {
        manifest: {
          name: '@pp/builtin/contoso',
          version: '1.0.0',
          supportTier: 'stable',
          supportModel: 'first-party',
          trustLevel: 'trusted',
          compatibility: {
            apiVersion: '1.0.0',
          },
        },
        activate() {
          return {
            cliCommands: [
              {
                kind: 'cli-command',
                id: 'cli.shared.inspect',
                command: 'shared inspect',
                title: 'Shared Inspect',
                description: 'Shared command id.',
              },
            ],
          };
        },
      },
    });

    const second = await registry.register({
      source: {
        kind: 'repo-local',
        entrypoint: './tools/override.ts',
      },
      extension: {
        manifest: {
          name: 'repo.local.override',
          version: '1.0.0',
          supportTier: 'preview',
          supportModel: 'repo-local',
          trustLevel: 'trusted',
          compatibility: {
            apiVersion: '1.0.0',
          },
        },
        activate() {
          return {
            cliCommands: [
              {
                kind: 'cli-command',
                id: 'cli.shared.inspect',
                command: 'override inspect',
                title: 'Override Inspect',
                description: 'Conflicting command id.',
              },
            ],
          };
        },
      },
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.diagnostics[0]?.code).toBe('EXTENSION_DUPLICATE_CONTRIBUTION');
  });
});

describe('isExtensionCompatible', () => {
  it('matches API major versions and simple core-version patterns', () => {
    expect(
      isExtensionCompatible(
        {
          apiVersion: '1.1.0',
          coreVersions: ['0.1.x'],
        },
        {
          apiVersion: '1.0.0',
          coreVersion: '0.1.7',
        }
      )
    ).toBe(true);

    expect(
      isExtensionCompatible(
        {
          apiVersion: '2.0.0',
          coreVersions: ['0.1.x'],
        },
        {
          apiVersion: '1.0.0',
          coreVersion: '0.1.7',
        }
      )
    ).toBe(false);
  });
});
