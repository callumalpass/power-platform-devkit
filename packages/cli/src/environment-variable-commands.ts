import { EnvironmentVariableService } from '@pp/dataverse';
import { fail, createDiagnostic, type OperationResult } from '@pp/diagnostics';
import { enforceWriteAccessForCliArgs } from './cli-access';
import { resolveDataverseClientForCli } from './cli-resolution';
import {
  argumentFailure,
  maybeHandleMutationPreview,
  outputFormat,
  positionalArgs,
  printByFormat,
  printFailure,
  printResultDiagnostics,
  readFlag,
} from './cli-support';

export async function runEnvironmentVariableList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new EnvironmentVariableService(resolution.data.client);
  const result = await service.list({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runEnvironmentVariableCreate(args: string[]): Promise<number> {
  const schemaName = positionalArgs(args)[0];

  if (!schemaName) {
    return printFailure(
      argumentFailure(
        'ENVVAR_SCHEMA_REQUIRED',
        'Usage: envvar create <schemaName> --environment <alias> [--display-name NAME] [--default-value VALUE] [--type string|number|boolean|json|data-source|secret]'
      )
    );
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'envvar.create');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new EnvironmentVariableService(resolution.data.client);
  const displayName = readFlag(args, '--display-name');
  const defaultValue = readFlag(args, '--default-value');
  const type = readFlag(args, '--type');
  const valueSchema = readFlag(args, '--value-schema');
  const secretStore = parseEnvironmentVariableSecretStore(readFlag(args, '--secret-store'));

  if (!secretStore.success) {
    return printFailure(secretStore.result);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'envvar.create',
    { schemaName, solution: readFlag(args, '--solution') },
    {
      displayName: displayName ?? schemaName,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(valueSchema !== undefined ? { valueSchema } : {}),
      ...(secretStore.value !== undefined ? { secretStore: secretStore.value } : {}),
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await service.createDefinition(schemaName, {
    displayName,
    defaultValue,
    type,
    valueSchema,
    secretStore: secretStore.value,
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runEnvironmentVariableInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('ENVVAR_IDENTIFIER_REQUIRED', 'Usage: envvar inspect <schemaName|displayName|id> --environment <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new EnvironmentVariableService(resolution.data.client);
  const result = await service.inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'ENVVAR_NOT_FOUND', `Environment variable ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runEnvironmentVariableSet(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const value = readFlag(args, '--value');

  if (!identifier || value === undefined) {
    return printFailure(
      argumentFailure('ENVVAR_SET_ARGS_REQUIRED', 'Usage: envvar set <schemaName|displayName|id> --environment <alias> --value VALUE')
    );
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'envvar.set');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'envvar.set', { identifier, solution: readFlag(args, '--solution') }, { value });

  if (preview !== undefined) {
    return preview;
  }

  const service = new EnvironmentVariableService(resolution.data.client);
  const result = await service.setValue(identifier, value, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

function parseEnvironmentVariableSecretStore(
  value: string | undefined
): { success: true; value: number | undefined } | { success: false; result: OperationResult<never> } {
  if (value === undefined) {
    return {
      success: true,
      value: undefined,
    };
  }

  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-');

  switch (normalized) {
    case 'dataverse':
    case '0':
      return { success: true, value: 0 };
    case 'azure-key-vault':
    case 'key-vault':
    case '1':
      return { success: true, value: 1 };
    default:
      return {
        success: false,
        result: fail(
          createDiagnostic(
            'error',
            'ENVVAR_SECRET_STORE_INVALID',
            `Unsupported secret store ${value}. Use dataverse or azure-key-vault.`,
            {
              source: '@pp/cli',
            }
          )
        ),
      };
  }
}
