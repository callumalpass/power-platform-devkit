import { AuthService, summarizeProfile, type AuthProfile } from '@pp/auth';
import { listEnvironments, type ConfigStoreOptions } from '@pp/config';

export interface EnvironmentProjectUsageSummary {
  projectRoot: string;
  selectedStage?: string;
  stages: string[];
  activeForSelectedStage: boolean;
}

export interface AuthProfileUsageSummary {
  environmentAliases: string[];
  environmentCount: number;
}

export async function buildEnvironmentProjectUsageSummary(
  _alias: string,
  _configOptions: ConfigStoreOptions,
  _cwd = process.cwd()
): Promise<EnvironmentProjectUsageSummary | undefined> {
  return undefined;
}

export async function buildAuthProfileUsageSummary(
  profileName: string,
  configOptions: ConfigStoreOptions,
  _cwd = process.cwd()
): Promise<AuthProfileUsageSummary> {
  const environments = await listEnvironments(configOptions);
  const environmentAliases = (environments.success ? environments.data ?? [] : [])
    .filter((environment) => environment.authProfile === profileName)
    .map((environment) => environment.alias)
    .sort((left, right) => left.localeCompare(right));

  return {
    environmentAliases,
    environmentCount: environmentAliases.length,
  };
}
