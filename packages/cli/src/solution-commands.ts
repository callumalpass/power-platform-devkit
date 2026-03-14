import type { Dirent } from 'node:fs';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { stableStringify } from '@pp/artifacts';
import { buildCanvasApp, extractCanvasMsappArchive } from '@pp/canvas';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult, type ProvenanceRecord } from '@pp/diagnostics';
import {
  SolutionService,
  type SolutionAnalysis,
  type SolutionPackageMetadata,
  type SolutionPublishProgressEvent,
  type SolutionSummary,
  type SolutionSyncStatusProgressEvent,
} from '@pp/solution';
import { createMutationPreview, createSuccessPayload, readMutationFlags, type CliOutputFormat } from './contract';

type OutputFormat = CliOutputFormat;
type SolutionCompareInputKind = 'environment' | 'zip' | 'folder';

interface SolutionCompareInput {
  kind: SolutionCompareInputKind;
  value: string;
}

interface ResolutionData {
  environment: {
    alias: string;
    url?: string;
  };
  client: unknown;
}

export interface SolutionUnpackCanvasExtraction {
  msappPath: string;
  extractedPath: string;
  extractedEntries: string[];
}

interface SolutionPackCanvasRebuild {
  extractedPath: string;
  msappPath: string;
  packageHash?: string;
  outFileSha256?: string;
  templateHash?: string;
  sourceHash?: string;
  mode?: string;
  supported?: boolean;
}

interface SolutionCheckpointDocument {
  schemaVersion: 1;
  kind: 'pp-solution-checkpoint';
  generatedAt: string;
  environment: {
    alias: string;
    url?: string;
    pacOrganizationUrl?: string;
  };
  solution: {
    uniqueName: string;
    packageType: 'managed' | 'unmanaged';
    export: unknown;
    manifestPath?: string;
    rollbackCandidateVersion?: string;
  };
  inspection: {
    solution: unknown;
    components: unknown[];
    componentCount: number;
  };
}

interface SolutionCommandDependencies {
  positionalArgs(args: string[]): string[];
  readFlag(args: string[], name: string): string | undefined;
  outputFormat(args: string[], fallback: OutputFormat): OutputFormat;
  printFailure(result: OperationResult<unknown>): number;
  printByFormat(value: unknown, format: OutputFormat): void;
  printWarnings(result: OperationResult<unknown>): void;
  maybeHandleMutationPreview(
    args: string[],
    fallbackFormat: OutputFormat,
    action: string,
    target: Record<string, unknown>,
    input?: unknown
  ): number | undefined;
  resolveDataverseClientForCli(args: string[]): Promise<OperationResult<ResolutionData>>;
  resolveDataverseClientByFlag?(args: string[], flag: string): Promise<OperationResult<ResolutionData>>;
  readSolutionOutputTarget(out: string | undefined): { outPath?: string; outDir?: string };
  readSolutionPackageTypeFlag(args: string[]): OperationResult<'managed' | 'unmanaged' | 'both'>;
  createLocalSolutionService(): SolutionService;
  argumentFailure(code: string, message: string): OperationResult<never>;
}

export async function runSolutionListCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client as never);
  const result = await service.list({
    uniqueName: deps.readFlag(args, '--unique-name'),
    prefix: deps.readFlag(args, '--prefix'),
  });

  if (!result.success) {
    return deps.printFailure(result);
  }

  deps.printByFormat(createSuccessPayload(result.data ?? [], result, { dataKey: 'solutions' }), deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionPublishersCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client as never);
  const result = await service.listPublishers();

  if (!result.success) {
    return deps.printFailure(result);
  }

  deps.printByFormat(createSuccessPayload(result.data ?? [], result, { dataKey: 'publishers' }), deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionCreateCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_CREATE_ARGS_REQUIRED',
        'Usage: solution create <uniqueName> --environment <alias> [--friendly-name NAME] [--version X.Y.Z.W] [--description TEXT] (--publisher-id GUID | --publisher-unique-name NAME)'
      )
    );
  }

  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client as never);
  const result = await service.create(uniqueName, {
    friendlyName: deps.readFlag(args, '--friendly-name'),
    version: deps.readFlag(args, '--version'),
    description: deps.readFlag(args, '--description'),
    publisherId: deps.readFlag(args, '--publisher-id'),
    publisherUniqueName: deps.readFlag(args, '--publisher-unique-name'),
  });

  if (!result.success) {
    return deps.printFailure(result);
  }

  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionDeleteCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_DELETE_ARGS_REQUIRED', 'Usage: solution delete <uniqueName> --environment <alias>'));
  }

  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client as never);
  const solution = await service.inspect(uniqueName);
  if (!solution.success) {
    return deps.printFailure(solution);
  }
  if (!solution.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`)));
  }

  const preview = deps.maybeHandleMutationPreview(
    args,
    'json',
    'solution.delete',
    {
      environment: resolution.data.environment.alias,
      uniqueName,
      solutionId: solution.data.solutionid,
    },
    solution.data
  );
  if (preview !== undefined) {
    return preview;
  }

  const result = await service.delete(uniqueName);
  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  deps.printWarnings(result);
  deps.printByFormat(
    {
      ...result.data,
      verification: {
        inspectCommand: `pp solution inspect ${uniqueName} --environment ${resolution.data.environment.alias} --format json`,
        absentSignal: 'SOLUTION_NOT_FOUND',
        detail:
          'Managed uninstall can continue server-side after delete acceptance. Re-run the inspect command until it returns SOLUTION_NOT_FOUND when you need an authoritative completion check.',
      },
    },
    deps.outputFormat(args, 'json')
  );
  return 0;
}

export async function runSolutionInspectCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }

  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const result = await new SolutionService(resolution.data.client as never).inspect(uniqueName);
  if (!result.success) {
    return deps.printFailure(result);
  }
  if (!result.data) {
    return deps.printFailure(
      fail(
        [...result.diagnostics, createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`)],
        {
          supportTier: result.supportTier,
          warnings: result.warnings,
          suggestedNextActions: [
            `Run \`pp solution list --environment ${resolution.data.environment.alias} --format json\` to confirm the available solution unique names.`,
            `Run \`pp env inspect ${resolution.data.environment.alias} --format json\` to confirm the target environment alias before retrying.`,
          ],
        }
      )
    );
  }

  deps.printByFormat(createSuccessPayload(result.data, result), deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionSetMetadataCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_SET_METADATA_ARGS_REQUIRED',
        'Usage: solution set-metadata <uniqueName> --environment <alias> [--version X.Y.Z.W] [--publisher-id GUID | --publisher-unique-name NAME]'
      )
    );
  }

  const version = deps.readFlag(args, '--version');
  const publisherId = deps.readFlag(args, '--publisher-id');
  const publisherUniqueName = deps.readFlag(args, '--publisher-unique-name');
  if (!version && !publisherId && !publisherUniqueName) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_METADATA_UPDATE_REQUIRED',
        'Use --version, --publisher-id, or --publisher-unique-name when updating solution metadata.'
      )
    );
  }

  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const result = await new SolutionService(resolution.data.client as never).setMetadata(uniqueName, {
    version,
    publisherId,
    publisherUniqueName,
  });

  if (!result.success) {
    return deps.printFailure(result);
  }

  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionPublishCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_PUBLISH_ARGS_REQUIRED',
        'Usage: solution publish <uniqueName> --environment <alias> [--wait-for-export] [--timeout-ms N] [--poll-interval-ms N] [--managed] [--out PATH] [--manifest FILE]'
      )
    );
  }

  const waitForExport = args.includes('--wait-for-export');
  const timeoutMs = readOptionalPositiveIntegerFlag(args, '--timeout-ms', deps);
  if (!timeoutMs.success) {
    return deps.printFailure(timeoutMs);
  }
  const pollIntervalMs = readOptionalPositiveIntegerFlag(args, '--poll-interval-ms', deps);
  if (!pollIntervalMs.success) {
    return deps.printFailure(pollIntervalMs);
  }

  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const outputTarget = deps.readSolutionOutputTarget(deps.readFlag(args, '--out'));
  const preview = deps.maybeHandleMutationPreview(args, 'json', 'solution.publish', {
    environment: resolution.data.environment.alias,
    uniqueName,
    waitForExport,
    ...(timeoutMs.data !== undefined ? { timeoutMs: timeoutMs.data } : {}),
    ...(pollIntervalMs.data !== undefined ? { pollIntervalMs: pollIntervalMs.data } : {}),
    managed: args.includes('--managed'),
    ...(outputTarget.outPath ? { outPath: outputTarget.outPath } : {}),
    ...(outputTarget.outDir ? { outDir: outputTarget.outDir } : {}),
  });
  if (preview !== undefined) {
    return preview;
  }

  const progress: SolutionPublishProgressEvent[] = [];
  const result = await new SolutionService(resolution.data.client as never).publish(uniqueName, {
    waitForExport,
    timeoutMs: timeoutMs.data,
    pollIntervalMs: pollIntervalMs.data,
    onProgress: waitForExport
      ? (event) => {
          progress.push(event);
          process.stderr.write(renderSolutionPublishProgress(uniqueName, event));
        }
      : undefined,
    exportOptions: {
      managed: args.includes('--managed'),
      outPath: outputTarget.outPath,
      outDir: outputTarget.outDir,
      manifestPath: deps.readFlag(args, '--manifest'),
    },
  });

  if (!result.success) {
    return deps.printFailure(attachStructuredFailureProgress(result, progress));
  }

  deps.printWarnings(result);
  deps.printByFormat(attachStructuredSuccessProgress(result.data, progress), deps.outputFormat(args, 'json'));
  return 0;
}

function renderSolutionPublishProgress(uniqueName: string, event: SolutionPublishProgressEvent): string {
  if (event.stage === 'accepted') {
    return `Waiting for publish checkpoint: solution ${uniqueName} accepted PublishAllXml; polling for export readiness for up to ${event.timeoutMs ?? 0}ms.\n`;
  }

  if (event.stage === 'polling') {
    const parts = [
      `Waiting for publish checkpoint: attempt ${event.attempt ?? 0}, elapsed ${event.elapsedMs ?? 0}ms, remaining ${event.remainingMs ?? 0}ms.`,
    ];
    if (event.latestExportDiagnostic) {
      parts.push(`Latest export diagnostic ${event.latestExportDiagnostic.code}: ${event.latestExportDiagnostic.message}.`);
    }
    if (event.readBack) {
      const canvasSummary = event.readBack.canvasApps
        .map((app) => `${app.name ?? app.logicalName ?? app.id}=lastPublishTime:${app.lastPublishTime ?? 'unknown'}`)
        .join(', ');
      const workflowSummary = event.readBack.workflows
        .map((workflow) => `${workflow.name ?? workflow.logicalName ?? workflow.id}=${workflow.workflowState ?? 'unknown'}`)
        .join(', ');
      const modelSummary = event.readBack.modelDrivenApps
        .map((app) => `${app.name ?? app.uniqueName ?? app.id}=publishedOn:${app.publishedOn ?? 'unknown'}`)
        .join(', ');
      if (canvasSummary) {
        parts.push(`Observed canvas apps: ${canvasSummary}.`);
      }
      if (workflowSummary) {
        parts.push(`Observed workflows: ${workflowSummary}.`);
      }
      if (modelSummary) {
        parts.push(`Observed model apps: ${modelSummary}.`);
      }
    }
    return `${parts.join(' ')}\n`;
  }

  return `Publish checkpoint confirmed for solution ${uniqueName} after ${event.elapsedMs ?? 0}ms on attempt ${event.attempt ?? 0}.\n`;
}

export async function runSolutionSyncStatusCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_SYNC_STATUS_ARGS_REQUIRED',
        'Usage: solution sync-status <uniqueName> --environment <alias> [--skip-export-check] [--timeout-ms N] [--managed] [--out PATH] [--manifest FILE]'
      )
    );
  }
  const timeoutMs = readOptionalPositiveIntegerFlag(args, '--timeout-ms', deps);
  if (!timeoutMs.success) {
    return deps.printFailure(timeoutMs);
  }

  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const outputTarget = deps.readSolutionOutputTarget(deps.readFlag(args, '--out'));
  const progress: SolutionSyncStatusProgressEvent[] = [];
  const result = await new SolutionService(resolution.data.client as never).syncStatus(uniqueName, {
    includeExportCheck: !args.includes('--skip-export-check'),
    requestTimeoutMs: timeoutMs.data,
    managed: args.includes('--managed'),
    outPath: outputTarget.outPath,
    outDir: outputTarget.outDir,
    manifestPath: deps.readFlag(args, '--manifest'),
    onProgress: (event) => {
      progress.push(event);
      process.stderr.write(renderSolutionSyncStatusProgress(uniqueName, event));
    },
  });

  if (!result.success) {
    return deps.printFailure(attachStructuredFailureProgress(result, progress));
  }

  deps.printWarnings(result);
  deps.printByFormat(attachStructuredSuccessProgress(result.data, progress), deps.outputFormat(args, 'json'));
  return 0;
}

function renderSolutionSyncStatusProgress(uniqueName: string, event: SolutionSyncStatusProgressEvent): string {
  if (event.stage === 'readback-complete') {
    const workflowSummary =
      event.readBack?.workflows.map((workflow) => `${workflow.name ?? workflow.logicalName ?? workflow.id}=${workflow.workflowState ?? 'unknown'}`).join(', ') ??
      '';
    return `Inspecting solution sync status: captured publish readback for ${uniqueName} in ${event.elapsedMs ?? 0}ms.${workflowSummary ? ` Workflows: ${workflowSummary}.` : ''}\n`;
  }

  if (event.stage === 'export-check-started') {
    return `Inspecting solution sync status: starting ${event.packageType ?? 'unmanaged'} export probe for ${uniqueName}; waiting for Dataverse export readiness.\n`;
  }

  const parts = [
    `Inspecting solution sync status: ${event.exportConfirmed ? 'export probe confirmed readiness' : 'export probe still failed'} for ${uniqueName} after ${event.elapsedMs ?? 0}ms.`,
  ];
  if (event.latestExportDiagnostic) {
    parts.push(`Latest export diagnostic ${event.latestExportDiagnostic.code}: ${event.latestExportDiagnostic.message}.`);
  }
  return `${parts.join(' ')}\n`;
}

function attachStructuredSuccessProgress<T>(data: T, progress: ReadonlyArray<unknown>): T {
  if (progress.length === 0 || !data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  return {
    ...(data as Record<string, unknown>),
    progress,
  } as T;
}

function attachStructuredFailureProgress<T>(result: OperationResult<T>, progress: ReadonlyArray<unknown>): OperationResult<T> {
  if (progress.length === 0) {
    return result;
  }

  const details =
    result.details && typeof result.details === 'object' && !Array.isArray(result.details)
      ? {
          ...(result.details as Record<string, unknown>),
          progress,
        }
      : { progress };

  return {
    ...result,
    details,
  };
}

export async function runSolutionComponentsCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }
  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }
  const result = await new SolutionService(resolution.data.client as never).components(uniqueName);
  if (!result.success) {
    return deps.printFailure(result);
  }
  deps.printByFormat(result.data ?? [], deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionDependenciesCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }
  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }
  const result = await new SolutionService(resolution.data.client as never).dependencies(uniqueName);
  if (!result.success) {
    return deps.printFailure(result);
  }
  deps.printByFormat(result.data ?? [], deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionAnalyzeCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }
  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }
  const result = await new SolutionService(resolution.data.client as never).analyze(uniqueName);
  if (!result.success) {
    return deps.printFailure(result);
  }
  if (!result.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`)));
  }
  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionCompareCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  const includeModelComposition = args.includes('--include-model-composition');
  const sourceInput = readSolutionCompareInput(args, 'source', deps);

  if (!sourceInput.success || !sourceInput.data) {
    return deps.printFailure(sourceInput);
  }

  const targetInput = readSolutionCompareInput(args, 'target', deps);

  if (!targetInput.success || !targetInput.data) {
    return deps.printFailure(targetInput);
  }

  if ((sourceInput.data.kind === 'environment' || targetInput.data.kind === 'environment') && !uniqueName) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_UNIQUE_NAME_REQUIRED',
        'Solution unique name is required when either compare side targets an environment.'
      )
    );
  }

  const sourceAnalysis = await resolveSolutionCompareAnalysis(
    args,
    'source',
    sourceInput.data,
    uniqueName,
    deps,
    includeModelComposition
  );

  if (!sourceAnalysis.success || !sourceAnalysis.data) {
    return deps.printFailure(sourceAnalysis);
  }

  const targetAnalysis = await resolveSolutionCompareAnalysis(
    args,
    'target',
    targetInput.data,
    uniqueName,
    deps,
    includeModelComposition
  );

  if (!targetAnalysis.success || !targetAnalysis.data) {
    return deps.printFailure(targetAnalysis);
  }

  const compareUniqueName =
    uniqueName ?? sourceAnalysis.data.solution.uniquename ?? targetAnalysis.data.solution.uniquename ?? 'local-solution';
  const service = createLocalSolutionService();
  const result = service.compareLocal(compareUniqueName, sourceAnalysis.data, targetAnalysis.data);

  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionExportCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_EXPORT_ARGS_REQUIRED',
        'Usage: solution export <uniqueName> --environment <alias> [--out PATH] [--managed] [--manifest FILE]'
      )
    );
  }
  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }
  const outputTarget = deps.readSolutionOutputTarget(deps.readFlag(args, '--out'));
  const preview = deps.maybeHandleMutationPreview(args, 'json', 'solution.export', {
    environment: resolution.data.environment.alias,
    uniqueName,
    ...(outputTarget.outPath ? { outPath: outputTarget.outPath } : {}),
    ...(outputTarget.outDir ? { outDir: outputTarget.outDir } : {}),
    managed: args.includes('--managed'),
  });
  if (preview !== undefined) {
    return preview;
  }
  const result = await new SolutionService(resolution.data.client as never).exportSolution(uniqueName, {
    managed: args.includes('--managed'),
    outPath: outputTarget.outPath,
    outDir: outputTarget.outDir,
    manifestPath: deps.readFlag(args, '--manifest'),
  });
  if (!result.success) {
    return deps.printFailure(result);
  }
  deps.printWarnings(result);
  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
}

export async function runSolutionCheckpointCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const uniqueName = deps.positionalArgs(args)[0];
  if (!uniqueName) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_CHECKPOINT_ARGS_REQUIRED',
        'Usage: solution checkpoint <uniqueName> --environment <alias> [--out PATH] [--managed] [--manifest FILE] [--checkpoint FILE]'
      )
    );
  }

  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const outputTarget = deps.readSolutionOutputTarget(deps.readFlag(args, '--out'));
  const packageType = args.includes('--managed') ? 'managed' : 'unmanaged';
  const preview = deps.maybeHandleMutationPreview(args, 'json', 'solution.checkpoint', {
    environment: resolution.data.environment.alias,
    uniqueName,
    packageType,
    ...(outputTarget.outPath ? { outPath: outputTarget.outPath } : {}),
    ...(outputTarget.outDir ? { outDir: outputTarget.outDir } : {}),
  });
  if (preview !== undefined) {
    return preview;
  }

  const service = new SolutionService(resolution.data.client as never);
  const exported = await service.exportSolution(uniqueName, {
    managed: args.includes('--managed'),
    outPath: outputTarget.outPath,
    outDir: outputTarget.outDir,
    manifestPath: deps.readFlag(args, '--manifest'),
  });
  if (!exported.success || !exported.data) {
    return deps.printFailure(exported);
  }

  const components = await service.components(uniqueName);
  if (!components.success || !components.data) {
    return deps.printFailure(components);
  }

  const checkpointDocument: SolutionCheckpointDocument = {
    schemaVersion: 1,
    kind: 'pp-solution-checkpoint',
    generatedAt: new Date().toISOString(),
    environment: {
      alias: resolution.data.environment.alias,
      url: resolution.data.environment.url,
      pacOrganizationUrl: derivePacOrganizationUrl(resolution.data.environment.url),
    },
    solution: {
      uniqueName,
      packageType,
      export: exported.data,
      manifestPath: exported.data.manifestPath,
      rollbackCandidateVersion: exported.data.manifest?.recovery?.rollbackCandidateVersion ?? exported.data.solution.version,
    },
    inspection: {
      solution: exported.data.solution,
      components: components.data,
      componentCount: components.data.length,
    },
  };

  const checkpointPath = resolveSolutionCheckpointPath(exported.data.artifact.path, deps.readFlag(args, '--checkpoint'));
  await writeFile(checkpointPath, stableStringify(checkpointDocument as unknown as Parameters<typeof stableStringify>[0]) + '\n', 'utf8');

  deps.printWarnings(exported);
  deps.printWarnings(components);
  deps.printByFormat(
    {
      ...checkpointDocument,
      checkpointPath,
    },
    deps.outputFormat(args, 'json')
  );
  return 0;
}

export async function runSolutionImportCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const packagePath = deps.positionalArgs(args)[0];
  if (!packagePath) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_IMPORT_ARGS_REQUIRED',
        'Usage: solution import <path.zip> --environment <alias> [--overwrite-unmanaged-customizations] [--holding-solution] [--skip-product-update-dependencies] [--no-publish-workflows]'
      )
    );
  }
  const resolution = await deps.resolveDataverseClientForCli(args);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }
  const mutation = readMutationFlags(args);
  if (!mutation.success || !mutation.data) {
    return deps.printFailure(mutation);
  }
  if (mutation.data.plan) {
    const preview = await buildSolutionImportPlanPreview(packagePath, args, resolution.data.environment.alias, resolution.data.client as never, deps);
    if (!preview.success || !preview.data) {
      return deps.printFailure(preview);
    }
    deps.printByFormat(preview.data, deps.outputFormat(args, 'json'));
    return 0;
  }
  const preview = deps.maybeHandleMutationPreview(args, 'json', 'solution.import', {
    environment: resolution.data.environment.alias,
    packagePath,
  });
  if (preview !== undefined) {
    return preview;
  }
  const result = await new SolutionService(resolution.data.client as never).importSolution(packagePath, {
    publishWorkflows: !args.includes('--no-publish-workflows'),
    overwriteUnmanagedCustomizations: args.includes('--overwrite-unmanaged-customizations'),
    holdingSolution: args.includes('--holding-solution'),
    skipProductUpdateDependencies: args.includes('--skip-product-update-dependencies'),
    importJobId: deps.readFlag(args, '--import-job-id'),
  });
  if (!result.success) {
    return deps.printFailure(result);
  }
  deps.printWarnings(result);
  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
}

type SolutionImportPlanStatus =
  | 'package-metadata-missing'
  | 'target-absent'
  | 'same-version-managed-installed'
  | 'managed-upgrade-candidate'
  | 'managed-version-downgrade'
  | 'managed-over-unmanaged-installed'
  | 'unmanaged-update-candidate'
  | 'unmanaged-over-managed-installed'
  | 'target-version-unknown';

interface SolutionImportPlanCompatibility {
  status: SolutionImportPlanStatus;
  summary: string;
  sameVersion?: boolean;
  versionComparison?: 'older' | 'equal' | 'newer' | 'unknown';
  recommendedWorkflow: 'direct-import' | 'holding-upgrade' | 'review-target-first';
}

interface SolutionImportPlanPackageInfo extends SolutionPackageMetadata {
  available: boolean;
}

async function buildSolutionImportPlanPreview(
  packagePath: string,
  args: string[],
  environmentAlias: string,
  client: unknown,
  deps: SolutionCommandDependencies
): Promise<OperationResult<Record<string, unknown>>> {
  const resolvedPackagePath = resolve(packagePath);
  const importOptions = {
    publishWorkflows: !args.includes('--no-publish-workflows'),
    overwriteUnmanagedCustomizations: args.includes('--overwrite-unmanaged-customizations'),
    holdingSolution: args.includes('--holding-solution'),
    skipProductUpdateDependencies: args.includes('--skip-product-update-dependencies'),
    importJobId: deps.readFlag(args, '--import-job-id'),
  };
  const manifestPath = resolveAdjacentSolutionManifestPath(resolvedPackagePath);
  const packageMetadata = await deps.createLocalSolutionService().inspectPackageMetadata(resolvedPackagePath);

  if (!packageMetadata.success) {
    return packageMetadata as unknown as OperationResult<Record<string, unknown>>;
  }

  const targetSolutionUniqueName = packageMetadata.data?.uniqueName;
  let targetState: Record<string, unknown> | undefined;
  let compatibility: SolutionImportPlanCompatibility;
  const suggestedNextActions: string[] = [];
  const provenance: ProvenanceRecord[] = [];
  const knownLimitations = [
    'Import planning uses solution package metadata plus a live target solution inspect; it does not run server-side dependency or upgrade simulation.',
  ];

  if (packageMetadata.data) {
    provenance.push(
      packageMetadata.data.source === 'manifest'
        ? { kind: 'official-artifact', source: 'pp solution release manifest' }
        : { kind: 'official-artifact', source: 'solution package metadata' }
    );
    suggestedNextActions.push(
      `Run \`pp solution inspect ${packageMetadata.data.uniqueName} --environment ${environmentAlias} --format json\` to re-check live target state immediately before applying the import.`
    );
    if (packageMetadata.data.source === 'archive') {
      knownLimitations.push('Archive-derived plan metadata comes from solution.xml/Other.xml and may omit friendly name or other release-manifest-only provenance.');
    }
  }

  if (!packageMetadata.data?.uniqueName || !packageMetadata.data.packageType) {
    compatibility = {
      status: 'package-metadata-missing',
      summary:
        'The solution package did not expose enough metadata for plan mode to identify the solution unique name and package type.',
      recommendedWorkflow: 'review-target-first',
    };
    suggestedNextActions.push(
      'Export or pack the solution with `pp` first so the package includes readable solution metadata or an adjacent `.pp-solution.json` release manifest for plan mode.',
      `Re-run \`pp solution import ${resolvedPackagePath} --environment ${environmentAlias} --plan --format json\` after the package metadata is available.`
    );
  } else {
    const packageInfo: SolutionImportPlanPackageInfo = {
      ...packageMetadata.data,
      available: true,
    };
    const inspect = await new SolutionService(client as never).inspect(packageInfo.uniqueName!);
    if (!inspect.success) {
      return inspect as unknown as OperationResult<Record<string, unknown>>;
    }

    provenance.push({ kind: 'official-api', source: 'Dataverse solution inspect' });
    targetState = inspect.data
      ? {
          found: true,
          uniqueName: inspect.data.uniquename,
          version: inspect.data.version,
          isManaged: inspect.data.ismanaged ?? false,
        }
      : {
          found: false,
          uniqueName: packageInfo.uniqueName,
        };
    compatibility = classifySolutionImportCompatibility(packageInfo, inspect.data);
    suggestedNextActions.push(...suggestedActionsForSolutionImportPlan(packageInfo, environmentAlias, compatibility));
  }

  const payload = createMutationPreview(
    'solution.import',
    mutationPlanFlags(),
    {
      environment: environmentAlias,
      packagePath: resolvedPackagePath,
      ...(targetSolutionUniqueName ? { solutionUniqueName: targetSolutionUniqueName } : {}),
    },
    {
      importOptions,
      package: packageMetadata.data
        ? {
            manifestPath: packageMetadata.data.manifestPath ?? manifestPath,
            available: true,
            metadataSource: packageMetadata.data.source,
            uniqueName: packageMetadata.data.uniqueName,
            friendlyName: packageMetadata.data.friendlyName,
            version: packageMetadata.data.version,
            packageType: packageMetadata.data.packageType,
          }
        : {
            manifestPath,
            available: false,
          },
    },
    {
      supportTier: 'preview',
      suggestedNextActions: uniqueStrings(suggestedNextActions),
      provenance,
      knownLimitations,
    }
  ) as Record<string, unknown>;
  payload.analysis = {
    compatibility,
    ...(targetState ? { targetState } : {}),
  };

  return ok(payload, {
    supportTier: 'preview',
  });
}

function classifySolutionImportCompatibility(
  packageInfo: Pick<SolutionImportPlanPackageInfo, 'uniqueName' | 'version' | 'packageType'>,
  targetSolution: Pick<SolutionSummary, 'uniquename' | 'version' | 'ismanaged'> | undefined
): SolutionImportPlanCompatibility {
  if (!targetSolution) {
    return {
      status: 'target-absent',
      summary: `Target environment does not currently have ${packageInfo.uniqueName} installed, so this import would behave like a new ${packageInfo.packageType} install.`,
      recommendedWorkflow: 'direct-import',
    };
  }

  const packageType = packageInfo.packageType!;
  const targetManaged = targetSolution.ismanaged ?? false;
  const versionComparison = compareSolutionVersions(packageInfo.version, targetSolution.version);
  const sameVersion = versionComparison === 'equal';

  if (packageType === 'managed' && targetManaged) {
    if (sameVersion) {
      return {
        status: 'same-version-managed-installed',
        sameVersion: true,
        versionComparison,
        summary: `Target already has managed ${packageInfo.uniqueName} at the same version (${targetSolution.version ?? 'unknown'}), so plan mode cannot prove whether re-import would no-op, reinstall, or require a staged upgrade path.`,
        recommendedWorkflow: 'review-target-first',
      };
    }
    if (versionComparison === 'older' || versionComparison === 'unknown') {
      return {
        status: versionComparison === 'older' ? 'managed-upgrade-candidate' : 'target-version-unknown',
        sameVersion: false,
        versionComparison,
        summary:
          versionComparison === 'older'
            ? `Target already has managed ${packageInfo.uniqueName} at ${targetSolution.version}; importing ${packageInfo.version ?? 'the package'} looks like an upgrade candidate.`
            : `Target already has managed ${packageInfo.uniqueName}, but one side has no comparable version, so pp cannot prove whether a staged upgrade path is required.`,
        recommendedWorkflow: versionComparison === 'older' ? 'holding-upgrade' : 'review-target-first',
      };
    }
    return {
      status: 'managed-version-downgrade',
      sameVersion: false,
      versionComparison,
      summary: `Target already has managed ${packageInfo.uniqueName} at ${targetSolution.version}, which is newer than the package version ${packageInfo.version ?? 'unknown'}.`,
      recommendedWorkflow: 'review-target-first',
    };
  }

  if (packageType === 'managed' && !targetManaged) {
    return {
      status: 'managed-over-unmanaged-installed',
      sameVersion,
      versionComparison,
      summary: `Target currently has unmanaged ${packageInfo.uniqueName}, so importing a managed package over it is not a standard in-place promotion path.`,
      recommendedWorkflow: 'review-target-first',
    };
  }

  if (packageType === 'unmanaged' && targetManaged) {
    return {
      status: 'unmanaged-over-managed-installed',
      sameVersion,
      versionComparison,
      summary: `Target currently has managed ${packageInfo.uniqueName}, so importing an unmanaged package over it is likely the wrong ALM path.`,
      recommendedWorkflow: 'review-target-first',
    };
  }

  return {
    status: versionComparison === 'unknown' ? 'target-version-unknown' : 'unmanaged-update-candidate',
    sameVersion,
    versionComparison,
    summary:
      versionComparison === 'unknown'
        ? `Target already has unmanaged ${packageInfo.uniqueName}, but one side has no comparable version metadata.`
        : `Target already has unmanaged ${packageInfo.uniqueName}; this looks like a standard unmanaged update path.`,
    recommendedWorkflow: 'direct-import',
  };
}

function suggestedActionsForSolutionImportPlan(
  packageInfo: Pick<SolutionImportPlanPackageInfo, 'uniqueName'>,
  environmentAlias: string,
  compatibility: SolutionImportPlanCompatibility
): string[] {
  const inspectCommand = `pp solution inspect ${packageInfo.uniqueName} --environment ${environmentAlias} --format json`;
  switch (compatibility.status) {
    case 'target-absent':
    case 'unmanaged-update-candidate':
      return [
        `Apply the import when ready with \`pp solution import <path.zip> --environment ${environmentAlias} --format json\`.`,
        `Keep ${inspectCommand} handy for the post-import state check.`,
      ];
    case 'managed-upgrade-candidate':
      return [
        `For a staged managed upgrade, start with \`pp solution import <path.zip> --environment ${environmentAlias} --holding-solution --format json\`.`,
        `After the holding import, use the platform upgrade path to complete the promotion and then re-run ${inspectCommand}.`,
      ];
    case 'same-version-managed-installed':
      return [
        `${inspectCommand} confirms the current managed target version before you decide whether to skip, bump the version, or use a staged upgrade path.`,
        `If you intentionally need a staged retry, start from \`pp solution import <path.zip> --environment ${environmentAlias} --holding-solution --format json\` once the package version is clearly newer.`,
        'If the package is meant to supersede the installed build, export or pack a new versioned artifact first so the plan no longer looks like a same-version re-import.',
      ];
    case 'managed-over-unmanaged-installed':
    case 'unmanaged-over-managed-installed':
    case 'managed-version-downgrade':
    case 'target-version-unknown':
    case 'package-metadata-missing':
    default:
      return [
        `${inspectCommand} is the first check to confirm the live target before attempting a risky import path.`,
        'Review the package provenance and target ALM state before applying the import.',
      ];
  }
}

function compareSolutionVersions(
  sourceVersion: string | undefined,
  targetVersion: string | undefined
): 'older' | 'equal' | 'newer' | 'unknown' {
  if (!sourceVersion || !targetVersion) {
    return 'unknown';
  }

  const source = sourceVersion.split('.').map((segment) => Number(segment));
  const target = targetVersion.split('.').map((segment) => Number(segment));
  const width = Math.max(source.length, target.length);

  for (let index = 0; index < width; index += 1) {
    const left = source[index] ?? 0;
    const right = target[index] ?? 0;
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return 'unknown';
    }
    if (left > right) {
      return 'older';
    }
    if (left < right) {
      return 'newer';
    }
  }

  return 'equal';
}

function resolveAdjacentSolutionManifestPath(packagePath: string): string {
  return extname(packagePath).toLowerCase() === '.zip' ? packagePath.replace(/\.zip$/i, '.pp-solution.json') : `${packagePath}.pp-solution.json`;
}

function mutationPlanFlags(): { mode: 'plan'; dryRun: false; plan: true; yes: false } {
  return {
    mode: 'plan',
    dryRun: false,
    plan: true,
    yes: false,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function runSolutionPackCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const sourceFolder = deps.positionalArgs(args)[0];
  if (!sourceFolder) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_PACK_ARGS_REQUIRED',
        'Usage: solution pack <folder> --out <file.zip> [--package-type managed|unmanaged|both] [--rebuild-canvas-apps] [--pac PATH]'
      )
    );
  }
  const outPath = deps.readFlag(args, '--out');
  if (!outPath) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_PACK_OUT_REQUIRED', '--out <file.zip> is required.'));
  }
  const packageType = deps.readSolutionPackageTypeFlag(args);
  if (!packageType.success) {
    return deps.printFailure(packageType);
  }
  const preview = deps.maybeHandleMutationPreview(args, 'json', 'solution.pack', { sourceFolder, outPath, packageType: packageType.data });
  if (preview !== undefined) {
    return preview;
  }
  const rebuiltCanvasApps = args.includes('--rebuild-canvas-apps')
    ? await rebuildCanvasAppsForSolutionPack(resolve(sourceFolder))
    : undefined;
  if (rebuiltCanvasApps && !rebuiltCanvasApps.success) {
    return deps.printFailure(rebuiltCanvasApps);
  }
  const result = await deps.createLocalSolutionService().pack(sourceFolder, {
    outPath,
    packageType: packageType.data,
    pacExecutable: deps.readFlag(args, '--pac'),
    mapFile: deps.readFlag(args, '--map'),
  });
  if (!result.success) {
    return deps.printFailure(result);
  }
  if (rebuiltCanvasApps) {
    deps.printWarnings(rebuiltCanvasApps);
  }
  deps.printWarnings(result);
  deps.printByFormat(
    rebuiltCanvasApps?.data ? { ...result.data, rebuiltCanvasApps: rebuiltCanvasApps.data } : result.data,
    deps.outputFormat(args, 'json')
  );
  return 0;
}

async function rebuildCanvasAppsForSolutionPack(sourceFolder: string): Promise<OperationResult<SolutionPackCanvasRebuild[]>> {
  const canvasAppsDir = join(sourceFolder, 'CanvasApps');
  let entries: Dirent[];

  try {
    entries = await readdir(canvasAppsDir, { encoding: 'utf8', withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok([], {
        supportTier: 'preview',
      });
    }

    return fail(
      createDiagnostic('error', 'SOLUTION_PACK_CANVAS_SCAN_FAILED', `Failed to enumerate extracted canvas apps under ${canvasAppsDir}.`, {
        source: '@pp/cli',
        hint: error instanceof Error ? error.message : undefined,
      }),
      {
        supportTier: 'preview',
      }
    );
  }

  const extractedDirs = entries.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name));
  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const rebuilt: SolutionPackCanvasRebuild[] = [];

  for (const entry of extractedDirs) {
    const extractedPath = join(canvasAppsDir, entry.name);
    const msappPath = join(canvasAppsDir, `${entry.name}.msapp`);
    await rm(msappPath, { force: true }).catch(() => undefined);
    const result = await buildCanvasApp(extractedPath, {
      outPath: msappPath,
    });

    if (!result.success || !result.data) {
      return result as unknown as OperationResult<SolutionPackCanvasRebuild[]>;
    }

    diagnostics.push(...result.diagnostics);
    warnings.push(...result.warnings);
    rebuilt.push({
      extractedPath,
      msappPath,
      packageHash: result.data.packageHash,
      outFileSha256: result.data.outFileSha256,
      templateHash: result.data.templateHash,
      sourceHash: result.data.sourceHash,
      mode: result.data.mode,
      supported: result.data.supported,
    });
  }

  return ok(rebuilt, {
    supportTier: 'preview',
    diagnostics,
    warnings,
  });
}

function readOptionalPositiveIntegerFlag(
  args: string[],
  flagName: string,
  deps: Pick<SolutionCommandDependencies, 'readFlag' | 'argumentFailure'>
): OperationResult<number | undefined> {
  const raw = deps.readFlag(args, flagName);
  if (raw === undefined) {
    return ok(undefined);
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return deps.argumentFailure('SOLUTION_PUBLISH_FLAG_INVALID', `${flagName} must be a positive integer.`);
  }

  return ok(parsed);
}

export async function runSolutionUnpackCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const packagePath = deps.positionalArgs(args)[0];
  if (!packagePath) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_UNPACK_ARGS_REQUIRED',
        'Usage: solution unpack <path.zip> --out <dir> [--package-type managed|unmanaged|both] [--allow-delete] [--extract-canvas-apps] [--pac PATH]'
      )
    );
  }
  const outDir = deps.readFlag(args, '--out');
  if (!outDir) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_UNPACK_OUT_REQUIRED', '--out <dir> is required.'));
  }
  const packageType = readOptionalSolutionPackageTypeFlag(args, deps);
  if (!packageType.success) {
    return deps.printFailure(packageType);
  }
  const preview = deps.maybeHandleMutationPreview(
    args,
    'json',
    'solution.unpack',
    packageType.data ? { packagePath, outDir, packageType: packageType.data } : { packagePath, outDir, packageType: 'auto' }
  );
  if (preview !== undefined) {
    return preview;
  }
  const result = await deps.createLocalSolutionService().unpack(packagePath, {
    outDir,
    packageType: packageType.data,
    allowDelete: args.includes('--allow-delete'),
    pacExecutable: deps.readFlag(args, '--pac'),
    mapFile: deps.readFlag(args, '--map'),
  });
  if (!result.success) {
    return deps.printFailure(result);
  }
  const extractedCanvasApps = args.includes('--extract-canvas-apps')
    ? await extractCanvasAppsFromUnpackedSolution(resolve(outDir))
    : undefined;

  if (extractedCanvasApps && !extractedCanvasApps.success) {
    return deps.printFailure(extractedCanvasApps);
  }

  deps.printWarnings(result);
  deps.printByFormat(
    extractedCanvasApps?.data ? { ...result.data, extractedCanvasApps: extractedCanvasApps.data } : result.data,
    deps.outputFormat(args, 'json')
  );
  return 0;
}

function readOptionalSolutionPackageTypeFlag(
  args: string[],
  deps: Pick<SolutionCommandDependencies, 'readFlag' | 'argumentFailure'>
): OperationResult<'managed' | 'unmanaged' | 'both' | undefined> {
  const value = deps.readFlag(args, '--package-type');

  if (value === undefined) {
    return ok(undefined, {
      supportTier: 'preview',
    });
  }

  if (value === 'managed' || value === 'unmanaged' || value === 'both') {
    return ok(value, {
      supportTier: 'preview',
    });
  }

  return deps.argumentFailure('SOLUTION_PACKAGE_TYPE_INVALID', 'Use --package-type managed, unmanaged, or both.');
}

export async function extractCanvasAppsFromUnpackedSolution(
  unpackedRoot: string
): Promise<OperationResult<SolutionUnpackCanvasExtraction[]>> {
  const canvasAppsDir = join(unpackedRoot, 'CanvasApps');
  let entries: Dirent[];

  try {
    entries = await readdir(canvasAppsDir, { encoding: 'utf8', withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok([], {
        supportTier: 'preview',
      });
    }

    return fail(
      createDiagnostic('error', 'SOLUTION_UNPACK_CANVAS_SCAN_FAILED', `Failed to enumerate canvas apps under ${canvasAppsDir}.`, {
        source: '@pp/cli',
        hint: error instanceof Error ? error.message : undefined,
      }),
      {
        supportTier: 'preview',
      }
    );
  }

  const msappPaths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.msapp'))
    .map((entry) => join(canvasAppsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const extracted: SolutionUnpackCanvasExtraction[] = [];

  for (const msappPath of msappPaths) {
    const extractedPath = join(canvasAppsDir, basename(msappPath, extname(msappPath)));
    const result = await extractCanvasMsappArchive(msappPath, extractedPath);

    if (!result.success || !result.data) {
      return result as unknown as OperationResult<SolutionUnpackCanvasExtraction[]>;
    }

    extracted.push({
      msappPath,
      extractedPath: result.data.outPath,
      extractedEntries: result.data.entries,
    });
  }

  return ok(extracted, {
    supportTier: 'preview',
  });
}

function resolveSolutionCheckpointPath(packagePath: string, explicitPath: string | undefined): string {
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const extension = extname(packagePath);
  const base = extension ? packagePath.slice(0, -extension.length) : packagePath;
  return resolve(dirname(packagePath), `${basename(base)}.pp-checkpoint.json`);
}

function derivePacOrganizationUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('.api.')) {
      parsed.hostname = parsed.hostname.replace('.api.', '.');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function readSolutionCompareInput(
  args: string[],
  side: 'source' | 'target',
  deps: Pick<SolutionCommandDependencies, 'readFlag' | 'argumentFailure'>
): OperationResult<SolutionCompareInput> {
  const options = [
    {
      kind: 'environment' as const,
      value: deps.readFlag(args, `--${side}-env`),
    },
    {
      kind: 'zip' as const,
      value: deps.readFlag(args, `--${side}-zip`),
    },
    {
      kind: 'folder' as const,
      value: deps.readFlag(args, `--${side}-folder`),
    },
  ].filter((option): option is SolutionCompareInput => Boolean(option.value));

  if (options.length !== 1) {
    return deps.argumentFailure(
      'SOLUTION_COMPARE_INPUT_INVALID',
      `Provide exactly one of --${side}-env, --${side}-zip, or --${side}-folder.`
    );
  }

  return ok(options[0]!, {
    supportTier: 'preview',
  });
}

async function resolveSolutionCompareAnalysis(
  args: string[],
  side: 'source' | 'target',
  input: SolutionCompareInput,
  uniqueName: string | undefined,
  deps: Pick<SolutionCommandDependencies, 'argumentFailure' | 'resolveDataverseClientByFlag' | 'readFlag'>,
  includeModelComposition: boolean
): Promise<OperationResult<SolutionAnalysis>> {
  if (input.kind === 'environment') {
    if (!uniqueName) {
      return deps.argumentFailure(
        'SOLUTION_UNIQUE_NAME_REQUIRED',
        'Solution unique name is required when comparing against an environment.'
      ) as OperationResult<SolutionAnalysis>;
    }

    const resolveByFlag = deps.resolveDataverseClientByFlag;

    if (!resolveByFlag) {
      return deps.argumentFailure(
        'SOLUTION_COMPARE_RESOLUTION_UNAVAILABLE',
        'Environment-based solution compare resolution is unavailable in this CLI context.'
      ) as OperationResult<SolutionAnalysis>;
    }

    const resolution = await resolveByFlag(args, `--${side}-env`);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<SolutionAnalysis>;
    }

    const analysis = await new SolutionService(resolution.data.client as never).analyze(uniqueName, {
      includeModelComposition,
    });

    if (!analysis.success) {
      return analysis as OperationResult<SolutionAnalysis>;
    }

    if (!analysis.data) {
      return fail(
        [
          ...analysis.diagnostics,
          createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found in environment ${input.value}.`, {
            source: '@pp/cli',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: analysis.warnings,
        }
      ) as OperationResult<SolutionAnalysis>;
    }

    return ok(analysis.data, {
      supportTier: 'preview',
      diagnostics: analysis.diagnostics,
      warnings: analysis.warnings,
    });
  }

  const service = createLocalSolutionService();
  return input.kind === 'zip'
    ? service.analyzeArtifact({
        packagePath: input.value,
        pacExecutable: deps.readFlag(args, '--pac'),
      })
    : service.analyzeArtifact({
        unpackedPath: input.value,
      });
}

export function createLocalSolutionService(): SolutionService {
  return new SolutionService(new NullDataverseClient() as never);
}

class NullDataverseClient {
  query(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse reads.');
  }

  queryAll(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse reads.');
  }

  invokeAction(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse writes.');
  }

  invokeFunction(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse reads.');
  }

  executeBatch(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse writes.');
  }

  request(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse requests.');
  }

  requestJson(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse requests.');
  }
}
