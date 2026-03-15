import { ConnectionReferenceService } from '@pp/dataverse';
import { fail, createDiagnostic, type OperationResult } from '@pp/diagnostics';
import { createSuccessPayload } from './contract';
import { enforceWriteAccessForCliArgs } from './cli-access';
import { resolveDataverseClientForCli } from './cli-resolution';
import {
  argumentFailure,
  isMachineReadableOutputFormat,
  maybeHandleMutationPreview,
  outputFormat,
  positionalArgs,
  printByFormat,
  printFailure,
  printResultDiagnostics,
  readFlag,
} from './cli-support';

export async function runConnectionReferenceList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new ConnectionReferenceService(resolution.data.client);
  const result = await service.list({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data ?? [], result, { dataKey: 'runs' }), outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runConnectionReferenceCreate(args: string[]): Promise<number> {
  const logicalName = positionalArgs(args)[0];
  const connectionId = readFlag(args, '--connection-id');
  const allowUnbound = args.includes('--allow-unbound');

  if (!logicalName || (!connectionId && !allowUnbound)) {
    return printFailure(
      argumentFailure(
        'CONNREF_CREATE_ARGS_REQUIRED',
        'Usage: connref create <logicalName> --environment <alias> [--connection-id CONNECTION_ID] [--allow-unbound] [--display-name NAME] [--connector-id CONNECTOR_ID] [--custom-connector-id CONNECTOR_ID]'
      )
    );
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'connref.create');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const displayName = readFlag(args, '--display-name');
  const connectorId = readFlag(args, '--connector-id');
  const customConnectorId = readFlag(args, '--custom-connector-id');
  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'connref.create',
    { logicalName, solution: readFlag(args, '--solution') },
    {
      ...(connectionId !== undefined ? { connectionId } : {}),
      ...(allowUnbound ? { allowUnbound: true } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
      ...(connectorId !== undefined ? { connectorId } : {}),
      ...(customConnectorId !== undefined ? { customConnectorId } : {}),
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const service = new ConnectionReferenceService(resolution.data.client);
  const result = await service.create(logicalName, connectionId, {
    displayName,
    connectorId,
    customConnectorId,
    allowUnbound,
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data, result), outputFormat(args, 'json'));
  return 0;
}

export async function runConnectionReferenceInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('CONNREF_IDENTIFIER_REQUIRED', 'Usage: connref inspect <logicalName|displayName|id> --environment <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new ConnectionReferenceService(resolution.data.client);
  const result = await service.inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'CONNREF_NOT_FOUND', `Connection reference ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runConnectionReferenceSet(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const connectionId = readFlag(args, '--connection-id');

  if (!identifier || !connectionId) {
    return printFailure(
      argumentFailure(
        'CONNREF_SET_ARGS_REQUIRED',
        'Usage: connref set <logicalName|displayName|id> --environment <alias> --connection-id CONNECTION_ID'
      )
    );
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'connref.set');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'connref.set',
    { identifier, solution: readFlag(args, '--solution') },
    { connectionId }
  );

  if (preview !== undefined) {
    return preview;
  }

  const service = new ConnectionReferenceService(resolution.data.client);
  const result = await service.setConnectionId(identifier, connectionId, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runConnectionReferenceValidate(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new ConnectionReferenceService(resolution.data.client);
  const result = await service.validate({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  const format = outputFormat(args, 'json');

  if (isMachineReadableOutputFormat(format)) {
    printByFormat(createSuccessPayload(result.data ?? [], result, { dataKey: 'results' }), format);
    return 0;
  }

  printByFormat(result.data ?? [], format);
  printResultDiagnostics(result, format);
  return 0;
}
