import { AuthService, summarizeProfile, type AuthProfile } from '@pp/auth';
import { getEnvironmentAlias, listEnvironments, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import { discoverProject, summarizeProjectContract, type ProjectContext } from '@pp/project';

export interface ProjectStageRelationship {
  stage: string;
  environmentAlias?: string;
  environmentUrl?: string;
  environmentStatus: 'configured' | 'missing' | 'unset';
  authProfile?: string;
  authProfileType?: string;
  authProfileStatus: 'configured' | 'missing' | 'unresolved' | 'unset';
  solutionAlias?: string;
  solutionUniqueName?: string;
  summary: string;
}

export interface ProjectRelationshipSummary {
  projectRoot: string;
  selectedStage?: string;
  activeEnvironmentAlias?: string;
  activeEnvironmentUrl?: string;
  activeAuthProfile?: string;
  activeAuthProfileType?: string;
  activeAuthProfileStatus: 'configured' | 'missing' | 'unresolved' | 'unset';
  activeRelationshipSummary: string;
  stageRelationships: ProjectStageRelationship[];
  authProfileNames: string[];
  authProfileUsageSummary: string;
}

export interface EnvironmentProjectUsageSummary {
  projectRoot: string;
  selectedStage?: string;
  stages: string[];
  activeForSelectedStage: boolean;
}

export interface AuthProfileUsageSummary {
  environmentAliases: string[];
  environmentCount: number;
  currentProject?: {
    projectRoot: string;
    selectedStage?: string;
    stages: string[];
    environmentAliases: string[];
  };
}

export async function buildProjectRelationshipSummary(
  project: ProjectContext,
  configOptions: ConfigStoreOptions
): Promise<ProjectRelationshipSummary> {
  const auth = new AuthService(configOptions);
  const contract = summarizeProjectContract(project);
  const stageRelationships: ProjectStageRelationship[] = [];
  const authProfileNames = new Set<string>();

  for (const stage of contract.stageMappings) {
    const environmentAlias = stage.environmentAlias;
    const environment =
      environmentAlias !== undefined ? await getSuccessfulEnvironmentAlias(environmentAlias, configOptions) : undefined;
    const profile =
      environment?.authProfile !== undefined ? await getSuccessfulAuthProfile(environment.authProfile, auth) : undefined;

    if (profile?.name) {
      authProfileNames.add(profile.name);
    }

    const summaryParts = [
      `stage ${stage.stage ?? '<unset>'}`,
      `environment ${environmentAlias ?? '<unset>'}`,
      environment?.url ? `url ${environment.url}` : undefined,
      `auth profile ${
        profile?.name ?? environment?.authProfile ?? (environmentAlias ? '<missing>' : '<unset>')
      }${profile?.type ? ` (${profile.type})` : ''}`,
      `solution ${stage.solutionAlias ?? '<unset>'} (${stage.solutionUniqueName ?? '<unset>'})`,
    ].filter(Boolean);

    stageRelationships.push({
      stage: stage.stage ?? '<unset>',
      environmentAlias,
      environmentUrl: environment?.url,
      environmentStatus: environmentAlias ? (environment ? 'configured' : 'missing') : 'unset',
      authProfile: profile?.name ?? environment?.authProfile,
      authProfileType: profile?.type,
      authProfileStatus: environmentAlias
        ? environment
          ? profile
            ? 'configured'
            : 'missing'
          : 'unresolved'
        : 'unset',
      solutionAlias: stage.solutionAlias,
      solutionUniqueName: stage.solutionUniqueName,
      summary: summaryParts.join(' -> '),
    });
  }

  const activeStageRelationship =
    stageRelationships.find((stage) => stage.stage === project.topology.selectedStage) ?? stageRelationships[0];
  const authProfileList = [...authProfileNames].sort((left, right) => left.localeCompare(right));

  return {
    projectRoot: project.root,
    selectedStage: project.topology.selectedStage,
    activeEnvironmentAlias: activeStageRelationship?.environmentAlias,
    activeEnvironmentUrl: activeStageRelationship?.environmentUrl,
    activeAuthProfile: activeStageRelationship?.authProfile,
    activeAuthProfileType: activeStageRelationship?.authProfileType,
    activeAuthProfileStatus: activeStageRelationship?.authProfileStatus ?? 'unset',
    activeRelationshipSummary: activeStageRelationship?.summary ?? 'No stage-aware environment/auth relationship is configured.',
    stageRelationships,
    authProfileNames: authProfileList,
    authProfileUsageSummary:
      authProfileList.length === 0
        ? 'No auth profile could be resolved from the current project stage mappings.'
        : authProfileList.length === 1
          ? `All resolvable project stages currently converge on one auth profile: ${authProfileList[0]}.`
          : `Project stages currently resolve through multiple auth profiles: ${authProfileList.join(', ')}.`,
  };
}

export async function buildEnvironmentProjectUsageSummary(
  alias: string,
  configOptions: ConfigStoreOptions,
  cwd = process.cwd()
): Promise<EnvironmentProjectUsageSummary | undefined> {
  const project = await discoverCurrentProject(cwd);

  if (!project) {
    return undefined;
  }

  const contract = summarizeProjectContract(project);
  const stages = contract.stageMappings.filter((stage) => stage.environmentAlias === alias).map((stage) => stage.stage ?? '<unset>');

  if (stages.length === 0) {
    return undefined;
  }

  return {
    projectRoot: project.root,
    selectedStage: project.topology.selectedStage,
    stages,
    activeForSelectedStage: project.topology.selectedStage !== undefined && stages.includes(project.topology.selectedStage),
  };
}

export async function buildAuthProfileUsageSummary(
  profileName: string,
  configOptions: ConfigStoreOptions,
  cwd = process.cwd()
): Promise<AuthProfileUsageSummary> {
  const environments = await listEnvironments(configOptions);
  const environmentAliases = (environments.success ? environments.data ?? [] : [])
    .filter((environment) => environment.authProfile === profileName)
    .map((environment) => environment.alias)
    .sort((left, right) => left.localeCompare(right));
  const project = await discoverCurrentProject(cwd);

  if (!project) {
    return {
      environmentAliases,
      environmentCount: environmentAliases.length,
    };
  }

  const contract = summarizeProjectContract(project);
  const stages = contract.stageMappings.filter((stage) => environmentAliases.includes(stage.environmentAlias ?? '')).map((stage) => stage.stage ?? '<unset>');
  const projectEnvironmentAliases = [
    ...new Set(
      contract.stageMappings
        .map((stage) => stage.environmentAlias)
        .filter((value): value is string => typeof value === 'string')
        .filter((value) => environmentAliases.includes(value))
    ),
  ].sort((left, right) => left.localeCompare(right));

  return {
    environmentAliases,
    environmentCount: environmentAliases.length,
    currentProject:
      stages.length > 0
        ? {
            projectRoot: project.root,
            selectedStage: project.topology.selectedStage,
            stages,
            environmentAliases: projectEnvironmentAliases,
          }
        : undefined,
  };
}

function summarizeAuthProfileForEnvironment(profile: AuthProfile): Record<string, unknown> {
  return summarizeProfile(profile);
}

async function discoverCurrentProject(cwd: string): Promise<ProjectContext | undefined> {
  const project = await discoverProject(cwd);
  return project.success ? project.data ?? undefined : undefined;
}

async function getSuccessfulEnvironmentAlias(alias: string, configOptions: ConfigStoreOptions): Promise<EnvironmentAlias | undefined> {
  const environment = await getEnvironmentAlias(alias, configOptions);
  return environment.success ? environment.data ?? undefined : undefined;
}

async function getSuccessfulAuthProfile(name: string, auth: AuthService): Promise<(ReturnType<typeof summarizeAuthProfileForEnvironment> & { name: string; type: string }) | undefined> {
  const profile = await auth.getProfile(name);

  if (!profile.success || !profile.data) {
    return undefined;
  }

  const summary = summarizeAuthProfileForEnvironment(profile.data) as ReturnType<typeof summarizeAuthProfileForEnvironment> & {
    name: string;
    type: string;
  };
  return summary;
}
