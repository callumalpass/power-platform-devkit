import type { Dirent } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { stableStringify } from '@pp/artifacts';
import { extractCanvasMsappArchive } from '@pp/canvas';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { SolutionService, type SolutionAnalysis } from '@pp/solution';
import type { CliOutputFormat } from './contract';

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

interface SolutionUnpackCanvasExtraction {
  msappPath: string;
  extractedPath: string;
  extractedEntries: string[];
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

  deps.printByFormat(result.data ?? [], deps.outputFormat(args, 'json'));
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
  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
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
    return deps.printFailure(fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`)));
  }

  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
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

  const result = await new SolutionService(resolution.data.client as never).publish(uniqueName, {
    waitForExport,
    timeoutMs: timeoutMs.data,
    pollIntervalMs: pollIntervalMs.data,
    exportOptions: waitForExport
      ? {
          managed: args.includes('--managed'),
          outPath: outputTarget.outPath,
          outDir: outputTarget.outDir,
          manifestPath: deps.readFlag(args, '--manifest'),
        }
      : undefined,
  });

  if (!result.success) {
    return deps.printFailure(result);
  }

  deps.printWarnings(result);
  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
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

  const sourceAnalysis = await resolveSolutionCompareAnalysis(args, 'source', sourceInput.data, uniqueName, deps);

  if (!sourceAnalysis.success || !sourceAnalysis.data) {
    return deps.printFailure(sourceAnalysis);
  }

  const targetAnalysis = await resolveSolutionCompareAnalysis(args, 'target', targetInput.data, uniqueName, deps);

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

export async function runSolutionPackCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const sourceFolder = deps.positionalArgs(args)[0];
  if (!sourceFolder) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_PACK_ARGS_REQUIRED', 'Usage: solution pack <folder> --out <file.zip> [--package-type managed|unmanaged|both] [--pac PATH]'));
  }
  const outPath = deps.readFlag(args, '--out');
  if (!outPath) {
    return deps.printFailure(deps.argumentFailure('SOLUTION_PACK_OUT_REQUIRED', '--out <file.zip> is required.'));
  }
  const packageType = deps.readSolutionPackageTypeFlag(args);
  if (!packageType.success || !packageType.data) {
    return deps.printFailure(packageType);
  }
  const preview = deps.maybeHandleMutationPreview(args, 'json', 'solution.pack', { sourceFolder, outPath, packageType: packageType.data });
  if (preview !== undefined) {
    return preview;
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
  deps.printWarnings(result);
  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
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
  const packageType = deps.readSolutionPackageTypeFlag(args);
  if (!packageType.success || !packageType.data) {
    return deps.printFailure(packageType);
  }
  const preview = deps.maybeHandleMutationPreview(args, 'json', 'solution.unpack', { packagePath, outDir, packageType: packageType.data });
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

async function extractCanvasAppsFromUnpackedSolution(unpackedRoot: string): Promise<OperationResult<SolutionUnpackCanvasExtraction[]>> {
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
  deps: Pick<SolutionCommandDependencies, 'argumentFailure' | 'resolveDataverseClientByFlag' | 'readFlag'>
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

    const analysis = await new SolutionService(resolution.data.client as never).analyze(uniqueName);

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
