import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import type {
  MetadataQueryOptions,
  NormalizedMetadataQuery,
  ODataQueryOptions,
  QueryOptions,
  RelationshipMetadataKind,
} from './index';

export function buildQueryPath(options: QueryOptions): string {
  return buildODataPath(options.table, options);
}

export function buildODataPath(basePath: string, options: ODataQueryOptions): string {
  const params = new URLSearchParams();

  if (options.select?.length) {
    params.set('$select', options.select.join(','));
  }

  if (options.top !== undefined) {
    params.set('$top', String(options.top));
  }

  if (options.filter) {
    params.set('$filter', options.filter);
  }

  if (options.expand?.length) {
    params.set('$expand', options.expand.join(','));
  }

  if (options.orderBy?.length) {
    params.set('$orderby', options.orderBy.join(','));
  }

  if (options.count) {
    params.set('$count', 'true');
  }

  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export function buildEntityPath(
  table: string,
  id: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {},
): string {
  return buildODataPath(`${table}(${id})`, options);
}

export function buildDataverseActionPath(name: string, boundPath?: string): string {
  const normalizedName = name.trim();
  return boundPath ? `${trimDataversePath(boundPath)}/${normalizedName}` : normalizedName;
}

export function buildDataverseFunctionPath(
  name: string,
  parameters: Record<string, unknown> = {},
  boundPath?: string,
): OperationResult<string> {
  const normalizedName = name.trim();
  const aliases: string[] = [];
  const queryEntries: Array<[string, string]> = [];
  let aliasIndex = 0;

  for (const [key, value] of Object.entries(parameters)) {
    const alias = `@p${aliasIndex}`;
    const serialized = serializeDataverseFunctionParameter(value);

    if (!serialized.success || serialized.data === undefined) {
      return serialized as OperationResult<string>;
    }

    aliases.push(`${key}=${alias}`);
    queryEntries.push([alias, serialized.data]);
    aliasIndex += 1;
  }

  const actionPath = buildDataverseActionPath(normalizedName, boundPath);
  const basePath = aliases.length > 0 ? `${actionPath}(${aliases.join(',')})` : `${actionPath}()`;

  if (queryEntries.length === 0) {
    return ok(basePath, {
      supportTier: 'preview',
    });
  }

  const query = new URLSearchParams();
  for (const [key, value] of queryEntries) {
    query.set(key, value);
  }

  return ok(`${basePath}?${query.toString()}`, {
    supportTier: 'preview',
  });
}

export function buildCollectionPath(
  table: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {},
): string {
  return buildODataPath(table, options);
}

export function buildMetadataEntityPath(
  logicalName: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {},
): string {
  return buildODataPath(`EntityDefinitions(LogicalName='${escapeODataLiteral(logicalName)}')`, options);
}

export function buildAttributeCollectionPath(logicalName: string): string {
  return `${buildMetadataEntityPath(logicalName)}/Attributes`;
}

export function buildGlobalOptionSetPath(
  name: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {},
): string {
  return buildODataPath(`GlobalOptionSetDefinitions(Name='${escapeODataLiteral(name)}')`, options);
}

export function buildRelationshipPath(
  schemaName: string,
  kind: Exclude<RelationshipMetadataKind, 'auto'> = 'one-to-many',
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {},
): string {
  const suffix =
    kind === 'many-to-many'
      ? '/Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata'
      : '/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata';

  return buildODataPath(
    `RelationshipDefinitions(SchemaName='${escapeODataLiteral(schemaName)}')${suffix}`,
    options,
  );
}

export function buildMetadataAttributePath(
  tableLogicalName: string,
  columnLogicalName: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {},
): string {
  return buildODataPath(
    `${buildAttributeCollectionPath(tableLogicalName)}(LogicalName='${escapeODataLiteral(columnLogicalName)}')`,
    options,
  );
}

export function normalizeMetadataQueryOptions(
  basePath: string,
  options: MetadataQueryOptions,
): OperationResult<NormalizedMetadataQuery> {
  if (options.orderBy && options.orderBy.length > 0) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_METADATA_ORDERBY_UNSUPPORTED', 'Dataverse metadata queries do not support $orderby. Remove --orderby.', {
        source: '@pp/dataverse',
      }),
    );
  }

  if (options.count) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_METADATA_COUNT_UNSUPPORTED', 'Dataverse metadata queries do not support $count. Remove --count.', {
        source: '@pp/dataverse',
      }),
    );
  }

  const warnings: Diagnostic[] = [];

  if (options.top !== undefined) {
    warnings.push(
      createDiagnostic(
        'warning',
        'DATAVERSE_METADATA_TOP_CLIENT_SIDE',
        'Dataverse metadata queries do not support $top. The limit was applied client-side after retrieval.',
        {
          source: '@pp/dataverse',
          hint: 'This may require reading more metadata than the final result count.',
        },
      ),
    );
  }

  return ok(
    {
      path: buildODataPath(basePath, {
        select: options.select,
        filter: options.filter,
        expand: options.expand,
      }),
      top: options.top,
      fetchAll: Boolean(options.all || options.top !== undefined),
      warnings,
    },
    {
      supportTier: 'preview',
      warnings,
    },
  );
}

export function escapeODataLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function trimDataversePath(path: string): string {
  return path.replace(/^\/+/, '').trim();
}

function serializeDataverseFunctionParameter(value: unknown): OperationResult<string> {
  if (value === null) {
    return ok('null', {
      supportTier: 'preview',
    });
  }

  if (typeof value === 'string') {
    return ok(`'${escapeODataLiteral(value)}'`, {
      supportTier: 'preview',
    });
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return ok(String(value), {
      supportTier: 'preview',
    });
  }

  return fail(
    createDiagnostic(
      'error',
      'DATAVERSE_FUNCTION_PARAMETER_UNSUPPORTED',
      'Dataverse function parameters currently support string, number, boolean, and null values.',
      {
        source: '@pp/dataverse',
        detail: value === undefined ? 'undefined' : typeof value,
      },
    ),
  );
}
