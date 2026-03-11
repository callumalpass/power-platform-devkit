import {
  ModelDrivenAppService,
  type DataverseClient,
  type EntityDefinition,
  type ModelDrivenAppAttachResult,
  type ModelDrivenAppCreateOptions,
  type ModelDrivenAppComponentSummary,
  type ModelDrivenAppFormSummary,
  type ModelDrivenAppSitemapSummary,
  type ModelDrivenAppSummary,
  type ModelDrivenAppViewSummary,
} from '@pp/dataverse';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';

export type ModelAppSummary = ModelDrivenAppSummary;
export type ModelAppAttachResult = ModelDrivenAppAttachResult;

export interface ModelTableSummary {
  id?: string;
  logicalName?: string;
  schemaName?: string;
  displayName?: string;
}

export type ModelFormSummary = ModelDrivenAppFormSummary;
export type ModelViewSummary = ModelDrivenAppViewSummary;
export type ModelSitemapSummary = ModelDrivenAppSitemapSummary;
export type ModelArtifactKind = 'app' | 'table' | 'form' | 'view' | 'sitemap' | 'component';
export type ModelArtifactMutationKind = 'app' | 'form' | 'view' | 'sitemap';

export interface ModelDependencySummary {
  componentId: string;
  componentType?: number;
  componentTypeLabel: string;
  objectId?: string;
  name?: string;
  table?: string;
  status: 'resolved' | 'missing';
}

export interface ModelCompositionArtifact {
  key: string;
  kind: ModelArtifactKind;
  id?: string;
  componentId?: string;
  componentType?: number;
  name?: string;
  table?: string;
  logicalName?: string;
  status: 'resolved' | 'missing';
}

export interface ModelCompositionRelationship {
  from: string;
  to: string;
  relation: 'contains' | 'depends-on';
}

export interface ModelCompositionResult {
  app: ModelAppSummary;
  artifacts: ModelCompositionArtifact[];
  relationships: ModelCompositionRelationship[];
  summary: {
    totalArtifacts: number;
    missingArtifacts: number;
    byKind: Record<string, number>;
    tables: string[];
  };
}

export interface ModelImpactPreview {
  app: ModelAppSummary;
  target: ModelCompositionArtifact;
  dependencies: ModelCompositionArtifact[];
  dependents: ModelCompositionArtifact[];
  missingDependencies: ModelCompositionArtifact[];
}

export interface ModelMutationTarget {
  kind: ModelArtifactMutationKind;
  identifier: string;
}

export interface ModelRenameMutationRequest {
  operation: 'rename';
  target: ModelMutationTarget;
  value: {
    name: string;
  };
}

export type ModelMutationPlanRequest = ModelRenameMutationRequest;

export interface ModelMutationPlanOperation {
  scope: 'dataverse';
  action: 'update';
  table: 'appmodules' | 'systemforms' | 'savedqueries' | 'sitemaps';
  id: string;
  patch: Record<string, unknown>;
}

export interface ModelMutationPlan {
  valid: boolean;
  request: ModelMutationPlanRequest;
  target?: ModelCompositionArtifact;
  impact?: ModelImpactPreview;
  operations: ModelMutationPlanOperation[];
}

export interface ModelInspectResult {
  app: ModelAppSummary;
  sitemaps: ModelSitemapSummary[];
  forms: ModelFormSummary[];
  views: ModelViewSummary[];
  tables: ModelTableSummary[];
  dependencies: ModelDependencySummary[];
  missingComponents: ModelDependencySummary[];
}

interface ModelSolutionComponentRecord {
  objectid?: string;
  componenttype?: number;
  _solutionid_value?: string;
}

interface ModelLookups {
  tables: Map<string, ModelTableSummary>;
  forms: Map<string, ModelFormSummary>;
  views: Map<string, ModelViewSummary>;
  sitemaps: Map<string, ModelSitemapSummary>;
}

interface ModelInspectContext {
  app: ModelAppSummary;
  appComponents: ModelDrivenAppComponentSummary[];
  tables: ModelTableSummary[];
  forms: ModelFormSummary[];
  views: ModelViewSummary[];
  sitemaps: ModelSitemapSummary[];
  dependencies: ModelDependencySummary[];
  missingComponents: ModelDependencySummary[];
}

export class ModelService {
  constructor(private readonly dataverseClient: DataverseClient) {}

  async create(uniqueName: string, options: ModelDrivenAppCreateOptions = {}): Promise<OperationResult<ModelAppSummary>> {
    return new ModelDrivenAppService(this.dataverseClient).create(uniqueName, options);
  }

  async attach(
    identifier: string,
    options: { solutionUniqueName?: string; addRequiredComponents?: boolean } = {}
  ): Promise<OperationResult<ModelAppAttachResult>> {
    if (!options.solutionUniqueName?.trim()) {
      return fail(
        createDiagnostic('error', 'MODEL_SOLUTION_REQUIRED', 'Solution unique name is required when attaching a model-driven app.', {
          source: '@pp/model',
        })
      );
    }

    return new ModelDrivenAppService(this.dataverseClient).attachToSolution(identifier, options.solutionUniqueName, {
      addRequiredComponents: options.addRequiredComponents,
    });
  }

  async list(options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ModelAppSummary[]>> {
    const appService = new ModelDrivenAppService(this.dataverseClient);
    const apps = await appService.list();

    if (!apps.success) {
      return apps as unknown as OperationResult<ModelAppSummary[]>;
    }

    let allowedIds: Set<string> | undefined;
    let diagnostics = apps.diagnostics;
    let warnings = apps.warnings;

    if (options.solutionUniqueName) {
      const solutions = await this.dataverseClient.query<{ solutionid: string; uniquename?: string }>({
        table: 'solutions',
        select: ['solutionid', 'uniquename'],
      });

      if (!solutions.success) {
        return solutions as unknown as OperationResult<ModelAppSummary[]>;
      }

      const solutionId = (solutions.data ?? []).find((candidate) => candidate.uniquename === options.solutionUniqueName)?.solutionid;
      const solutionComponents = await this.dataverseClient.queryAll<ModelSolutionComponentRecord>({
        table: 'solutioncomponents',
        select: ['objectid', 'componenttype', '_solutionid_value'],
      });

      if (!solutionComponents.success) {
        return solutionComponents as unknown as OperationResult<ModelAppSummary[]>;
      }

      allowedIds = new Set(
        (solutionComponents.data ?? [])
          .filter(
            (component) =>
              component.componenttype === 80 &&
              component.objectid &&
              (!solutionId || !component._solutionid_value || component._solutionid_value === solutionId)
          )
          .map((component) => component.objectid as string)
      );
      diagnostics = [...diagnostics, ...solutions.diagnostics, ...solutionComponents.diagnostics];
      warnings = [...warnings, ...solutions.warnings, ...solutionComponents.warnings];
    }

    return ok(
      (apps.data ?? [])
        .filter((app) => !allowedIds || allowedIds.has(app.id))
        .sort((left, right) => (left.name ?? left.uniqueName ?? left.id).localeCompare(right.name ?? right.uniqueName ?? right.id)),
      {
        supportTier: 'preview',
        diagnostics,
        warnings,
      }
    );
  }

  async inspect(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ModelInspectResult | undefined>> {
    const context = await this.inspectContext(identifier, options);

    if (!context.success) {
      return context as unknown as OperationResult<ModelInspectResult | undefined>;
    }

    if (!context.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: context.diagnostics,
        warnings: context.warnings,
      });
    }

    return ok(
      {
        app: context.data.app,
        sitemaps: context.data.sitemaps,
        forms: context.data.forms,
        views: context.data.views,
        tables: context.data.tables,
        dependencies: context.data.dependencies,
        missingComponents: context.data.missingComponents,
      },
      {
        supportTier: 'preview',
        diagnostics: context.diagnostics,
        warnings: context.warnings,
      }
    );
  }

  async composition(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ModelCompositionResult | undefined>> {
    const context = await this.inspectContext(identifier, options);

    if (!context.success) {
      return context as unknown as OperationResult<ModelCompositionResult | undefined>;
    }

    if (!context.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: context.diagnostics,
        warnings: context.warnings,
      });
    }

    const composition = buildComposition(context.data);

    return ok(composition, {
      supportTier: 'preview',
      diagnostics: context.diagnostics,
      warnings: context.warnings,
    });
  }

  async impact(
    identifier: string,
    target: ModelMutationTarget,
    options: { solutionUniqueName?: string } = {}
  ): Promise<OperationResult<ModelImpactPreview | undefined>> {
    const composition = await this.composition(identifier, options);

    if (!composition.success) {
      return composition as unknown as OperationResult<ModelImpactPreview | undefined>;
    }

    if (!composition.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: composition.diagnostics,
        warnings: composition.warnings,
      });
    }

    const preview = buildImpactPreview(composition.data, target);

    return ok(preview, {
      supportTier: 'preview',
      diagnostics: composition.diagnostics,
      warnings: composition.warnings,
    });
  }

  async planMutation(
    identifier: string,
    request: ModelMutationPlanRequest,
    options: { solutionUniqueName?: string } = {}
  ): Promise<OperationResult<ModelMutationPlan>> {
    const composition = await this.composition(identifier, options);

    if (!composition.success) {
      return composition as unknown as OperationResult<ModelMutationPlan>;
    }

    const diagnostics = [...composition.diagnostics];
    const warnings = [...composition.warnings];

    if (!composition.data) {
      diagnostics.push(
        createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`, {
          source: '@pp/model',
        })
      );
      return ok(
        {
          valid: false,
          request,
          operations: [],
        },
        {
          supportTier: 'preview',
          diagnostics,
          warnings,
        }
      );
    }

    const target = findArtifact(composition.data, request.target);

    if (!target) {
      diagnostics.push(
        createDiagnostic(
          'error',
          'MODEL_MUTATION_TARGET_NOT_FOUND',
          `Could not find ${request.target.kind} target ${request.target.identifier} in model-driven app ${identifier}.`,
          {
            source: '@pp/model',
          }
        )
      );
      return ok(
        {
          valid: false,
          request,
          operations: [],
        },
        {
          supportTier: 'preview',
          diagnostics,
          warnings,
        }
      );
    }

    const operation = buildMutationOperation(request, target);

    if (!operation) {
      diagnostics.push(
        createDiagnostic(
          'error',
          'MODEL_MUTATION_UNSUPPORTED',
          `Mutation ${request.operation} is not supported for ${request.target.kind} targets.`,
          {
            source: '@pp/model',
          }
        )
      );
      return ok(
        {
          valid: false,
          request,
          target,
          impact: buildImpactPreview(composition.data, request.target),
          operations: [],
        },
        {
          supportTier: 'preview',
          diagnostics,
          warnings,
        }
      );
    }

    return ok(
      {
        valid: true,
        request,
        target,
        impact: buildImpactPreview(composition.data, request.target),
        operations: [operation],
      },
      {
        supportTier: 'preview',
        diagnostics,
        warnings,
      }
    );
  }

  async sitemap(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ModelSitemapSummary[]>> {
    const inspect = await this.inspect(identifier, options);

    if (!inspect.success) {
      return inspect as unknown as OperationResult<ModelSitemapSummary[]>;
    }

    return ok(inspect.data?.sitemaps ?? [], {
      supportTier: 'preview',
      diagnostics: inspect.diagnostics,
      warnings: inspect.warnings,
    });
  }

  async forms(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ModelFormSummary[]>> {
    const inspect = await this.inspect(identifier, options);

    if (!inspect.success) {
      return inspect as unknown as OperationResult<ModelFormSummary[]>;
    }

    return ok(inspect.data?.forms ?? [], {
      supportTier: 'preview',
      diagnostics: inspect.diagnostics,
      warnings: inspect.warnings,
    });
  }

  async views(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ModelViewSummary[]>> {
    const inspect = await this.inspect(identifier, options);

    if (!inspect.success) {
      return inspect as unknown as OperationResult<ModelViewSummary[]>;
    }

    return ok(inspect.data?.views ?? [], {
      supportTier: 'preview',
      diagnostics: inspect.diagnostics,
      warnings: inspect.warnings,
    });
  }

  async dependencies(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ModelDependencySummary[]>> {
    const inspect = await this.inspect(identifier, options);

    if (!inspect.success) {
      return inspect as unknown as OperationResult<ModelDependencySummary[]>;
    }

    return ok(inspect.data?.dependencies ?? [], {
      supportTier: 'preview',
      diagnostics: inspect.diagnostics,
      warnings: inspect.warnings,
    });
  }

  private async inspectContext(
    identifier: string,
    options: { solutionUniqueName?: string } = {}
  ): Promise<OperationResult<ModelInspectContext | undefined>> {
    const appService = new ModelDrivenAppService(this.dataverseClient);
    const apps = await this.list(options);

    if (!apps.success) {
      return apps as unknown as OperationResult<ModelInspectContext | undefined>;
    }

    const app = (apps.data ?? []).find((candidate) => candidate.id === identifier || candidate.name === identifier || candidate.uniqueName === identifier);

    if (!app) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: apps.diagnostics,
        warnings: apps.warnings,
      });
    }

    const [components, forms, views, sitemaps, tables] = await Promise.all([
      appService.components(app.id),
      appService.forms(),
      appService.views(),
      appService.sitemaps(),
      this.dataverseClient.listTables({
        select: ['MetadataId', 'LogicalName', 'SchemaName', 'DisplayName'],
        all: true,
      }),
    ]);

    if (!components.success) {
      return components as unknown as OperationResult<ModelInspectContext | undefined>;
    }

    if (!forms.success) {
      return forms as unknown as OperationResult<ModelInspectContext | undefined>;
    }

    if (!views.success) {
      return views as unknown as OperationResult<ModelInspectContext | undefined>;
    }

    if (!sitemaps.success) {
      return sitemaps as unknown as OperationResult<ModelInspectContext | undefined>;
    }

    if (!tables.success) {
      return tables as unknown as OperationResult<ModelInspectContext | undefined>;
    }

    const lookups = createLookups(forms.data ?? [], views.data ?? [], sitemaps.data ?? [], tables.data ?? []);
    const appComponents = components.data ?? [];
    const dependencies = appComponents.map((component) => summarizeDependency(component, lookups));
    const data: ModelInspectContext = {
      app,
      appComponents,
      sitemaps: dependencies
        .filter((item) => item.componentType === 62 && item.status === 'resolved')
        .map((item) => lookups.sitemaps.get(normalizeMetadataId(item.objectId))!)
        .filter(Boolean),
      forms: dependencies
        .filter((item) => item.componentType === 60 && item.status === 'resolved')
        .map((item) => lookups.forms.get(normalizeMetadataId(item.objectId))!)
        .filter(Boolean),
      views: dependencies
        .filter((item) => item.componentType === 26 && item.status === 'resolved')
        .map((item) => lookups.views.get(normalizeMetadataId(item.objectId))!)
        .filter(Boolean),
      tables: dependencies
        .filter((item) => item.componentType === 1 && item.status === 'resolved')
        .map((item) => lookups.tables.get(normalizeMetadataId(item.objectId))!)
        .filter(Boolean),
      dependencies,
      missingComponents: dependencies.filter((item) => item.status === 'missing'),
    };

    return ok(data, {
      supportTier: 'preview',
      diagnostics: mergeDiagnostics(apps.diagnostics, components.diagnostics, forms.diagnostics, views.diagnostics, sitemaps.diagnostics, tables.diagnostics),
      warnings: mergeDiagnostics(apps.warnings, components.warnings, forms.warnings, views.warnings, sitemaps.warnings, tables.warnings),
    });
  }
}

function buildComposition(context: ModelInspectContext): ModelCompositionResult {
  const artifacts = new Map<string, ModelCompositionArtifact>();
  const relationships: ModelCompositionRelationship[] = [];
  const appKey = `app:${normalizeMetadataId(context.app.id)}`;

  artifacts.set(appKey, {
    key: appKey,
    kind: 'app',
    id: context.app.id,
    name: context.app.name ?? context.app.uniqueName,
    status: 'resolved',
  });

  for (const dependency of context.dependencies) {
    const artifact = toCompositionArtifact(dependency, context.appComponents);
    artifacts.set(artifact.key, artifact);
    relationships.push({
      from: appKey,
      to: artifact.key,
      relation: 'contains',
    });

    if ((artifact.kind === 'form' || artifact.kind === 'view') && artifact.table) {
      const table = Array.from(artifacts.values()).find(
        (candidate) => candidate.kind === 'table' && candidate.logicalName?.toLowerCase() === artifact.table?.toLowerCase()
      );

      if (table) {
        relationships.push({
          from: artifact.key,
          to: table.key,
          relation: 'depends-on',
        });
      }
    }
  }

  const artifactList = Array.from(artifacts.values()).sort(compareArtifacts);
  const byKind = artifactList.reduce<Record<string, number>>((result, artifact) => {
    result[artifact.kind] = (result[artifact.kind] ?? 0) + 1;
    return result;
  }, {});

  return {
    app: context.app,
    artifacts: artifactList,
    relationships: dedupeRelationships(relationships),
    summary: {
      totalArtifacts: artifactList.length,
      missingArtifacts: artifactList.filter((artifact) => artifact.status === 'missing').length,
      byKind,
      tables: artifactList
        .filter((artifact) => artifact.kind === 'table' && artifact.logicalName)
        .map((artifact) => artifact.logicalName!)
        .sort(),
    },
  };
}

function buildImpactPreview(composition: ModelCompositionResult, target: ModelMutationTarget): ModelImpactPreview | undefined {
  const artifact = findArtifact(composition, target);

  if (!artifact) {
    return undefined;
  }

  const dependencyKeys = composition.relationships.filter((edge) => edge.from === artifact.key).map((edge) => edge.to);
  const dependentKeys = composition.relationships.filter((edge) => edge.to === artifact.key).map((edge) => edge.from);
  const dependencies = composition.artifacts.filter((candidate) => dependencyKeys.includes(candidate.key));
  const dependents = composition.artifacts.filter((candidate) => dependentKeys.includes(candidate.key));

  return {
    app: composition.app,
    target: artifact,
    dependencies,
    dependents,
    missingDependencies: dependencies.filter((candidate) => candidate.status === 'missing'),
  };
}

function buildMutationOperation(
  request: ModelMutationPlanRequest,
  target: ModelCompositionArtifact
): ModelMutationPlanOperation | undefined {
  if (request.operation !== 'rename' || !target.id) {
    return undefined;
  }

  switch (target.kind) {
    case 'app':
      return {
        scope: 'dataverse',
        action: 'update',
        table: 'appmodules',
        id: target.id,
        patch: {
          name: request.value.name,
        },
      };
    case 'form':
      return {
        scope: 'dataverse',
        action: 'update',
        table: 'systemforms',
        id: target.id,
        patch: {
          name: request.value.name,
        },
      };
    case 'view':
      return {
        scope: 'dataverse',
        action: 'update',
        table: 'savedqueries',
        id: target.id,
        patch: {
          name: request.value.name,
        },
      };
    case 'sitemap':
      return {
        scope: 'dataverse',
        action: 'update',
        table: 'sitemaps',
        id: target.id,
        patch: {
          sitemapname: request.value.name,
        },
      };
    default:
      return undefined;
  }
}

function toCompositionArtifact(
  dependency: ModelDependencySummary,
  appComponents: ModelDrivenAppComponentSummary[]
): ModelCompositionArtifact {
  const matchingComponent = appComponents.find((component) => component.id === dependency.componentId);
  const keyBase = dependency.objectId ? normalizeMetadataId(dependency.objectId) : dependency.componentId;

  return {
    key: `${dependency.componentTypeLabel}:${keyBase}`,
    kind: isCompositionArtifactKind(dependency.componentTypeLabel) ? dependency.componentTypeLabel : 'component',
    id: dependency.objectId,
    componentId: dependency.componentId,
    componentType: dependency.componentType,
    name: dependency.name,
    table: dependency.table,
    logicalName: dependency.componentTypeLabel === 'table' ? dependency.table : undefined,
    status: dependency.status,
  };
}

function findArtifact(composition: ModelCompositionResult, target: ModelMutationTarget): ModelCompositionArtifact | undefined {
  const normalizedIdentifier = target.identifier.trim().toLowerCase();

  return composition.artifacts.find((artifact) => {
    if (artifact.kind !== target.kind) {
      return false;
    }

    return (
      artifact.id?.toLowerCase() === normalizedIdentifier ||
      artifact.name?.toLowerCase() === normalizedIdentifier ||
      artifact.logicalName?.toLowerCase() === normalizedIdentifier
    );
  });
}

function createLookups(
  forms: ModelFormSummary[],
  views: ModelViewSummary[],
  sitemaps: ModelSitemapSummary[],
  tables: EntityDefinition[]
): ModelLookups {
  return {
    tables: new Map<string, ModelTableSummary>(
      tables.map((table) => [normalizeMetadataId(typeof table.MetadataId === 'string' ? table.MetadataId : undefined), normalizeTable(table)])
    ),
    forms: new Map<string, ModelFormSummary>(forms.map((form) => [normalizeMetadataId(form.id), form])),
    views: new Map<string, ModelViewSummary>(views.map((view) => [normalizeMetadataId(view.id), view])),
    sitemaps: new Map<string, ModelSitemapSummary>(sitemaps.map((sitemap) => [normalizeMetadataId(sitemap.id), sitemap])),
  };
}

function normalizeTable(definition: EntityDefinition): ModelTableSummary {
  return {
    id: typeof definition.MetadataId === 'string' ? definition.MetadataId : undefined,
    logicalName: typeof definition.LogicalName === 'string' ? definition.LogicalName : undefined,
    schemaName: typeof definition.SchemaName === 'string' ? definition.SchemaName : undefined,
    displayName: extractDisplayName(definition.DisplayName),
  };
}

function summarizeDependency(component: ModelDrivenAppComponentSummary, lookups: ModelLookups): ModelDependencySummary {
  const objectId = component.objectId;
  const normalizedId = normalizeMetadataId(objectId);

  switch (component.componentType) {
    case 1: {
      const table = lookups.tables.get(normalizedId);
      return {
        componentId: component.id,
        componentType: component.componentType,
        componentTypeLabel: 'table',
        objectId,
        name: table?.displayName ?? table?.logicalName,
        table: table?.logicalName,
        status: table ? 'resolved' : 'missing',
      };
    }
    case 26: {
      const view = lookups.views.get(normalizedId);
      return {
        componentId: component.id,
        componentType: component.componentType,
        componentTypeLabel: 'view',
        objectId,
        name: view?.name,
        table: view?.table,
        status: view ? 'resolved' : 'missing',
      };
    }
    case 60: {
      const form = lookups.forms.get(normalizedId);
      return {
        componentId: component.id,
        componentType: component.componentType,
        componentTypeLabel: 'form',
        objectId,
        name: form?.name,
        table: form?.table,
        status: form ? 'resolved' : 'missing',
      };
    }
    case 62: {
      const sitemap = lookups.sitemaps.get(normalizedId);
      return {
        componentId: component.id,
        componentType: component.componentType,
        componentTypeLabel: 'sitemap',
        objectId,
        name: sitemap?.name,
        status: sitemap ? 'resolved' : 'missing',
      };
    }
    default:
      return {
        componentId: component.id,
        componentType: component.componentType,
        componentTypeLabel: describeComponentType(component.componentType),
        objectId,
        status: 'missing',
      };
  }
}

function compareArtifacts(left: ModelCompositionArtifact, right: ModelCompositionArtifact): number {
  return (
    left.kind.localeCompare(right.kind) ||
    (left.name ?? left.logicalName ?? left.id ?? left.componentId ?? left.key).localeCompare(
      right.name ?? right.logicalName ?? right.id ?? right.componentId ?? right.key
    )
  );
}

function dedupeRelationships(relationships: ModelCompositionRelationship[]): ModelCompositionRelationship[] {
  const seen = new Set<string>();
  const deduped: ModelCompositionRelationship[] = [];

  for (const relationship of relationships) {
    const key = `${relationship.from}:${relationship.relation}:${relationship.to}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(relationship);
  }

  return deduped;
}

function isCompositionArtifactKind(value: string): value is ModelArtifactKind {
  return value === 'app' || value === 'table' || value === 'form' || value === 'view' || value === 'sitemap' || value === 'component';
}

function describeComponentType(componentType: number | undefined): string {
  switch (componentType) {
    case 1:
      return 'table';
    case 26:
      return 'view';
    case 60:
      return 'form';
    case 62:
      return 'sitemap';
    default:
      return componentType !== undefined ? `component-${componentType}` : 'unknown';
  }
}

function extractDisplayName(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object' && value !== null) {
    const localized = (value as { UserLocalizedLabel?: { Label?: string } }).UserLocalizedLabel;
    return localized?.Label;
  }

  return undefined;
}

function normalizeMetadataId(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

function mergeDiagnostics(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
}
