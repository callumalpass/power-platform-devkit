import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult, type SupportTier } from '@pp/diagnostics';

export type ExtensionSourceKind = 'builtin' | 'repo-local' | 'package';
export type ExtensionSupportModel = 'first-party' | 'repo-local' | 'third-party';
export type ExtensionTrustLevel = 'trusted' | 'experimental';
export type ExtensionContributionKind = 'provider' | 'analysis' | 'deploy-adapter' | 'cli-command' | 'mcp-tool';

export interface ExtensionCompatibility {
  apiVersion: string;
  coreVersions?: string[];
}

export interface ExtensionManifest {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  supportTier: SupportTier;
  supportModel: ExtensionSupportModel;
  trustLevel: ExtensionTrustLevel;
  compatibility: ExtensionCompatibility;
}

export interface ExtensionSource {
  kind: ExtensionSourceKind;
  entrypoint: string;
}

export interface ExtensionCapabilitySummary {
  kind: ExtensionContributionKind;
  id: string;
  title: string;
  supportTier: SupportTier;
}

interface ExtensionContributionBase {
  id: string;
  title: string;
  description: string;
  supportTier?: SupportTier;
}

export interface ProviderExtensionContribution extends ExtensionContributionBase {
  kind: 'provider';
  providerKind: string;
}

export interface AnalysisExtensionContribution extends ExtensionContributionBase {
  kind: 'analysis';
  analysisKind: string;
}

export interface DeployAdapterExtensionContribution extends ExtensionContributionBase {
  kind: 'deploy-adapter';
  adapterKind: string;
}

export interface CliCommandExtensionContribution extends ExtensionContributionBase {
  kind: 'cli-command';
  command: string;
}

export interface McpToolExtensionContribution extends ExtensionContributionBase {
  kind: 'mcp-tool';
  toolName: string;
  mutationMode: 'read-only' | 'controlled';
}

export type ExtensionContribution =
  | ProviderExtensionContribution
  | AnalysisExtensionContribution
  | DeployAdapterExtensionContribution
  | CliCommandExtensionContribution
  | McpToolExtensionContribution;

export interface ExtensionContributions {
  providers?: ProviderExtensionContribution[];
  analyses?: AnalysisExtensionContribution[];
  deployAdapters?: DeployAdapterExtensionContribution[];
  cliCommands?: CliCommandExtensionContribution[];
  mcpTools?: McpToolExtensionContribution[];
}

export interface ExtensionActivationContext {
  coreVersion: string;
  apiVersion: string;
  source: ExtensionSource;
}

export interface PpExtensionModule {
  manifest: ExtensionManifest;
  activate(context: ExtensionActivationContext): ExtensionContributions | Promise<ExtensionContributions>;
}

export interface ExtensionRegistryPolicy {
  apiVersion: string;
  coreVersion: string;
  allowExperimental?: boolean;
  allowedSources?: ExtensionSourceKind[];
}

export interface RegisterExtensionRequest {
  source: ExtensionSource;
  extension: PpExtensionModule;
}

export interface RegisteredExtensionSummary {
  name: string;
  version: string;
  displayName: string;
  description?: string;
  source: ExtensionSource;
  supportTier: SupportTier;
  supportModel: ExtensionSupportModel;
  trustLevel: ExtensionTrustLevel;
  compatibility: ExtensionCompatibility;
  capabilities: ExtensionCapabilitySummary[];
}

export interface ExtensionRegistrySnapshot {
  policy: ExtensionRegistryPolicy;
  extensions: RegisteredExtensionSummary[];
  providers: ProviderExtensionContribution[];
  analyses: AnalysisExtensionContribution[];
  deployAdapters: DeployAdapterExtensionContribution[];
  cliCommands: CliCommandExtensionContribution[];
  mcpTools: McpToolExtensionContribution[];
}

function normalizeSupportTier(value: SupportTier | undefined, fallback: SupportTier): SupportTier {
  return value ?? fallback;
}

function flattenContributions(
  manifest: ExtensionManifest,
  contributions: ExtensionContributions
): ExtensionContribution[] {
  const withTier = <T extends ExtensionContribution>(entry: T): T => ({
    ...entry,
    supportTier: normalizeSupportTier(entry.supportTier, manifest.supportTier),
  });

  return [
    ...(contributions.providers ?? []).map(withTier),
    ...(contributions.analyses ?? []).map(withTier),
    ...(contributions.deployAdapters ?? []).map(withTier),
    ...(contributions.cliCommands ?? []).map(withTier),
    ...(contributions.mcpTools ?? []).map(withTier),
  ];
}

function coerceMajor(version: string): string | undefined {
  const match = /^(\d+)/.exec(version.trim());
  return match?.[1];
}

function matchesVersionPattern(version: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed === '*' || trimmed.length === 0) {
    return true;
  }

  const normalizedVersion = version.split('.');
  const normalizedPattern = trimmed.split('.');
  const maxLength = Math.max(normalizedVersion.length, normalizedPattern.length);

  for (let index = 0; index < maxLength; index += 1) {
    const expected = normalizedPattern[index];
    const actual = normalizedVersion[index];
    if (expected === undefined) {
      return actual === undefined;
    }
    if (expected === '*' || expected.toLowerCase() === 'x') {
      return true;
    }
    if (actual !== expected) {
      return false;
    }
  }

  return true;
}

export function isExtensionCompatible(
  compatibility: ExtensionCompatibility,
  registryPolicy: Pick<ExtensionRegistryPolicy, 'apiVersion' | 'coreVersion'>
): boolean {
  const extensionApiMajor = coerceMajor(compatibility.apiVersion);
  const registryApiMajor = coerceMajor(registryPolicy.apiVersion);

  if (!extensionApiMajor || !registryApiMajor || extensionApiMajor !== registryApiMajor) {
    return false;
  }

  if (!compatibility.coreVersions || compatibility.coreVersions.length === 0) {
    return true;
  }

  return compatibility.coreVersions.some((pattern) => matchesVersionPattern(registryPolicy.coreVersion, pattern));
}

function capabilitySummary(contribution: ExtensionContribution): ExtensionCapabilitySummary {
  return {
    kind: contribution.kind,
    id: contribution.id,
    title: contribution.title,
    supportTier: contribution.supportTier ?? 'preview',
  };
}

function duplicateContributionDiagnostic(existingName: string, contribution: ExtensionContribution): Diagnostic {
  return createDiagnostic(
    'error',
    'EXTENSION_DUPLICATE_CONTRIBUTION',
    `Contribution ${contribution.kind}:${contribution.id} is already registered by ${existingName}.`,
    {
      detail: `Each ${contribution.kind} contribution id must be globally unique so command and capability discovery stay deterministic.`,
    }
  );
}

export class ExtensionRegistry {
  private readonly extensions = new Map<string, RegisteredExtensionSummary>();

  private readonly contributions = new Map<string, { extensionName: string; contribution: ExtensionContribution }>();

  readonly policy: ExtensionRegistryPolicy;

  constructor(policy: ExtensionRegistryPolicy) {
    this.policy = {
      allowExperimental: false,
      allowedSources: ['builtin', 'repo-local', 'package'],
      ...policy,
    };
  }

  async register(request: RegisterExtensionRequest): Promise<OperationResult<RegisteredExtensionSummary>> {
    const { extension, source } = request;
    const diagnostics: Diagnostic[] = [];

    if (!this.policy.allowedSources?.includes(source.kind)) {
      return fail(
        createDiagnostic(
          'error',
          'EXTENSION_SOURCE_NOT_ALLOWED',
          `Extensions from source kind ${source.kind} are disabled by policy.`,
          {
            detail: `Allowed source kinds: ${(this.policy.allowedSources ?? []).join(', ') || 'none'}.`,
          }
        ),
        {
          supportTier: extension.manifest.supportTier,
        }
      );
    }

    if (extension.manifest.trustLevel === 'experimental' && !this.policy.allowExperimental) {
      return fail(
        createDiagnostic(
          'error',
          'EXTENSION_EXPERIMENTAL_BLOCKED',
          `Experimental extension ${extension.manifest.name} is disabled by policy.`,
          {
            hint: 'Enable allowExperimental only for explicitly trusted repos or packages.',
          }
        ),
        {
          supportTier: extension.manifest.supportTier,
        }
      );
    }

    if (!isExtensionCompatible(extension.manifest.compatibility, this.policy)) {
      return fail(
        createDiagnostic(
          'error',
          'EXTENSION_INCOMPATIBLE',
          `Extension ${extension.manifest.name} is not compatible with pp core ${this.policy.coreVersion} and extension API ${this.policy.apiVersion}.`,
          {
            detail: `Declared compatibility: api=${extension.manifest.compatibility.apiVersion}; core=${(extension.manifest.compatibility.coreVersions ?? ['*']).join(', ')}.`,
          }
        ),
        {
          supportTier: extension.manifest.supportTier,
        }
      );
    }

    if (this.extensions.has(extension.manifest.name)) {
      return fail(
        createDiagnostic(
          'error',
          'EXTENSION_DUPLICATE_NAME',
          `Extension ${extension.manifest.name} is already registered.`,
          {
            detail: 'Extension names must be unique across built-in, repo-local, and package modules.',
          }
        ),
        {
          supportTier: extension.manifest.supportTier,
        }
      );
    }

    const activated = await extension.activate({
      coreVersion: this.policy.coreVersion,
      apiVersion: this.policy.apiVersion,
      source,
    });

    const flattened = flattenContributions(extension.manifest, activated);

    for (const contribution of flattened) {
      const key = `${contribution.kind}:${contribution.id}`;
      const existing = this.contributions.get(key);
      if (existing) {
        diagnostics.push(duplicateContributionDiagnostic(existing.extensionName, contribution));
      }
    }

    if (diagnostics.length > 0) {
      return fail(diagnostics, {
        supportTier: extension.manifest.supportTier,
      });
    }

    const summary: RegisteredExtensionSummary = {
      name: extension.manifest.name,
      version: extension.manifest.version,
      displayName: extension.manifest.displayName ?? extension.manifest.name,
      description: extension.manifest.description,
      source,
      supportTier: extension.manifest.supportTier,
      supportModel: extension.manifest.supportModel,
      trustLevel: extension.manifest.trustLevel,
      compatibility: extension.manifest.compatibility,
      capabilities: flattened.map(capabilitySummary),
    };

    this.extensions.set(summary.name, summary);
    for (const contribution of flattened) {
      this.contributions.set(`${contribution.kind}:${contribution.id}`, {
        extensionName: summary.name,
        contribution,
      });
    }

    return ok(summary, {
      supportTier: extension.manifest.supportTier,
      diagnostics,
    });
  }

  snapshot(): ExtensionRegistrySnapshot {
    const allContributions = Array.from(this.contributions.values()).map((entry) => entry.contribution);

    return {
      policy: this.policy,
      extensions: Array.from(this.extensions.values()).sort((left, right) => left.name.localeCompare(right.name)),
      providers: allContributions.filter((entry): entry is ProviderExtensionContribution => entry.kind === 'provider'),
      analyses: allContributions.filter((entry): entry is AnalysisExtensionContribution => entry.kind === 'analysis'),
      deployAdapters: allContributions.filter(
        (entry): entry is DeployAdapterExtensionContribution => entry.kind === 'deploy-adapter'
      ),
      cliCommands: allContributions.filter((entry): entry is CliCommandExtensionContribution => entry.kind === 'cli-command'),
      mcpTools: allContributions.filter((entry): entry is McpToolExtensionContribution => entry.kind === 'mcp-tool'),
    };
  }
}

export async function loadExtensions(
  requests: RegisterExtensionRequest[],
  policy: ExtensionRegistryPolicy
): Promise<OperationResult<ExtensionRegistrySnapshot>> {
  const registry = new ExtensionRegistry(policy);
  const diagnostics: Diagnostic[] = [];

  for (const request of requests) {
    const result = await registry.register(request);
    diagnostics.push(...result.diagnostics, ...result.warnings);

    if (!result.success) {
      return fail(diagnostics, {
        supportTier: result.supportTier,
      });
    }
  }

  return ok(registry.snapshot(), {
    supportTier: 'preview',
    diagnostics,
  });
}
