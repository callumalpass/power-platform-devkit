import { checkEnvironmentAccess } from '@pp/config';
import { readMutationFlags } from './contract';
import { printFailure, readConfigOptions } from './cli-support';
import { readEnvironmentAlias } from './cli-resolution';

export type EnvironmentWriteGuardResult = number | undefined;

export async function enforceWriteAccessForCliArgs(
  args: string[],
  operation: string,
  isWrite = true
): Promise<EnvironmentWriteGuardResult> {
  if (!isWrite) {
    return undefined;
  }

  const mutation = readMutationFlags(args);

  if (mutation.success && mutation.data?.mode !== 'apply') {
    return undefined;
  }

  const environmentAlias = readEnvironmentAlias(args);

  if (!environmentAlias) {
    return undefined;
  }

  const access = await checkEnvironmentAccess(
    {
      environmentAlias,
      intent: 'write',
      operation,
      surface: 'cli',
    },
    readConfigOptions(args)
  );

  if (!access.success) {
    return printFailure(access);
  }

  return undefined;
}
