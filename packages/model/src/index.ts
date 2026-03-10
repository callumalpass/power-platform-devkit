import {
  ModelDrivenAppService,
  type DataverseClient,
  type EntityDefinition,
  type ModelDrivenAppComponentSummary,
  type ModelDrivenAppFormSummary,
  type ModelDrivenAppSitemapSummary,
  type ModelDrivenAppSummary,
  type ModelDrivenAppViewSummary,
} from '@pp/dataverse';
import { ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { SolutionService } from '@pp/solution';

export type ModelAppSummary = ModelDrivenAppSummary;

export interface ModelTableSummary {
  id?: string;
  logicalName?: string;
  schemaName?: string;
  displayName?: string;
}

export type ModelFormSummary = ModelDrivenAppFormSummary;
export type ModelViewSummary = ModelDrivenAppViewSummary;
export type ModelSitemapSummary = ModelDrivenAppSitemapSummary;

export interface ModelDependencySummary {
  componentId: string;
  componentType?: number;
  componentTypeLabel: string;
  objectId?: string;
  name?: string;
  table?: string;
  status: 'resolved' | 'missing';
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

export class ModelService {
  constructor(private readonly dataverseClient: DataverseClient) {}

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
      const solutionComponents = await new SolutionService(this.dataverseClient).components(options.solutionUniqueName);

      if (!solutionComponents.success) {
        return solutionComponents as unknown as OperationResult<ModelAppSummary[]>;
      }

      allowedIds = new Set(
        (solutionComponents.data ?? [])
          .filter((component) => component.componentType === 80 && component.objectId)
          .map((component) => component.objectId as string)
      );
      diagnostics = [...diagnostics, ...solutionComponents.diagnostics];
      warnings = [...warnings, ...solutionComponents.warnings];
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
    const appService = new ModelDrivenAppService(this.dataverseClient);
    const apps = await this.list(options);

    if (!apps.success) {
      return apps as unknown as OperationResult<ModelInspectResult | undefined>;
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
      return components as unknown as OperationResult<ModelInspectResult | undefined>;
    }

    if (!forms.success) {
      return forms as unknown as OperationResult<ModelInspectResult | undefined>;
    }

    if (!views.success) {
      return views as unknown as OperationResult<ModelInspectResult | undefined>;
    }

    if (!sitemaps.success) {
      return sitemaps as unknown as OperationResult<ModelInspectResult | undefined>;
    }

    if (!tables.success) {
      return tables as unknown as OperationResult<ModelInspectResult | undefined>;
    }

    const tableMap = new Map<string, ModelTableSummary>(
      (tables.data ?? []).map((table) => [normalizeMetadataId(typeof table.MetadataId === 'string' ? table.MetadataId : undefined), normalizeTable(table)])
    );
    const formMap = new Map<string, ModelFormSummary>((forms.data ?? []).map((form) => [normalizeMetadataId(form.id), form]));
    const viewMap = new Map<string, ModelViewSummary>((views.data ?? []).map((view) => [normalizeMetadataId(view.id), view]));
    const sitemapMap = new Map<string, ModelSitemapSummary>((sitemaps.data ?? []).map((sitemap) => [normalizeMetadataId(sitemap.id), sitemap]));
    const appComponents = components.data ?? [];
    const dependencies = appComponents.map((component) => summarizeDependency(component, {
      tables: tableMap,
      forms: formMap,
      views: viewMap,
      sitemaps: sitemapMap,
    }));

    return ok(
      {
        app,
        sitemaps: dependencies.filter((item) => item.componentType === 62 && item.status === 'resolved').map((item) => sitemapMap.get(normalizeMetadataId(item.objectId))!).filter(Boolean),
        forms: dependencies.filter((item) => item.componentType === 60 && item.status === 'resolved').map((item) => formMap.get(normalizeMetadataId(item.objectId))!).filter(Boolean),
        views: dependencies.filter((item) => item.componentType === 26 && item.status === 'resolved').map((item) => viewMap.get(normalizeMetadataId(item.objectId))!).filter(Boolean),
        tables: dependencies.filter((item) => item.componentType === 1 && item.status === 'resolved').map((item) => tableMap.get(normalizeMetadataId(item.objectId))!).filter(Boolean),
        dependencies,
        missingComponents: dependencies.filter((item) => item.status === 'missing'),
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnostics(apps.diagnostics, components.diagnostics, forms.diagnostics, views.diagnostics, sitemaps.diagnostics, tables.diagnostics),
        warnings: mergeDiagnostics(apps.warnings, components.warnings, forms.warnings, views.warnings, sitemaps.warnings, tables.warnings),
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
}

function normalizeTable(definition: EntityDefinition): ModelTableSummary {
  return {
    id: typeof definition.MetadataId === 'string' ? definition.MetadataId : undefined,
    logicalName: typeof definition.LogicalName === 'string' ? definition.LogicalName : undefined,
    schemaName: typeof definition.SchemaName === 'string' ? definition.SchemaName : undefined,
    displayName: extractDisplayName(definition.DisplayName),
  };
}

function summarizeDependency(
  component: ModelDrivenAppComponentSummary,
  lookups: {
    tables: Map<string, ModelTableSummary>;
    forms: Map<string, ModelFormSummary>;
    views: Map<string, ModelViewSummary>;
    sitemaps: Map<string, ModelSitemapSummary>;
  }
): ModelDependencySummary {
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
