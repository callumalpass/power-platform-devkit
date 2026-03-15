import { createTokenProvider, type AuthProfile } from '@pp/auth';
import { getEnvironmentAlias, saveEnvironmentAlias, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import { fail, ok, type OperationResult } from '@pp/diagnostics';
import { HttpClient } from '@pp/http';
import { discoverProject } from '@pp/project';
import { resolveDataverseClient, type DataverseClient, type DataverseResolution } from '@pp/dataverse';
import {
  argumentFailure,
  readConfigOptions,
  readFlag,
  readProjectDiscoveryOptions,
  readPublicClientLoginOptions,
  resolveDefaultInvocationPath,
} from './cli-support';

const POWER_PLATFORM_ENVIRONMENTS_API_VERSION = '2020-10-01';

export async function resolveDataverseClientForCli(args: string[]): Promise<OperationResult<DataverseResolution>> {
  return resolveDataverseClientByFlag(args, '--environment');
}

export async function resolveDataverseClientByFlag(args: string[], flag: string): Promise<OperationResult<DataverseResolution>> {
  const environmentAliasResult = await resolveEnvironmentAliasForCli(args, flag);

  if (!environmentAliasResult.success || !environmentAliasResult.data) {
    return environmentAliasResult as unknown as OperationResult<DataverseResolution>;
  }

  return resolveDataverseClient(environmentAliasResult.data, {
    ...readConfigOptions(args),
    publicClientLoginOptions: readPublicClientLoginOptions(args),
  });
}

export async function resolveEnvironmentAliasForCli(args: string[], flag: string): Promise<OperationResult<string>> {
  const explicitEnvironmentAlias = readFlag(args, flag);

  if (explicitEnvironmentAlias) {
    return ok(explicitEnvironmentAlias, {
      supportTier: 'preview',
    });
  }

  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return discoveryOptions as unknown as OperationResult<string>;
  }

  const project = await discoverProject(resolveDefaultInvocationPath(), discoveryOptions.data);

  if (!project.success || !project.data) {
    return project as unknown as OperationResult<string>;
  }

  const errorDiagnostics = project.diagnostics.filter((diagnostic) => diagnostic.level === 'error');

  if (errorDiagnostics.length > 0) {
    return fail(errorDiagnostics, {
      supportTier: project.supportTier,
      warnings: project.warnings,
      details: {
        projectRoot: project.data.root,
        selectedStage: project.data.topology.selectedStage,
        activeEnvironment: project.data.topology.activeEnvironment,
      },
      provenance: project.provenance,
      knownLimitations: project.knownLimitations,
    });
  }

  if (project.data.topology.activeEnvironment) {
    return ok(project.data.topology.activeEnvironment, {
      supportTier: project.supportTier,
      diagnostics: project.diagnostics,
      warnings: project.warnings,
      details: {
        projectRoot: project.data.root,
        selectedStage: project.data.topology.selectedStage,
        source: 'project-topology',
      },
      provenance: project.provenance,
      knownLimitations: project.knownLimitations,
    });
  }

  return argumentFailure('DV_ENV_REQUIRED', `${flag} <alias> is required.`);
}

export function readEnvironmentAlias(args: string[]): string | undefined {
  return readFlag(args, '--environment');
}

export async function resolveCanvasMakerEnvironmentId(
  explicitMakerEnvironmentId: string | undefined,
  environment: EnvironmentAlias,
  authProfile: AuthProfile,
  configOptions: ConfigStoreOptions,
  options: {
    persistDiscovered?: boolean;
  } = {}
): Promise<string | undefined> {
  if (explicitMakerEnvironmentId) {
    return explicitMakerEnvironmentId;
  }

  if (environment.makerEnvironmentId) {
    return environment.makerEnvironmentId;
  }

  const discovered = await discoverMakerEnvironmentIdForEnvironment(environment, authProfile, configOptions);

  if (!discovered.success || !discovered.data) {
    return undefined;
  }

  if (options.persistDiscovered) {
    await saveEnvironmentAlias(
      {
        ...environment,
        makerEnvironmentId: discovered.data,
      },
      configOptions
    );
  }

  return discovered.data;
}

export async function discoverMakerEnvironmentIdForEnvironment(
  environment: EnvironmentAlias,
  authProfile: AuthProfile,
  configOptions: ConfigStoreOptions
): Promise<OperationResult<string | undefined>> {
  const tokenProvider = createTokenProvider(authProfile, configOptions);

  if (!tokenProvider.success || !tokenProvider.data) {
    return tokenProvider as unknown as OperationResult<string | undefined>;
  }

  const response = await new HttpClient({
    baseUrl: 'https://api.bap.microsoft.com/',
    tokenProvider: tokenProvider.data,
  }).requestJson<PowerPlatformEnvironmentListResponse>({
    path: '/providers/Microsoft.BusinessAppPlatform/environments',
    query: {
      'api-version': POWER_PLATFORM_ENVIRONMENTS_API_VERSION,
    },
  });

  if (!response.success) {
    return response as unknown as OperationResult<string | undefined>;
  }

  const environmentUrl = normalizeEnvironmentUrl(environment.url);
  const match = (response.data?.value ?? []).find((candidate) => {
    const instanceApiUrl = normalizeEnvironmentUrl(candidate.properties?.linkedEnvironmentMetadata?.instanceApiUrl);
    const instanceUrl = normalizeEnvironmentUrl(candidate.properties?.linkedEnvironmentMetadata?.instanceUrl);
    return instanceApiUrl === environmentUrl || instanceUrl === environmentUrl;
  });

  return ok(match?.name, {
    supportTier: 'preview',
  });
}

export async function readEnvironmentDefaultSolution(alias: string, configOptions: ConfigStoreOptions): Promise<string | undefined> {
  const environment = await getEnvironmentAlias(alias, configOptions);

  if (!environment.success) {
    return undefined;
  }

  return environment.data?.defaultSolution;
}

export async function resolveSolutionIdForCli(client: DataverseClient, solutionUniqueName: string): Promise<string | undefined> {
  const result = await client.query<{ solutionid?: string; uniquename?: string }>({
    table: 'solutions',
    select: ['solutionid', 'uniquename'],
    filter: `uniquename eq '${solutionUniqueName.replace(/'/g, "''")}'`,
  });

  if (!result.success) {
    return undefined;
  }

  return (result.data ?? []).find((solution) => solution.uniquename === solutionUniqueName)?.solutionid;
}

function normalizeEnvironmentUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return value.replace(/\/+$/, '').toLowerCase();
  }
}

interface PowerPlatformEnvironmentListResponse {
  value?: PowerPlatformEnvironmentRecord[];
}

interface PowerPlatformEnvironmentRecord {
  name?: string;
  properties?: {
    linkedEnvironmentMetadata?: {
      instanceApiUrl?: string;
      instanceUrl?: string;
    };
  };
}
