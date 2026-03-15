import {
  AuthService,
  createTokenProvider,
} from '@pp/auth';
import { fail, ok, createDiagnostic, type OperationResult } from '@pp/diagnostics';
import { HttpClient } from '@pp/http';
import {
  discoverProject,
  resolvePowerBiTarget,
  resolveSharePointTarget,
  type ProviderBindingResolverContext,
  type ResolvedPowerBiTarget,
  type ResolvedSharePointTarget,
} from '@pp/project';
import { PowerBiClient } from '@pp/powerbi';
import { SharePointClient } from '@pp/sharepoint';
import {
  argumentFailure,
  outputFormat,
  positionalArgs,
  printByFormat,
  printFailure,
  printResultDiagnostics,
  readConfigOptions,
  readFlag,
  readProjectDiscoveryOptions,
  readPublicClientLoginOptions,
  resolveDefaultInvocationPath,
} from './cli-support';

export async function runSharePointSiteInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(argumentFailure('SHAREPOINT_SITE_REQUIRED', 'Usage: sharepoint site inspect <site|binding> [--project path] [--profile name]'));
  }

  const targetResult = await resolveSharePointTargetForCli(reference, args, {
    expectedKind: 'sharepoint-site',
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createSharePointClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectSite(targetResult.data.site.value);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      site: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runSharePointListInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure('SHAREPOINT_LIST_REQUIRED', 'Usage: sharepoint list inspect <list|binding> --site <site|binding> [--project path] [--profile name]')
    );
  }

  const targetResult = await resolveSharePointTargetForCli(reference, args, {
    expectedKind: 'sharepoint-list',
    site: readFlag(args, '--site'),
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createSharePointClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectList(targetResult.data.site.value, targetResult.data.list?.value ?? reference);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      list: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runSharePointFileInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure(
        'SHAREPOINT_FILE_REQUIRED',
        'Usage: sharepoint file inspect <file|binding> --site <site|binding> [--drive name] [--project path] [--profile name]'
      )
    );
  }

  const targetResult = await resolveSharePointTargetForCli(reference, args, {
    expectedKind: 'sharepoint-file',
    site: readFlag(args, '--site'),
    drive: readFlag(args, '--drive'),
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createSharePointClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectDriveItem(targetResult.data.site.value, targetResult.data.file?.value ?? reference, {
    drive: targetResult.data.drive?.value,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      file: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runSharePointPermissionsInspect(args: string[]): Promise<number> {
  const siteReference = readFlag(args, '--site');

  if (!siteReference) {
    return printFailure(
      argumentFailure(
        'SHAREPOINT_SITE_REQUIRED',
        'Usage: sharepoint permissions inspect --site <site|binding> [--list name|binding] [--file path|binding] [--drive name]'
      )
    );
  }

  const listReference = readFlag(args, '--list');
  const fileReference = readFlag(args, '--file');
  const driveReference = readFlag(args, '--drive');
  const resolutionKind = fileReference ? 'sharepoint-file' : listReference ? 'sharepoint-list' : 'sharepoint-site';

  const targetResult =
    resolutionKind === 'sharepoint-file'
      ? await resolveSharePointTargetForCli(fileReference as string, args, {
          expectedKind: 'sharepoint-file',
          site: siteReference,
          drive: driveReference,
        })
      : resolutionKind === 'sharepoint-list'
        ? await resolveSharePointTargetForCli(listReference as string, args, {
            expectedKind: 'sharepoint-list',
            site: siteReference,
          })
        : await resolveSharePointTargetForCli(siteReference, args, {
            expectedKind: 'sharepoint-site',
          });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createSharePointClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectPermissions(targetResult.data.site.value, {
    list: targetResult.data.list?.value,
    drive: targetResult.data.drive?.value,
    item: targetResult.data.file?.value,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      permissions: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runPowerBiWorkspaceInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure('POWERBI_WORKSPACE_REQUIRED', 'Usage: powerbi workspace inspect <workspace|binding> [--project path] [--profile name]')
    );
  }

  const targetResult = await resolvePowerBiTargetForCli(reference, args, {
    expectedKind: 'powerbi-workspace',
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createPowerBiClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectWorkspace(targetResult.data.workspace.value);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      workspace: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runPowerBiDatasetInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure(
        'POWERBI_DATASET_REQUIRED',
        'Usage: powerbi dataset inspect <dataset|binding> --workspace <workspace|binding> [--project path] [--profile name]'
      )
    );
  }

  const targetResult = await resolvePowerBiTargetForCli(reference, args, {
    expectedKind: 'powerbi-dataset',
    workspace: readFlag(args, '--workspace'),
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createPowerBiClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectDataset(targetResult.data.workspace.value, targetResult.data.dataset?.value ?? reference);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      dataset: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runPowerBiReportInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure(
        'POWERBI_REPORT_REQUIRED',
        'Usage: powerbi report inspect <report|binding> --workspace <workspace|binding> [--project path] [--profile name]'
      )
    );
  }

  const targetResult = await resolvePowerBiTargetForCli(reference, args, {
    expectedKind: 'powerbi-report',
    workspace: readFlag(args, '--workspace'),
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createPowerBiClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectReport(targetResult.data.workspace.value, targetResult.data.report?.value ?? reference);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      report: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function resolveSharePointTargetForCli(
  reference: string,
  args: string[],
  options: {
    expectedKind: 'sharepoint-site' | 'sharepoint-list' | 'sharepoint-file';
    site?: string;
    drive?: string;
  }
): Promise<OperationResult<ResolvedSharePointTarget>> {
  const projectContext = await resolveProviderBindingContext(args);

  if (!projectContext.success || !projectContext.data) {
    return projectContext as unknown as OperationResult<ResolvedSharePointTarget>;
  }

  return resolveSharePointTarget(projectContext.data, reference, options);
}

async function resolvePowerBiTargetForCli(
  reference: string,
  args: string[],
  options: {
    expectedKind: 'powerbi-workspace' | 'powerbi-dataset' | 'powerbi-report';
    workspace?: string;
  }
): Promise<OperationResult<ResolvedPowerBiTarget>> {
  const projectContext = await resolveProviderBindingContext(args);

  if (!projectContext.success || !projectContext.data) {
    return projectContext as unknown as OperationResult<ResolvedPowerBiTarget>;
  }

  return resolvePowerBiTarget(projectContext.data, reference, options);
}

async function resolveProviderBindingContext(args: string[]): Promise<OperationResult<ProviderBindingResolverContext>> {
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return discoveryOptions as unknown as OperationResult<ProviderBindingResolverContext>;
  }

  const projectPath = readFlag(args, '--project') ?? resolveDefaultInvocationPath();
  const projectResult = await discoverProject(projectPath, discoveryOptions.data);

  if (!projectResult.success || !projectResult.data) {
    return projectResult as unknown as OperationResult<ProviderBindingResolverContext>;
  }

  return ok(
    {
      providerBindings: projectResult.data.providerBindings,
    },
    {
      supportTier: projectResult.supportTier,
      diagnostics: projectResult.diagnostics,
      warnings: projectResult.warnings,
    }
  );
}

async function createSharePointClientForCli(
  target: ResolvedSharePointTarget,
  args: string[]
): Promise<OperationResult<SharePointClient>> {
  const authProfileName = readFlag(args, '--profile') ?? target.authProfile;

  if (!authProfileName) {
    return argumentFailure(
      'AUTH_PROFILE_REQUIRED',
      'SharePoint inspection requires an auth profile. Provide `--profile NAME` or set `metadata.authProfile` on the provider binding.'
    );
  }

  const httpClientResult = await createAuthenticatedHttpClientForCli('https://graph.microsoft.com', authProfileName, args);

  if (!httpClientResult.success || !httpClientResult.data) {
    return httpClientResult as unknown as OperationResult<SharePointClient>;
  }

  return ok(new SharePointClient(httpClientResult.data), {
    supportTier: httpClientResult.supportTier,
    diagnostics: httpClientResult.diagnostics,
    warnings: httpClientResult.warnings,
  });
}

async function createPowerBiClientForCli(
  target: ResolvedPowerBiTarget,
  args: string[]
): Promise<OperationResult<PowerBiClient>> {
  const authProfileName = readFlag(args, '--profile') ?? target.authProfile;

  if (!authProfileName) {
    return argumentFailure(
      'AUTH_PROFILE_REQUIRED',
      'Power BI inspection requires an auth profile. Provide `--profile NAME` or set `metadata.authProfile` on the provider binding.'
    );
  }

  const httpClientResult = await createAuthenticatedHttpClientForCli('https://api.powerbi.com', authProfileName, args);

  if (!httpClientResult.success || !httpClientResult.data) {
    return httpClientResult as unknown as OperationResult<PowerBiClient>;
  }

  return ok(new PowerBiClient(httpClientResult.data), {
    supportTier: httpClientResult.supportTier,
    diagnostics: httpClientResult.diagnostics,
    warnings: httpClientResult.warnings,
  });
}

async function createAuthenticatedHttpClientForCli(baseUrl: string, authProfileName: string, args: string[]): Promise<OperationResult<HttpClient>> {
  const auth = new AuthService(readConfigOptions(args));
  const profileResult = await auth.getProfile(authProfileName);

  if (!profileResult.success) {
    return profileResult as unknown as OperationResult<HttpClient>;
  }

  if (!profileResult.data) {
    return fail(
      createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${authProfileName} was not found.`, {
        source: '@pp/cli',
      })
    );
  }

  const tokenProviderResult = createTokenProvider(profileResult.data, readConfigOptions(args), readPublicClientLoginOptions(args));

  if (!tokenProviderResult.success || !tokenProviderResult.data) {
    return tokenProviderResult as unknown as OperationResult<HttpClient>;
  }

  return ok(
    new HttpClient({
      baseUrl,
      tokenProvider: tokenProviderResult.data,
    }),
    {
      supportTier: tokenProviderResult.supportTier,
      diagnostics: [...profileResult.diagnostics, ...tokenProviderResult.diagnostics],
      warnings: [...(profileResult.warnings ?? []), ...(tokenProviderResult.warnings ?? [])],
    }
  );
}
