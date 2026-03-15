import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AuthProfile } from '@pp/auth';
import { type EnvironmentAlias } from '@pp/config';
import { CloudFlowService, ModelDrivenAppService } from '@pp/dataverse';
import { type OperationResult, createDiagnostic, fail, ok } from '@pp/diagnostics';
import { FlowService, type FlowMonitorReport, type FlowPatchDocument, type FlowWorkflowStateLabel } from '@pp/flow';
import { ModelService, type ModelArtifactMutationKind, type ModelInspectResult } from '@pp/model';
import * as cliHelp from './help';
import { dispatchCommandRoute } from './command-dispatch';
import { enforceWriteAccessForCliArgs } from './cli-access';
import { buildPacEnvironmentGuidance } from './environment-commands';
import { readEnvironmentAlias, readEnvironmentDefaultSolution, resolveDataverseClientByFlag, resolveDataverseClientForCli, resolveSolutionIdForCli } from './cli-resolution';
import { createMutationPreview, createSuccessPayload, readMutationFlags } from './contract';
import {
  argumentFailure,
  dedupeStrings,
  hasFlag,
  isMachineReadableOutputFormat,
  isRecord,
  maybeHandleMutationPreview,
  outputFormat,
  positionalArgs,
  printByFormat,
  printFailure,
  printResultDiagnostics,
  readConfigOptions,
  readFlag,
  readJsonFileForCli,
  readStructuredSpecFile,
} from './cli-support';
export async function runFlowList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new FlowService(resolution.data.client).list({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow inspect <name|id|uniqueName|path> [--environment ALIAS]'));
  }

  if (readEnvironmentAlias(args)) {
    const resolution = await resolveDataverseClientForCli(args);

    if (!resolution.success || !resolution.data) {
      return printFailure(resolution);
    }

    const result = await new FlowService(resolution.data.client).inspect(identifier, {
      solutionUniqueName: readFlag(args, '--solution'),
    });

    if (!result.success) {
      return printFailure(result);
    }

    if (!result.data) {
      return printFailure(fail(createDiagnostic('error', 'FLOW_NOT_FOUND', `Flow ${identifier} was not found.`)));
    }

    printByFormat(result.data, outputFormat(args, 'json'));
    return 0;
  }

  const result = await new FlowService().inspectArtifact(identifier);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowAttach(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const solutionUniqueName = readFlag(args, '--solution');

  if (!identifier || !solutionUniqueName) {
    return printFailure(
      argumentFailure(
        'FLOW_ATTACH_ARGS_REQUIRED',
        'Usage: flow attach <name|id|uniqueName> --environment ALIAS --solution UNIQUE_NAME [--no-add-required-components]'
      )
    );
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'flow.attach');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const addRequiredComponents = hasFlag(args, '--no-add-required-components') ? false : true;
  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'flow.attach',
    {
      identifier,
      environment: resolution.data.environment.alias,
      solution: solutionUniqueName,
    },
    {
      addRequiredComponents,
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService(resolution.data.client).attach(identifier, solutionUniqueName, {
    addRequiredComponents,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data, result), outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowAccess(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow access <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new CloudFlowService(resolution.data.client).access(identifier);

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'FLOW_NOT_FOUND', `Flow ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowUnpack(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];
  const outPath = readFlag(args, '--out');

  if (!inputPath || !outPath) {
    return printFailure(argumentFailure('FLOW_UNPACK_ARGS_REQUIRED', 'Usage: flow unpack <path> --out <dir>'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'flow.unpack', { inputPath, outPath });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService().unpack(inputPath, outPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowExport(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const outPath = readFlag(args, '--out');

  if (!identifier || !outPath) {
    return printFailure(
      argumentFailure('FLOW_EXPORT_ARGS_REQUIRED', 'Usage: flow export <name|id|uniqueName> --environment ALIAS --out PATH [--solution UNIQUE_NAME]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'flow.export',
    {
      identifier,
      environment: resolution.data.environment.alias,
      solution: readFlag(args, '--solution'),
      outPath,
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService(resolution.data.client).exportArtifact(identifier, outPath, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowActivate(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure(
        'FLOW_ACTIVATE_ARGS_REQUIRED',
        'Usage: flow activate <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const solutionUniqueName = readFlag(args, '--solution');
  const preview = maybeHandleMutationPreview(args, 'json', 'flow.activate', {
    identifier,
    environment: resolution.data.environment.alias,
    solution: solutionUniqueName,
    target: identifier,
    workflowState: 'activated',
  });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService(resolution.data.client).activate(identifier, {
    solutionUniqueName,
  });

  if (!result.success || !result.data) {
    return printFailure(augmentFlowActivateFailureResult(result, resolution.data.environment, resolution.data.authProfile));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

function augmentFlowActivateFailureResult<T>(
  result: OperationResult<T>,
  environment: EnvironmentAlias,
  authProfile: AuthProfile | undefined
): OperationResult<T> {
  if (!result.diagnostics.some((diagnostic) => diagnostic.code === 'FLOW_ACTIVATE_DEFINITION_REQUIRED')) {
    return result;
  }

  const pacGuidance: Record<string, unknown> = {
    sharesPpAuthContext: false,
    organizationUrl: environment.url,
    verificationCommand: 'pac auth list',
    recommendedAction:
      `Treat pac as a separately authenticated tool. Run \`pac auth list\` and confirm the active profile targets ${environment.url} before using pac as a fallback.`,
    ...(buildPacEnvironmentGuidance(authProfile, environment) ?? {}),
  };
  const pacRecommendedAction =
    typeof pacGuidance.recommendedAction === 'string' ? pacGuidance.recommendedAction : undefined;
  const pacReason = typeof pacGuidance.reason === 'string' ? pacGuidance.reason : undefined;
  const tooling = {
    pac: {
      ...pacGuidance,
      selectedEnvironment: environment.alias,
    },
  };

  return {
    ...result,
    details: isRecord(result.details)
      ? {
          ...result.details,
          tooling,
        }
      : {
          tooling,
        },
    suggestedNextActions: dedupeStrings([
      ...(result.suggestedNextActions ?? []),
      `Run \`pp env inspect ${environment.alias} --format json\` to confirm the selected environment alias, bound auth profile, and pac/tooling guidance before attempting a non-pp fallback.`,
      `Run \`pac auth list\` and confirm the active profile targets ${environment.url} before using pac as a fallback.`,
      pacRecommendedAction,
      pacReason ? `Only fall back to pac after validating that its auth context targets ${environment.url}; current guidance: ${pacReason}` : undefined,
    ]),
  };
}

export async function runFlowPromote(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure(
        'FLOW_PROMOTE_ARGS_REQUIRED',
        'Usage: flow promote <name|id|uniqueName> --source-environment ALIAS --target-environment ALIAS [--source-solution UNIQUE_NAME] [--target-solution UNIQUE_NAME] [--target <name|id|uniqueName>] [--create-if-missing] [--workflow-state draft|activated|suspended] [--solution-package] [--managed-solution-package] [--overwrite-unmanaged-customizations] [--holding-solution] [--skip-product-update-dependencies] [--no-publish-workflows] [--import-job-id GUID]'
      )
    );
  }

  const sourceResolution = await resolveDataverseClientByFlag(args, '--source-environment');

  if (!sourceResolution.success || !sourceResolution.data) {
    return printFailure(sourceResolution);
  }

  const targetResolution = await resolveDataverseClientByFlag(args, '--target-environment');

  if (!targetResolution.success || !targetResolution.data) {
    return printFailure(targetResolution);
  }

  const workflowState = readFlowWorkflowStateFlag(args);

  if (!workflowState.success) {
    return printFailure(workflowState);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'flow.promote',
    {
      identifier,
      sourceEnvironment: sourceResolution.data.environment.alias,
      sourceSolution: readFlag(args, '--source-solution'),
      targetEnvironment: targetResolution.data.environment.alias,
      targetSolution: readFlag(args, '--target-solution'),
      target: readFlag(args, '--target') ?? 'source artifact metadata',
      createIfMissing: hasFlag(args, '--create-if-missing'),
      workflowState: workflowState.data ?? 'source artifact metadata',
      solutionPackage: hasFlag(args, '--solution-package'),
      solutionPackageManaged: hasFlag(args, '--managed-solution-package'),
      publishWorkflows: !hasFlag(args, '--no-publish-workflows'),
      overwriteUnmanagedCustomizations: hasFlag(args, '--overwrite-unmanaged-customizations'),
      holdingSolution: hasFlag(args, '--holding-solution'),
      skipProductUpdateDependencies: hasFlag(args, '--skip-product-update-dependencies'),
      importJobId: readFlag(args, '--import-job-id'),
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService(sourceResolution.data.client).promoteArtifact(identifier, {
    sourceSolutionUniqueName: readFlag(args, '--source-solution'),
    targetSolutionUniqueName: readFlag(args, '--target-solution'),
    target: readFlag(args, '--target'),
    createIfMissing: hasFlag(args, '--create-if-missing'),
    workflowState: workflowState.data,
    solutionPackage: hasFlag(args, '--solution-package'),
    solutionPackageManaged: hasFlag(args, '--managed-solution-package'),
    publishWorkflows: hasFlag(args, '--no-publish-workflows') ? false : undefined,
    overwriteUnmanagedCustomizations: hasFlag(args, '--overwrite-unmanaged-customizations') ? true : undefined,
    holdingSolution: hasFlag(args, '--holding-solution') ? true : undefined,
    skipProductUpdateDependencies: hasFlag(args, '--skip-product-update-dependencies') ? true : undefined,
    importJobId: readFlag(args, '--import-job-id'),
    targetDataverseClient: targetResolution.data.client,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowPack(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];
  const outPath = readFlag(args, '--out');

  if (!inputPath || !outPath) {
    return printFailure(argumentFailure('FLOW_PACK_ARGS_REQUIRED', 'Usage: flow pack <path> --out <file.json>'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'flow.pack', { inputPath, outPath });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService().pack(inputPath, outPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowDeploy(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    return printFailure(
      argumentFailure(
        'FLOW_DEPLOY_ARGS_REQUIRED',
        'Usage: flow deploy <path> --environment ALIAS [--solution UNIQUE_NAME] [--target <name|id|uniqueName>] [--create-if-missing] [--workflow-state draft|activated|suspended]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const workflowState = readFlowWorkflowStateFlag(args);

  if (!workflowState.success) {
    return printFailure(workflowState);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'flow.deploy',
    {
      inputPath,
      environment: resolution.data.environment.alias,
      solution: readFlag(args, '--solution'),
      target: readFlag(args, '--target') ?? 'artifact metadata',
      createIfMissing: hasFlag(args, '--create-if-missing'),
      workflowState: workflowState.data ?? 'artifact metadata',
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService(resolution.data.client).deployArtifact(inputPath, {
    solutionUniqueName: readFlag(args, '--solution'),
    target: readFlag(args, '--target'),
    createIfMissing: hasFlag(args, '--create-if-missing'),
    workflowState: workflowState.data,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowNormalize(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    return printFailure(argumentFailure('FLOW_NORMALIZE_PATH_REQUIRED', 'Usage: flow normalize <path> [--out PATH]'));
  }

  const outPath = readFlag(args, '--out');
  const preview = maybeHandleMutationPreview(args, 'json', 'flow.normalize', {
    inputPath,
    outPath: outPath ?? 'in-place',
  });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService().normalize(inputPath, outPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowValidate(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    return printFailure(argumentFailure('FLOW_VALIDATE_PATH_REQUIRED', 'Usage: flow validate <path>'));
  }

  const format = outputFormat(args, 'json');
  const result = await new FlowService().validate(inputPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  if (isMachineReadableOutputFormat(format)) {
    printByFormat(createSuccessPayload(result.data, result), format);
  } else {
    printByFormat(result.data, format);
    printResultDiagnostics(result, format);
  }

  return result.data.valid ? 0 : 1;
}

export async function runFlowGraph(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    return printFailure(argumentFailure('FLOW_GRAPH_PATH_REQUIRED', 'Usage: flow graph <path>'));
  }

  const result = await new FlowService().graphArtifact(inputPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowPatch(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];
  const patchFile = readFlag(args, '--file');

  if (!inputPath || !patchFile) {
    return printFailure(argumentFailure('FLOW_PATCH_ARGS_REQUIRED', 'Usage: flow patch <path> --file PATCH.json [--out PATH]'));
  }

  const patch = await readJsonFileForCli(patchFile, 'FLOW_PATCH_FILE_INVALID', '--file must point to a JSON patch document.');

  if (!patch.success || patch.data === undefined) {
    return printFailure(patch);
  }

  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return printFailure(mutation);
  }

  const requestedOutPath = readFlag(args, '--out') ?? 'in-place';

  if (mutation.data.mode !== 'apply') {
    const previewOutRoot = await mkdtemp(join(tmpdir(), 'pp-flow-patch-preview-'));

    try {
      const analysis = await new FlowService().patch(inputPath, patch.data as FlowPatchDocument, previewOutRoot);

      if (!analysis.success || !analysis.data) {
        return printFailure(analysis);
      }

      printByFormat(
        createMutationPreview(
          'flow.patch',
          mutation.data,
          { inputPath, patchFile, outPath: requestedOutPath },
          patch.data,
          analysis,
          {
            validation: {
              patchAccepted: true,
              operationCount: analysis.data.appliedOperations.length,
            },
            analysis: {
              changed: analysis.data.changed,
              appliedOperations: analysis.data.appliedOperations,
              summary: analysis.data.summary,
            },
          }
        ),
        outputFormat(args, 'json')
      );
      return 0;
    } finally {
      await rm(previewOutRoot, { recursive: true, force: true });
    }
  }

  const result = await new FlowService().patch(inputPath, patch.data as FlowPatchDocument, readFlag(args, '--out'));

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowRuns(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow runs <name|id|uniqueName> --environment ALIAS [--status STATUS] [--since 7d]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new FlowService(resolution.data.client).runs(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    status: readFlag(args, '--status'),
    since: readFlag(args, '--since'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data ?? [], result, { dataKey: 'runs' }), outputFormat(args, 'json'));
  return 0;
}

export async function runFlowMonitor(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow monitor <name|id|uniqueName> --environment ALIAS [--since 7d]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const baseline = await readFlowMonitorBaselineForCli(readFlag(args, '--baseline'));

  if (!baseline.success) {
    return printFailure(baseline);
  }

  const result = await new FlowService(resolution.data.client).monitor(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    since: readFlag(args, '--since'),
    baseline: baseline.data,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data, result), outputFormat(args, 'json'));
  return 0;
}

export async function runFlowErrors(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure(
        'FLOW_IDENTIFIER_REQUIRED',
        'Usage: flow errors <name|id|uniqueName> --environment ALIAS [--group-by errorCode|errorMessage|connectionReference]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const groupBy = readFlag(args, '--group-by') as 'errorCode' | 'errorMessage' | 'connectionReference' | undefined;

  if (groupBy && !['errorCode', 'errorMessage', 'connectionReference'].includes(groupBy)) {
    return printFailure(argumentFailure('FLOW_GROUP_BY_INVALID', 'Use --group-by errorCode, errorMessage, or connectionReference.'));
  }

  const result = await new FlowService(resolution.data.client).errors(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    since: readFlag(args, '--since'),
    status: readFlag(args, '--status'),
    groupBy,
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

export async function runFlowConnrefs(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow connrefs <name|id|uniqueName> --environment ALIAS [--since 7d]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new FlowService(resolution.data.client).connrefs(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    since: readFlag(args, '--since'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'FLOW_NOT_FOUND', `Flow ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runFlowDoctor(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow doctor <name|id|uniqueName> --environment ALIAS [--since 7d]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new FlowService(resolution.data.client).doctor(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    since: readFlag(args, '--since'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data, result), outputFormat(args, 'json'));
  return 0;
}

export async function runModelList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).list({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

export async function runModelCreate(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];
  const environmentAlias = readFlag(args, '--environment');
  const configOptions = readConfigOptions(args);

  if (!uniqueName) {
    return printFailure(
      argumentFailure(
        'MODEL_UNIQUENAME_REQUIRED',
        'Usage: model create <uniqueName> --environment ALIAS [--name DISPLAY_NAME] [--solution UNIQUE_NAME]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const displayName = readFlag(args, '--name');
  const explicitSolutionUniqueName = readFlag(args, '--solution');
  const defaultSolutionUniqueName =
    !explicitSolutionUniqueName && environmentAlias ? await readEnvironmentDefaultSolution(environmentAlias, configOptions) : undefined;
  const solutionUniqueName = explicitSolutionUniqueName ?? defaultSolutionUniqueName;
  const preview = maybeHandleMutationPreview(args, 'json', 'model.create', {
    uniqueName,
    environment: resolution.data.environment.alias,
    solution: solutionUniqueName,
  }, {
    name: displayName ?? uniqueName,
  });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new ModelService(resolution.data.client).create(uniqueName, {
    name: displayName,
    solutionUniqueName: solutionUniqueName,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const solutionId = solutionUniqueName ? await resolveSolutionIdForCli(resolution.data.client, solutionUniqueName) : undefined;

  printByFormat(
    buildModelRemotePayload({
      app: result.data,
      envAlias: resolution.data.environment.alias,
      solutionUniqueName,
      solutionId,
      makerEnvironmentId: resolution.data.environment.makerEnvironmentId,
    }),
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runModelAttach(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const environmentAlias = readFlag(args, '--environment');
  const configOptions = readConfigOptions(args);
  const explicitSolutionUniqueName = readFlag(args, '--solution');
  const defaultSolutionUniqueName =
    !explicitSolutionUniqueName && environmentAlias ? await readEnvironmentDefaultSolution(environmentAlias, configOptions) : undefined;
  const solutionUniqueName = explicitSolutionUniqueName ?? defaultSolutionUniqueName;

  if (!identifier || !solutionUniqueName) {
    return printFailure(
      argumentFailure(
        'MODEL_ATTACH_ARGS_REQUIRED',
        'Usage: model attach <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const addRequiredComponents = hasFlag(args, '--no-add-required-components') ? false : true;
  const preview = maybeHandleMutationPreview(args, 'json', 'model.attach', {
    identifier,
    environment: resolution.data.environment.alias,
    solution: solutionUniqueName,
  }, {
    addRequiredComponents,
  });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new ModelService(resolution.data.client).attach(identifier, {
    solutionUniqueName,
    addRequiredComponents,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const solutionId = solutionUniqueName ? await resolveSolutionIdForCli(resolution.data.client, solutionUniqueName) : undefined;

  printByFormat(
    compactObject({
      ...result.data,
      app: buildModelRemotePayload({
        app: result.data.app,
        envAlias: resolution.data.environment.alias,
        solutionUniqueName,
        solutionId,
        makerEnvironmentId: resolution.data.environment.makerEnvironmentId,
      }),
    }),
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runModelInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model inspect <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  const solutionUniqueName = readFlag(args, '--solution');
  const solutionId = solutionUniqueName ? await resolveSolutionIdForCli(resolution.data.client, solutionUniqueName) : undefined;

  printByFormat(
    buildModelInspectPayload({
      result: result.data,
      envAlias: resolution.data.environment.alias,
      solutionUniqueName,
      solutionId,
      makerEnvironmentId: resolution.data.environment.makerEnvironmentId,
    }),
    outputFormat(args, 'json')
  );
  return 0;
}

export async function runModelAccess(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model access <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelDrivenAppService(resolution.data.client).access(identifier);

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  const solutionUniqueName = readFlag(args, '--solution');
  const solutionId = solutionUniqueName ? await resolveSolutionIdForCli(resolution.data.client, solutionUniqueName) : undefined;

  printByFormat(
    compactObject({
      ...result.data,
      portalProvenance: buildModelPortalProvenance({
        makerEnvironmentId: resolution.data.environment.makerEnvironmentId,
        solutionUniqueName,
        solutionId,
      }),
      handoff: {
        makerSolutionApps: compactObject({
          recommendedUrl: buildModelPortalProvenance({
            makerEnvironmentId: resolution.data.environment.makerEnvironmentId,
            solutionUniqueName,
            solutionId,
          })?.solutionAppsUrl,
          inspectCommand: `pp model inspect ${formatCliArg(identifier)} --environment ${formatCliArg(resolution.data.environment.alias)}${solutionUniqueName ? ` --solution ${formatCliArg(solutionUniqueName)}` : ''}`,
        }),
      },
    }),
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runModelSitemap(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model sitemap <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  const modelResult: OperationResult<ModelInspectResult> = { ...result, data: result.data };
  printByFormat(buildModelArtifactProjectionReport(modelResult, result.data, 'sitemap'), outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runModelForms(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model forms <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  const modelResult: OperationResult<ModelInspectResult> = { ...result, data: result.data };
  printByFormat(buildModelArtifactProjectionReport(modelResult, result.data, 'form'), outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runModelViews(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model views <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  const modelResult: OperationResult<ModelInspectResult> = { ...result, data: result.data };
  printByFormat(buildModelArtifactProjectionReport(modelResult, result.data, 'view'), outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runModelDependencies(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model dependencies <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  const modelResult: OperationResult<ModelInspectResult> = { ...result, data: result.data };
  printByFormat(buildModelArtifactProjectionReport(modelResult, result.data, 'dependency'), outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runModelComposition(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model composition <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).composition(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runModelImpact(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const targetKind = readModelTargetKind(args);
  const targetIdentifier = readFlag(args, '--target');

  if (!identifier || !targetKind || !targetIdentifier) {
    return printFailure(
      argumentFailure(
        'MODEL_IMPACT_ARGS_REQUIRED',
        'Usage: model impact <name|id|uniqueName> --environment ALIAS --kind app|form|view|sitemap --target <name|id>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).impact(
    identifier,
    {
      kind: targetKind,
      identifier: targetIdentifier,
    },
    {
      solutionUniqueName: readFlag(args, '--solution'),
    }
  );

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(
      fail(createDiagnostic('error', 'MODEL_IMPACT_TARGET_NOT_FOUND', `Target ${targetKind}:${targetIdentifier} was not found in ${identifier}.`))
    );
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runModelPatch(args: string[]): Promise<number> {
  return dispatchCommandRoute(
    {
      help: cliHelp.printHelp,
      unknownExitCode: 1,
      children: [{ name: 'plan', run: (rest) => runModelPatchPlan(rest) }],
    },
    args
  );
}

export async function runModelPatchPlan(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const targetKind = readModelTargetKind(args);
  const targetIdentifier = readFlag(args, '--target');
  const rename = readFlag(args, '--rename');

  if (!identifier || !targetKind || !targetIdentifier || !rename) {
    return printFailure(
      argumentFailure(
        'MODEL_PATCH_PLAN_ARGS_REQUIRED',
        'Usage: model patch plan <name|id|uniqueName> --environment ALIAS --kind app|form|view|sitemap --target <name|id> --rename <newName>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).planMutation(
    identifier,
    {
      operation: 'rename',
      target: {
        kind: targetKind,
        identifier: targetIdentifier,
      },
      value: {
        name: rename,
      },
    },
    {
      solutionUniqueName: readFlag(args, '--solution'),
    }
  );

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return result.data.valid ? 0 : 1;
}

function readModelTargetKind(args: string[]): ModelArtifactMutationKind | undefined {
  const kind = readFlag(args, '--kind');

  if (kind === 'app' || kind === 'form' || kind === 'view' || kind === 'sitemap') {
    return kind;
  }

  return undefined;
}

function readFlowWorkflowStateFlag(args: string[]): OperationResult<FlowWorkflowStateLabel | undefined> {
  const value = readFlag(args, '--workflow-state');

  if (!value) {
    return ok(undefined, {
      supportTier: 'preview',
    });
  }

  if (value === 'draft' || value === 'activated' || value === 'suspended') {
    return ok(value, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('FLOW_WORKFLOW_STATE_INVALID', 'Use --workflow-state draft, activated, or suspended.');
}

async function readFlowMonitorBaselineForCli(path: string | undefined): Promise<OperationResult<FlowMonitorReport | undefined>> {
  if (!path) {
    return ok(undefined, {
      supportTier: 'preview',
    });
  }

  const loaded = await readJsonFileForCli(path, 'FLOW_MONITOR_BASELINE_INVALID', 'Failed to parse flow monitor baseline JSON.');

  if (!loaded.success) {
    return loaded as OperationResult<FlowMonitorReport | undefined>;
  }

  const report = unwrapFlowMonitorBaseline(loaded.data);

  if (!report) {
    return fail(
      createDiagnostic(
        'error',
        'FLOW_MONITOR_BASELINE_SHAPE_INVALID',
        'Flow monitor baseline must be a prior `pp flow monitor --format json` payload or its top-level report object.',
        {
          source: '@pp/cli',
          path,
        }
      )
    );
  }

  return ok(report, {
    supportTier: 'preview',
  });
}

function unwrapFlowMonitorBaseline(value: unknown): FlowMonitorReport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  if (isFlowMonitorReport(value)) {
    return value;
  }

  const candidate = (value as { data?: unknown }).data;
  return isFlowMonitorReport(candidate) ? candidate : undefined;
}

function isFlowMonitorReport(value: unknown): value is FlowMonitorReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const report = value as Partial<FlowMonitorReport>;
  return (
    typeof report.checkedAt === 'string' &&
    Boolean(report.health) &&
    typeof report.health?.status === 'string' &&
    typeof report.health?.telemetryState === 'string' &&
    Boolean(report.recentRuns) &&
    typeof report.recentRuns?.total === 'number' &&
    typeof report.recentRuns?.failed === 'number' &&
    Array.isArray(report.errorGroups) &&
    Array.isArray(report.findings)
  );
}

function formatCliArg(value: string): string {
  return /^[A-Za-z0-9._:/=-]+$/.test(value) ? value : JSON.stringify(value);
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function buildModelRemotePayload(input: {
  app: Awaited<ReturnType<ModelService['list']>> extends OperationResult<(infer T)[]> ? T : never;
  envAlias: string;
  solutionUniqueName?: string;
  solutionId?: string;
  makerEnvironmentId?: string;
}) {
  const portalProvenance = buildModelPortalProvenance({
    makerEnvironmentId: input.makerEnvironmentId,
    solutionUniqueName: input.solutionUniqueName,
    solutionId: input.solutionId,
  });

  return compactObject({
    ...input.app,
    portalProvenance,
    handoff: {
      makerSolutionApps: compactObject({
        recommendedUrl: portalProvenance?.solutionAppsUrl,
        inspectCommand: `pp model inspect ${formatCliArg(input.app.name ?? input.app.uniqueName ?? input.app.id)} --environment ${formatCliArg(input.envAlias)}${input.solutionUniqueName ? ` --solution ${formatCliArg(input.solutionUniqueName)}` : ''}`,
        accessCommand: `pp model access ${formatCliArg(input.app.name ?? input.app.uniqueName ?? input.app.id)} --environment ${formatCliArg(input.envAlias)} --format json`,
      }),
    },
  });
}

function buildModelInspectPayload(input: {
  result: Awaited<ReturnType<ModelService['inspect']>> extends OperationResult<infer T> ? NonNullable<T> : never;
  envAlias: string;
  solutionUniqueName?: string;
  solutionId?: string;
  makerEnvironmentId?: string;
}) {
  return compactObject({
    ...input.result,
    app: buildModelRemotePayload({
      app: input.result.app,
      envAlias: input.envAlias,
      solutionUniqueName: input.solutionUniqueName,
      solutionId: input.solutionId,
      makerEnvironmentId: input.makerEnvironmentId,
    }),
  });
}

function buildModelPortalProvenance(input: {
  makerEnvironmentId?: string;
  solutionUniqueName?: string;
  solutionId?: string;
}) {
  const makerUrls = buildMakerModelUrls(input);

  return compactObject({
    makerEnvironmentId: input.makerEnvironmentId,
    solutionUniqueName: input.solutionUniqueName,
    solutionsUrl: makerUrls.solutionsUrl,
    solutionAppsUrl: makerUrls.solutionAppsUrl,
    sources: compactObject({
      makerEnvironmentId: input.makerEnvironmentId ? 'config.environment.makerEnvironmentId' : undefined,
      solutionAppsUrl:
        input.makerEnvironmentId && input.solutionId ? 'synthesized-from-maker-environment-id-and-solution-id' : undefined,
    }),
  });
}

function buildMakerModelUrls(context: {
  makerEnvironmentId?: string;
  solutionId?: string;
}): {
  solutionsUrl?: string;
  solutionAppsUrl?: string;
} {
  if (!context.makerEnvironmentId) {
    return {};
  }

  const solutionsUrl = `https://make.powerapps.com/environments/${encodeURIComponent(context.makerEnvironmentId)}/solutions`;

  if (!context.solutionId) {
    return { solutionsUrl };
  }

  return {
    solutionsUrl,
    solutionAppsUrl: `${solutionsUrl}/${encodeURIComponent(context.solutionId)}/apps`,
  };
}

function buildModelArtifactProjectionReport(
  result: OperationResult<ModelInspectResult>,
  inspect: ModelInspectResult,
  artifactKind: 'sitemap' | 'form' | 'view' | 'dependency'
): Record<string, unknown> {
  const items =
    artifactKind === 'sitemap'
      ? inspect.sitemaps
      : artifactKind === 'form'
        ? inspect.forms
        : artifactKind === 'view'
          ? inspect.views
          : inspect.dependencies;
  const omissionReason = result.warnings.find((warning) => warning.code === 'MODEL_COMPONENTS_UNAVAILABLE');
  const inferredReason = result.warnings.find((warning) => warning.code === 'MODEL_COMPONENTS_INFERRED_FROM_DEPENDENCIES');

  return compactObject({
    app: inspect.app,
    items,
    summary: {
      artifactKind,
      count: items.length,
      componentCount: inspect.dependencies.length,
      missingComponentCount: inspect.missingComponents.length,
    },
    coverage: compactObject({
      componentMembershipSource: inferredReason ? 'dependencies' : 'appmodulecomponents',
      componentInspectionAvailable: omissionReason === undefined || inferredReason !== undefined,
      omissionReason: omissionReason?.message,
      inferredReason: inferredReason?.message,
    }),
  });
}

export async function runFlowLsp(_args: string[]): Promise<number> {
  const { startFlowLanguageServer } = await import('@pp/flow-language-server');
  await startFlowLanguageServer();
  return 0;
}
