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
  };
  client: unknown;
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

export async function runSolutionUnpackCommand(args: string[], deps: SolutionCommandDependencies): Promise<number> {
  const packagePath = deps.positionalArgs(args)[0];
  if (!packagePath) {
    return deps.printFailure(
      deps.argumentFailure(
        'SOLUTION_UNPACK_ARGS_REQUIRED',
        'Usage: solution unpack <path.zip> --out <dir> [--package-type managed|unmanaged|both] [--allow-delete] [--pac PATH]'
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
  deps.printWarnings(result);
  deps.printByFormat(result.data, deps.outputFormat(args, 'json'));
  return 0;
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
