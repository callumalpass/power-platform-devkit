import { ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import {
  ConnectionReferenceService,
  EnvironmentVariableService,
  type ConnectionReferenceValidationResult,
  type DataverseClient,
  type EnvironmentVariableSummary,
} from '@pp/dataverse';

export interface SolutionSummary {
  solutionid: string;
  uniquename: string;
  friendlyname?: string;
  version?: string;
}

export interface SolutionComponentRecord {
  solutioncomponentid: string;
  objectid?: string;
  componenttype?: number;
  ismetadata?: boolean;
  rootcomponentbehavior?: number;
}

export interface SolutionComponentSummary {
  id: string;
  objectId?: string;
  componentType?: number;
  componentTypeLabel: string;
  isMetadata?: boolean;
  rootComponentBehavior?: number;
}

export interface SolutionDependencyRecord {
  dependencyid: string;
  dependencytype?: number;
  requiredcomponentobjectid?: string;
  requiredcomponenttype?: number;
  dependentcomponentobjectid?: string;
  dependentcomponenttype?: number;
}

export interface SolutionDependencySummary {
  id: string;
  dependencyType?: number;
  requiredComponentObjectId?: string;
  requiredComponentType?: number;
  requiredComponentTypeLabel: string;
  dependentComponentObjectId?: string;
  dependentComponentType?: number;
  dependentComponentTypeLabel: string;
  missingRequiredComponent: boolean;
}

export interface SolutionAnalysis {
  solution: SolutionSummary;
  components: SolutionComponentSummary[];
  dependencies: SolutionDependencySummary[];
  missingDependencies: SolutionDependencySummary[];
  invalidConnectionReferences: ConnectionReferenceValidationResult[];
  missingEnvironmentVariables: EnvironmentVariableSummary[];
}

export interface SolutionCompareResult {
  uniqueName: string;
  source: SolutionAnalysis;
  target?: SolutionAnalysis;
  drift: {
    versionChanged: boolean;
    componentsOnlyInSource: SolutionComponentSummary[];
    componentsOnlyInTarget: SolutionComponentSummary[];
  };
  missingDependencies: {
    source: SolutionDependencySummary[];
    target: SolutionDependencySummary[];
  };
  missingConfig: {
    invalidConnectionReferences: {
      source: ConnectionReferenceValidationResult[];
      target: ConnectionReferenceValidationResult[];
    };
    environmentVariablesMissingValues: {
      source: EnvironmentVariableSummary[];
      target: EnvironmentVariableSummary[];
    };
  };
}

export class SolutionService {
  constructor(private readonly dataverseClient: DataverseClient) {}

  async list(): Promise<OperationResult<SolutionSummary[]>> {
    return this.dataverseClient.query<SolutionSummary>({
      table: 'solutions',
      select: ['solutionid', 'uniquename', 'friendlyname', 'version'],
      top: 100,
    });
  }

  async inspect(uniqueName: string): Promise<OperationResult<SolutionSummary | undefined>> {
    const solutions = await this.dataverseClient.query<SolutionSummary>({
      table: 'solutions',
      select: ['solutionid', 'uniquename', 'friendlyname', 'version'],
      filter: `uniquename eq '${escapeODataString(uniqueName)}'`,
      top: 1,
    });

    if (!solutions.success) {
      return solutions as unknown as OperationResult<SolutionSummary | undefined>;
    }

    return ok(solutions.data?.[0], {
      supportTier: 'preview',
      diagnostics: solutions.diagnostics,
      warnings: solutions.warnings,
    });
  }

  async components(uniqueName: string): Promise<OperationResult<SolutionComponentSummary[]>> {
    const solution = await this.inspect(uniqueName);

    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionComponentSummary[]>;
    }

    if (!solution.data) {
      return ok([], {
        supportTier: 'preview',
        diagnostics: solution.diagnostics,
        warnings: solution.warnings,
      });
    }

    const components = await this.dataverseClient.queryAll<SolutionComponentRecord>({
      table: 'solutioncomponents',
      select: ['solutioncomponentid', 'objectid', 'componenttype', 'ismetadata', 'rootcomponentbehavior'],
      filter: `_solutionid_value eq ${solution.data.solutionid}`,
    });

    if (!components.success) {
      return components as unknown as OperationResult<SolutionComponentSummary[]>;
    }

    return ok((components.data ?? []).map(normalizeSolutionComponent), {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(solution.diagnostics, components.diagnostics),
      warnings: mergeDiagnosticLists(solution.warnings, components.warnings),
    });
  }

  async dependencies(uniqueName: string): Promise<OperationResult<SolutionDependencySummary[]>> {
    const components = await this.components(uniqueName);

    if (!components.success) {
      return components as unknown as OperationResult<SolutionDependencySummary[]>;
    }

    const componentIds = new Set((components.data ?? []).map((component) => component.objectId).filter(Boolean) as string[]);
    const dependencies = await this.dataverseClient.queryAll<SolutionDependencyRecord>({
      table: 'dependencies',
      select: [
        'dependencyid',
        'dependencytype',
        'requiredcomponentobjectid',
        'requiredcomponenttype',
        'dependentcomponentobjectid',
        'dependentcomponenttype',
      ],
    });

    if (!dependencies.success) {
      return dependencies as unknown as OperationResult<SolutionDependencySummary[]>;
    }

    const relevant = (dependencies.data ?? [])
      .filter((dependency) => dependency.dependentcomponentobjectid && componentIds.has(dependency.dependentcomponentobjectid))
      .map((dependency) => normalizeSolutionDependency(dependency, componentIds));

    return ok(relevant, {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(components.diagnostics, dependencies.diagnostics),
      warnings: mergeDiagnosticLists(components.warnings, dependencies.warnings),
    });
  }

  async analyze(uniqueName: string): Promise<OperationResult<SolutionAnalysis | undefined>> {
    const solution = await this.inspect(uniqueName);

    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!solution.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: solution.diagnostics,
        warnings: solution.warnings,
      });
    }

    const [components, dependencies, connectionReferences, environmentVariables] = await Promise.all([
      this.components(uniqueName),
      this.dependencies(uniqueName),
      new ConnectionReferenceService(this.dataverseClient).validate({ solutionUniqueName: uniqueName }),
      new EnvironmentVariableService(this.dataverseClient).list({ solutionUniqueName: uniqueName }),
    ]);

    if (!components.success) {
      return components as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!dependencies.success) {
      return dependencies as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!connectionReferences.success) {
      return connectionReferences as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!environmentVariables.success) {
      return environmentVariables as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    const analysis: SolutionAnalysis = {
      solution: solution.data,
      components: components.data ?? [],
      dependencies: dependencies.data ?? [],
      missingDependencies: (dependencies.data ?? []).filter((dependency) => dependency.missingRequiredComponent),
      invalidConnectionReferences: (connectionReferences.data ?? []).filter((reference) => !reference.valid),
      missingEnvironmentVariables: (environmentVariables.data ?? []).filter((variable) => !variable.effectiveValue),
    };

    return ok(analysis, {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(
        solution.diagnostics,
        components.diagnostics,
        dependencies.diagnostics,
        connectionReferences.diagnostics,
        environmentVariables.diagnostics
      ),
      warnings: mergeDiagnosticLists(
        solution.warnings,
        components.warnings,
        dependencies.warnings,
        connectionReferences.warnings,
        environmentVariables.warnings
      ),
    });
  }

  async compare(uniqueName: string, target: SolutionService): Promise<OperationResult<SolutionCompareResult | undefined>> {
    const [sourceAnalysis, targetAnalysis] = await Promise.all([this.analyze(uniqueName), target.analyze(uniqueName)]);

    if (!sourceAnalysis.success) {
      return sourceAnalysis as unknown as OperationResult<SolutionCompareResult | undefined>;
    }

    if (!targetAnalysis.success) {
      return targetAnalysis as unknown as OperationResult<SolutionCompareResult | undefined>;
    }

    if (!sourceAnalysis.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: sourceAnalysis.diagnostics,
        warnings: mergeDiagnosticLists(sourceAnalysis.warnings, targetAnalysis.warnings),
      });
    }

    const sourceComponents = sourceAnalysis.data.components;
    const targetComponents = targetAnalysis.data?.components ?? [];
    const targetComponentIds = new Set(targetComponents.map((component) => component.objectId).filter(Boolean) as string[]);
    const sourceComponentIds = new Set(sourceComponents.map((component) => component.objectId).filter(Boolean) as string[]);

    return ok(
      {
        uniqueName,
        source: sourceAnalysis.data,
        target: targetAnalysis.data,
        drift: {
          versionChanged: sourceAnalysis.data.solution.version !== targetAnalysis.data?.solution.version,
          componentsOnlyInSource: sourceComponents.filter((component) => component.objectId && !targetComponentIds.has(component.objectId)),
          componentsOnlyInTarget: targetComponents.filter((component) => component.objectId && !sourceComponentIds.has(component.objectId)),
        },
        missingDependencies: {
          source: sourceAnalysis.data.missingDependencies,
          target: targetAnalysis.data?.missingDependencies ?? [],
        },
        missingConfig: {
          invalidConnectionReferences: {
            source: sourceAnalysis.data.invalidConnectionReferences,
            target: targetAnalysis.data?.invalidConnectionReferences ?? [],
          },
          environmentVariablesMissingValues: {
            source: sourceAnalysis.data.missingEnvironmentVariables,
            target: targetAnalysis.data?.missingEnvironmentVariables ?? [],
          },
        },
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(sourceAnalysis.diagnostics, targetAnalysis.diagnostics),
        warnings: mergeDiagnosticLists(sourceAnalysis.warnings, targetAnalysis.warnings),
      }
    );
  }
}

function normalizeSolutionComponent(component: SolutionComponentRecord): SolutionComponentSummary {
  return {
    id: component.solutioncomponentid,
    objectId: component.objectid,
    componentType: component.componenttype,
    componentTypeLabel: describeComponentType(component.componenttype),
    isMetadata: component.ismetadata,
    rootComponentBehavior: component.rootcomponentbehavior,
  };
}

function normalizeSolutionDependency(
  dependency: SolutionDependencyRecord,
  componentIds: Set<string>
): SolutionDependencySummary {
  return {
    id: dependency.dependencyid,
    dependencyType: dependency.dependencytype,
    requiredComponentObjectId: dependency.requiredcomponentobjectid,
    requiredComponentType: dependency.requiredcomponenttype,
    requiredComponentTypeLabel: describeComponentType(dependency.requiredcomponenttype),
    dependentComponentObjectId: dependency.dependentcomponentobjectid,
    dependentComponentType: dependency.dependentcomponenttype,
    dependentComponentTypeLabel: describeComponentType(dependency.dependentcomponenttype),
    missingRequiredComponent: Boolean(
      dependency.requiredcomponentobjectid && !componentIds.has(dependency.requiredcomponentobjectid)
    ),
  };
}

function describeComponentType(componentType: number | undefined): string {
  const labels: Record<number, string> = {
    1: 'entity',
    2: 'attribute',
    24: 'form',
    26: 'view',
    29: 'workflow',
    31: 'dashboard',
    60: 'system-form',
    61: 'web-resource',
    62: 'site-map',
    80: 'app-module',
    371: 'connection-reference',
    380: 'environment-variable-definition',
  };

  return componentType !== undefined ? labels[componentType] ?? `component-${componentType}` : 'unknown';
}

function escapeODataString(value: string): string {
  return value.replaceAll("'", "''");
}

function mergeDiagnosticLists(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
}
