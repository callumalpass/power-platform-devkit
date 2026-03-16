import { dirname, resolve as resolvePath } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readJsonFile, writeJsonFile } from '@pp/artifacts';
import {
  buildMetadataContractSchema,
  buildMetadataScaffold,
  diffDataverseMetadataSnapshots,
  listColumnCreateKinds,
  normalizeAttributeDefinition,
  normalizeAttributeDefinitions,
  normalizeGlobalOptionSetDefinition,
  normalizeRelationshipDefinition,
  parseColumnCreateSpec,
  parseColumnUpdateSpec,
  parseCustomerRelationshipCreateSpec,
  parseGlobalOptionSetCreateSpec,
  parseGlobalOptionSetUpdateSpec,
  parseManyToManyRelationshipCreateSpec,
  parseManyToManyRelationshipUpdateSpec,
  parseMetadataApplyPlan,
  parseOneToManyRelationshipCreateSpec,
  parseOneToManyRelationshipUpdateSpec,
  parseTableCreateSpec,
  parseTableUpdateSpec,
  type AttributeMetadataView,
  type ColumnCreateKind,
  type DataverseBatchRequest,
  type DataverseMetadataApplyResult,
  type DataverseMetadataSnapshot,
  type DataverseRowApplyOperation,
  type MetadataApplyPlan,
  type RelationshipMetadataKind,
} from '@pp/dataverse';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { createSuccessPayload } from './contract';
import { enforceWriteAccessForCliArgs } from './cli-access';
import { resolveDataverseClientForCli } from './cli-resolution';
import {
  argumentFailure,
  hasFlag,
  isRecord,
  maybeHandleMutationPreview,
  outputFormat,
  positionalArgs,
  printByFormat,
  printFailure,
  printResultDiagnostics,
  printWarnings,
  readFlag,
  readHeaderFlags,
  readJsonBodyArgument,
  readListFlag,
  readNumberFlag,
  readRepeatedFlags,
  readStringArrayValue,
  readStructuredSpecArgument,
  readStructuredSpecFile,
  writeStructuredArtifact,
} from './cli-support';
import YAML from 'yaml';

type AttributeListView = Extract<AttributeMetadataView, 'common' | 'raw'>;

const ATTRIBUTE_COMMON_SELECT_FIELDS = [
  'LogicalName',
  'SchemaName',
  'DisplayName',
  'Description',
  'EntityLogicalName',
  'MetadataId',
  'AttributeType',
  'AttributeTypeName',
  'RequiredLevel',
  'IsPrimaryId',
  'IsPrimaryName',
  'IsCustomAttribute',
  'IsManaged',
  'IsLogical',
  'IsValidForCreate',
  'IsValidForRead',
  'IsValidForUpdate',
  'IsFilterable',
  'IsSearchable',
  'IsValidForAdvancedFind',
  'IsSecured',
] as const;
const ATTRIBUTE_SELECT_TO_NORMALIZED_FIELD = new Map<string, string>([
  ['LogicalName', 'logicalName'],
  ['SchemaName', 'schemaName'],
  ['DisplayName', 'displayName'],
  ['Description', 'description'],
  ['EntityLogicalName', 'entityLogicalName'],
  ['MetadataId', 'metadataId'],
  ['AttributeType', 'attributeType'],
  ['AttributeTypeName', 'attributeTypeName'],
  ['RequiredLevel', 'requiredLevel'],
  ['IsPrimaryId', 'primaryId'],
  ['IsPrimaryName', 'primaryName'],
  ['IsCustomAttribute', 'custom'],
  ['IsManaged', 'managed'],
  ['IsLogical', 'logical'],
  ['IsValidForCreate', 'createable'],
  ['IsValidForRead', 'readable'],
  ['IsValidForUpdate', 'updateable'],
  ['IsFilterable', 'filterable'],
  ['IsSearchable', 'searchable'],
  ['IsValidForAdvancedFind', 'advancedFind'],
  ['IsSecured', 'secured'],
]);
export async function runDataverseWhoAmI(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const whoAmI = await resolution.data.client.whoAmI();

  if (!whoAmI.success || !whoAmI.data) {
    return printFailure(whoAmI);
  }

  printByFormat(
    createSuccessPayload(
      {
        environment: resolution.data.environment.alias,
        url: resolution.data.environment.url,
        authProfile: resolution.data.authProfile.name,
        ...whoAmI.data,
      },
      whoAmI
    ),
    outputFormat(args, 'json')
  );
  return 0;
}

export async function runDataverseRequest(args: string[]): Promise<number> {
  const path = positionalArgs(args)[0];

  if (!path) {
    return printFailure(argumentFailure('DV_REQUEST_PATH_REQUIRED', 'Usage: dv request <path> --environment <alias> [--method GET|POST|PATCH|DELETE] [--body JSON|--body-file FILE]'));
  }

  const method = (readFlag(args, '--method') ?? 'GET').toUpperCase();
  const accessCheck = await enforceWriteAccessForCliArgs(args, 'dv.request', method !== 'GET');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const responseType = (readFlag(args, '--response-type') ?? 'json') as 'json' | 'text' | 'void';
  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (method !== 'GET') {
    const preview = maybeHandleMutationPreview(args, 'json', 'dv.request', { path, method }, body.data);

    if (preview !== undefined) {
      return preview;
    }
  }

  const response = await resolution.data.client.request<unknown>({
    path,
    method,
    body: body.data,
    responseType,
    headers: readHeaderFlags(args),
  });

  if (!response.success || !response.data) {
    return printFailure(response);
  }

  printByFormat(
    {
      status: response.data.status,
      headers: response.data.headers,
      body: response.data.data,
    },
    outputFormat(args, 'json')
  );
  return 0;
}

export async function runDataverseAction(args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('DV_ACTION_NAME_REQUIRED', 'Usage: dv action <name> --environment <alias> [--body JSON|--body-file FILE]'));
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'dv.action');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (body.data !== undefined && (!body.data || typeof body.data !== 'object' || Array.isArray(body.data))) {
    return printFailure(argumentFailure('DV_ACTION_BODY_INVALID', '--body or --body-file must contain a JSON object when provided.'));
  }

  const parameters = (body.data ?? {}) as Record<string, unknown>;
  const preview = maybeHandleMutationPreview(args, 'json', 'dv.action', { name, boundPath: readFlag(args, '--bound-path') }, parameters);

  if (preview !== undefined) {
    return preview;
  }

  const responseType = readDataverseResponseType(args);

  if (!responseType.success || !responseType.data) {
    return printFailure(responseType);
  }

  const result = await resolution.data.client.invokeAction<Record<string, unknown> | string | void>(name, parameters, {
    boundPath: readFlag(args, '--bound-path'),
    responseType: responseType.data,
    headers: readHeaderFlags(args),
    includeAnnotations: readListFlag(args, '--annotations'),
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseFunction(args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(
      argumentFailure(
        'DV_FUNCTION_NAME_REQUIRED',
        'Usage: dv function <name> --environment <alias> [--param key=value] [--param-json key=JSON]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const parameters = readDataverseFunctionParameters(args);

  if (!parameters.success || !parameters.data) {
    return printFailure(parameters);
  }

  const responseType = readDataverseResponseType(args);

  if (!responseType.success || !responseType.data) {
    return printFailure(responseType);
  }

  const result = await resolution.data.client.invokeFunction<Record<string, unknown> | string | void>(name, parameters.data, {
    boundPath: readFlag(args, '--bound-path'),
    responseType: responseType.data,
    headers: readHeaderFlags(args),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseBatch(args: string[]): Promise<number> {
  const batch = await readDataverseBatchArgument(args);

  if (!batch.success || !batch.data) {
    return printFailure(batch);
  }

  const hasMutation = batch.data.some((request) => (request.method ?? 'GET').toUpperCase() !== 'GET');
  const accessCheck = await enforceWriteAccessForCliArgs(args, 'dv.batch', hasMutation);

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
    'dv.batch',
    {
      requestCount: batch.data.length,
      continueOnError: hasFlag(args, '--continue-on-error'),
    },
    batch.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.executeBatch<Record<string, unknown> | string>(
    batch.data,
    {
      continueOnError: hasFlag(args, '--continue-on-error'),
      includeAnnotations: readListFlag(args, '--annotations'),
      solutionUniqueName: readFlag(args, '--solution'),
    }
  );

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data ?? [], result, { dataKey: 'runs' }), outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseRows(args: string[]): Promise<number> {
  const [action] = positionalArgs(args);

  if (!action) {
    return printFailure(
      argumentFailure('DV_ROWS_ACTION_REQUIRED', 'Use `dv rows export <table>` or `dv rows apply --file FILE`.')
    );
  }

  if (action === 'export') {
    return runDataverseRowsExport(args);
  }

  if (action === 'apply') {
    return runDataverseRowsApply(args);
  }

  return printFailure(argumentFailure('DV_ROWS_ACTION_INVALID', `Unsupported rows action ${action}.`));
}

export async function runDataverseRowsExport(args: string[]): Promise<number> {
  const table = positionalArgs(args)[1];

  if (!table) {
    return printFailure(argumentFailure('DV_ROWS_EXPORT_TABLE_REQUIRED', 'Usage: dv rows export <table> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.exportRows<Record<string, unknown>>({
    table,
    select: readListFlag(args, '--select'),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: readListFlag(args, '--expand'),
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    all: hasFlag(args, '--all'),
    solutionUniqueName: readFlag(args, '--solution'),
    diagnoseEmptyFilter: true,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const outPath = readFlag(args, '--out');

  if (outPath) {
    await writeStructuredArtifact(outPath, result.data);
    printByFormat(
      {
        outPath,
        table: result.data.table,
        recordCount: result.data.recordCount,
      },
      outputFormat(args, 'json')
    );
    return 0;
  }

  printWarnings(result);
  printByFormat(createSuccessPayload(result.data, result), outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseRowsApply(args: string[]): Promise<number> {
  const plan = await readDataverseRowsApplyArgument(args);

  if (!plan.success || !plan.data) {
    return printFailure(plan);
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'dv.rows.apply');

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
    'dv.rows.apply',
    {
      table: plan.data.table,
      operationCount: plan.data.operations.length,
      continueOnError: plan.data.continueOnError,
    },
    plan.data.operations
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.applyRows<Record<string, unknown>>(plan.data.operations, {
    table: plan.data.table,
    continueOnError: plan.data.continueOnError,
    includeAnnotations: readListFlag(args, '--annotations'),
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(
    {
      table: plan.data.table,
      operationCount: result.data?.length ?? 0,
      operations: result.data ?? [],
    },
    outputFormat(args, 'json')
  );
  return 0;
}

export async function runDataverseQuery(args: string[]): Promise<number> {
  const table = positionalArgs(args)[0];

  if (!table) {
    return printFailure(argumentFailure('DV_TABLE_REQUIRED', 'Usage: dv query <table> --environment ALIAS [--solution UNIQUE_NAME] [options]'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const queryOptions = {
    table,
    select: readListFlag(args, '--select'),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: readListFlag(args, '--expand'),
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    solutionUniqueName: readFlag(args, '--solution'),
    diagnoseEmptyFilter: true,
  };

  if (hasFlag(args, '--page-info')) {
    const page = await resolution.data.client.queryPage<Record<string, unknown>>(queryOptions);

    if (!page.success) {
      return printFailure(page);
    }

    printByFormat(page.data ?? { records: [] }, outputFormat(args, 'json'));
    return 0;
  }

  const result = hasFlag(args, '--all')
    ? await resolution.data.client.queryAll<Record<string, unknown>>(queryOptions)
    : await resolution.data.client.query<Record<string, unknown>>(queryOptions);

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(createSuccessPayload(result.data ?? [], result, { dataKey: 'runs' }), outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseGet(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_GET_ARGS_REQUIRED', 'Usage: dv get <table> <id> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getById<Record<string, unknown>>(table, id, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data, result), outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseCreate(args: string[]): Promise<number> {
  const table = positionalArgs(args)[0];

  if (!table) {
    return printFailure(argumentFailure('DV_TABLE_REQUIRED', 'Table logical name is required.'));
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'dv.create');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return printFailure(argumentFailure('DV_BODY_REQUIRED', '--body or --body-file must contain a JSON object.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.create', { table }, body.data as Record<string, unknown>);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.create<Record<string, unknown>, Record<string, unknown>>(table, body.data as Record<string, unknown>, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
    returnRepresentation: hasFlag(args, '--return-representation'),
    ifNoneMatch: readFlag(args, '--if-none-match'),
    ifMatch: readFlag(args, '--if-match'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseUpdate(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_UPDATE_ARGS_REQUIRED', 'Usage: dv update <table> <id> --environment <alias> --body <json>'));
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'dv.update');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return printFailure(argumentFailure('DV_BODY_REQUIRED', '--body or --body-file must contain a JSON object.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.update', { table, id }, body.data as Record<string, unknown>);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.update<Record<string, unknown>, Record<string, unknown>>(
    table,
    id,
    body.data as Record<string, unknown>,
    {
      select: readListFlag(args, '--select'),
      expand: readListFlag(args, '--expand'),
      includeAnnotations: readListFlag(args, '--annotations'),
      returnRepresentation: hasFlag(args, '--return-representation'),
      ifMatch: readFlag(args, '--if-match'),
      ifNoneMatch: readFlag(args, '--if-none-match'),
    }
  );

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseDelete(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_DELETE_ARGS_REQUIRED', 'Usage: dv delete <table> <id> --environment <alias>'));
  }

  const accessCheck = await enforceWriteAccessForCliArgs(args, 'dv.delete');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.delete', { table, id });

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.delete(table, id, {
    ifMatch: readFlag(args, '--if-match'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadata(args: string[]): Promise<number> {
  const [action] = positionalArgs(args);

  if (!action) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_ACTION_REQUIRED',
        'Use `dv metadata tables`, `dv metadata table <logicalName>`, `dv metadata columns <table>`, `dv metadata column <table> <column>`, `dv metadata option-set <name>`, `dv metadata relationship <schemaName>`, `dv metadata snapshot ...`, `dv metadata diff`, `dv metadata schema ...`, `dv metadata init ...`, `dv metadata apply`, `dv metadata create-table`, `dv metadata update-table`, `dv metadata add-column`, `dv metadata update-column`, `dv metadata create-option-set`, `dv metadata update-option-set`, `dv metadata create-relationship`, `dv metadata update-relationship`, `dv metadata create-many-to-many`, or `dv metadata create-customer-relationship`.'
      )
    );
  }

  if (new Set([
    'apply',
    'create-table',
    'update-table',
    'add-column',
    'update-column',
    'create-option-set',
    'update-option-set',
    'create-relationship',
    'update-relationship',
    'create-many-to-many',
    'create-customer-relationship',
  ]).has(action)) {
    const accessCheck = await enforceWriteAccessForCliArgs(args, `dv.metadata.${action}`);

    if (accessCheck !== undefined) {
      return accessCheck;
    }
  }

  if (action === 'tables') {
    return runDataverseMetadataTables(args);
  }

  if (action === 'table') {
    return runDataverseMetadataTable(args);
  }

  if (action === 'columns') {
    return runDataverseMetadataColumns(args);
  }

  if (action === 'column') {
    return runDataverseMetadataColumn(args);
  }

  if (action === 'option-set') {
    return runDataverseMetadataOptionSet(args);
  }

  if (action === 'relationship') {
    return runDataverseMetadataRelationship(args);
  }

  if (action === 'snapshot') {
    return runDataverseMetadataSnapshot(args);
  }

  if (action === 'diff') {
    return runDataverseMetadataDiff(args);
  }

  if (action === 'schema') {
    return runDataverseMetadataSchema(args);
  }

  if (action === 'init') {
    return runDataverseMetadataInit(args);
  }

  if (action === 'apply') {
    return runDataverseMetadataApply(args);
  }

  if (action === 'create-table') {
    return runDataverseMetadataCreateTable(args);
  }

  if (action === 'update-table') {
    return runDataverseMetadataUpdateTable(args);
  }

  if (action === 'add-column') {
    return runDataverseMetadataAddColumn(args);
  }

  if (action === 'update-column') {
    return runDataverseMetadataUpdateColumn(args);
  }

  if (action === 'create-option-set') {
    return runDataverseMetadataCreateOptionSet(args);
  }

  if (action === 'update-option-set') {
    return runDataverseMetadataUpdateOptionSet(args);
  }

  if (action === 'create-relationship') {
    return runDataverseMetadataCreateRelationship(args);
  }

  if (action === 'update-relationship') {
    return runDataverseMetadataUpdateRelationship(args);
  }

  if (action === 'create-many-to-many') {
    return runDataverseMetadataCreateManyToManyRelationship(args);
  }

  if (action === 'create-customer-relationship') {
    return runDataverseMetadataCreateCustomerRelationship(args);
  }

  return printFailure(argumentFailure('DV_METADATA_ACTION_INVALID', `Unsupported metadata action ${action}.`));
}

export async function runDataverseMetadataTables(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.listTables({
    select: readListFlag(args, '--select'),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: readListFlag(args, '--expand'),
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    all: hasFlag(args, '--all'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(createSuccessPayload(result.data ?? [], result, { dataKey: 'runs' }), outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataTable(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const logicalName = positional[1];

  if (!logicalName) {
    return printFailure(argumentFailure('DV_METADATA_TABLE_REQUIRED', 'Usage: dv metadata table <logicalName> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getTable(logicalName, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(createSuccessPayload(result.data, result), outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataColumns(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const logicalName = positional[1];

  if (!logicalName) {
    return printFailure(argumentFailure('DV_METADATA_COLUMNS_TABLE_REQUIRED', 'Usage: dv metadata columns <tableLogicalName> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const view = readAttributeListView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const requestedSelect = readListFlag(args, '--select');
  const result = await resolution.data.client.listColumns(logicalName, {
    select: view.data === 'raw' ? requestedSelect : mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, requestedSelect),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: view.data === 'raw' ? readListFlag(args, '--expand') : undefined,
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    all: hasFlag(args, '--all'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  const payload =
    view.data === 'raw'
      ? result.data ?? []
      : projectNormalizedAttributeSelection(normalizeAttributeDefinitions(result.data ?? [], 'common'), requestedSelect);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

function projectNormalizedAttributeSelection<T extends object>(
  attributes: T[],
  requestedSelect: string[] | undefined,
): Array<Record<string, unknown>> {
  if (!requestedSelect || requestedSelect.length === 0) {
    return attributes as Array<Record<string, unknown>>;
  }

  const selectedKeys = Array.from(
    new Set(
      requestedSelect
        .map((field) => ATTRIBUTE_SELECT_TO_NORMALIZED_FIELD.get(field) ?? field)
        .filter((field) => typeof field === 'string' && field.length > 0),
    ),
  );

  return attributes.map((attribute) => {
    const record = attribute as Record<string, unknown>;
    return Object.fromEntries(selectedKeys.filter((key) => key in record).map((key) => [key, record[key]]));
  });
}

export async function runDataverseMetadataColumn(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];
  const columnLogicalName = positional[2];

  if (!tableLogicalName || !columnLogicalName) {
    return printFailure(
      argumentFailure('DV_METADATA_COLUMN_REQUIRED', 'Usage: dv metadata column <tableLogicalName> <columnLogicalName> --environment <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const view = readAttributeDetailView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const result = await resolution.data.client.getColumn(tableLogicalName, columnLogicalName, {
    select:
      view.data === 'raw'
        ? readListFlag(args, '--select')
        : view.data === 'common'
          ? mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, readListFlag(args, '--select'))
          : readListFlag(args, '--select')
            ? mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, readListFlag(args, '--select'))
            : undefined,
    expand: view.data === 'raw' ? readListFlag(args, '--expand') : undefined,
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  const payload = view.data === 'raw' ? result.data : normalizeAttributeDefinition(result.data, view.data);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataOptionSet(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const name = positional[1];

  if (!name) {
    return printFailure(argumentFailure('DV_METADATA_OPTION_SET_REQUIRED', 'Usage: dv metadata option-set <name> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getGlobalOptionSet(name, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const view = readMetadataInspectView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const payload = view.data === 'raw' ? result.data : normalizeGlobalOptionSetDefinition(result.data);
  printWarnings(result);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataRelationship(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const schemaName = positional[1];

  if (!schemaName) {
    return printFailure(argumentFailure('DV_METADATA_RELATIONSHIP_REQUIRED', 'Usage: dv metadata relationship <schemaName> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const kind = readRelationshipKind(args);

  if (!kind.success || !kind.data) {
    return printFailure(kind);
  }

  const result = await resolution.data.client.getRelationship(schemaName, {
    kind: kind.data,
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const view = readMetadataInspectView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const payload = view.data === 'raw' ? result.data : normalizeRelationshipDefinition(result.data);
  printWarnings(result);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataSnapshot(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const domain = positional[1];

  if (!domain) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_SNAPSHOT_DOMAIN_REQUIRED',
        'Usage: dv metadata snapshot <table|columns|option-set|relationship> ... --environment <alias>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  let snapshot;

  if (domain === 'table') {
    const logicalName = positional[2];

    if (!logicalName) {
      return printFailure(
        argumentFailure('DV_METADATA_SNAPSHOT_TABLE_REQUIRED', 'Usage: dv metadata snapshot table <logicalName> --environment <alias>')
      );
    }

    snapshot = await resolution.data.client.snapshotTableMetadata(logicalName);
  } else if (domain === 'columns') {
    const logicalName = positional[2];

    if (!logicalName) {
      return printFailure(
        argumentFailure(
          'DV_METADATA_SNAPSHOT_COLUMNS_REQUIRED',
          'Usage: dv metadata snapshot columns <tableLogicalName> --environment <alias>'
        )
      );
    }

    snapshot = await resolution.data.client.snapshotColumnsMetadata(logicalName);
  } else if (domain === 'option-set') {
    const name = positional[2];

    if (!name) {
      return printFailure(
        argumentFailure('DV_METADATA_SNAPSHOT_OPTION_SET_REQUIRED', 'Usage: dv metadata snapshot option-set <name> --environment <alias>')
      );
    }

    snapshot = await resolution.data.client.snapshotOptionSetMetadata(name);
  } else if (domain === 'relationship') {
    const schemaName = positional[2];

    if (!schemaName) {
      return printFailure(
        argumentFailure(
          'DV_METADATA_SNAPSHOT_RELATIONSHIP_REQUIRED',
          'Usage: dv metadata snapshot relationship <schemaName> --environment <alias>'
        )
      );
    }

    const kind = readRelationshipKind(args);

    if (!kind.success || !kind.data) {
      return printFailure(kind);
    }

    snapshot = await resolution.data.client.snapshotRelationshipMetadata(schemaName, kind.data);
  } else {
    return printFailure(
      argumentFailure(
        'DV_METADATA_SNAPSHOT_DOMAIN_INVALID',
        `Unsupported snapshot domain ${domain}. Use table, columns, option-set, or relationship.`
      )
    );
  }

  if (!snapshot.success || !snapshot.data) {
    return printFailure(snapshot);
  }

  const outPath = readFlag(args, '--out');

  if (outPath) {
    await writeJsonFile(outPath, snapshot.data as never);
  }

  printWarnings(snapshot);
  printByFormat(snapshot.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataDiff(args: string[]): Promise<number> {
  const leftPath = readFlag(args, '--left');
  const rightPath = readFlag(args, '--right');

  if (!leftPath || !rightPath) {
    return printFailure(argumentFailure('DV_METADATA_DIFF_ARGS_REQUIRED', 'Usage: dv metadata diff --left FILE --right FILE'));
  }

  const [leftSnapshot, rightSnapshot] = await Promise.all([
    readJsonFile<DataverseMetadataSnapshot>(leftPath),
    readJsonFile<DataverseMetadataSnapshot>(rightPath),
  ]);
  const result = diffDataverseMetadataSnapshots(leftSnapshot, rightSnapshot);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataSchema(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const action = positional[1];

  if (action !== 'create-table' && action !== 'add-column') {
    return printFailure(
      argumentFailure(
        'DV_METADATA_SCHEMA_ACTION_REQUIRED',
        'Usage: dv metadata schema <create-table|add-column> [--kind KIND] [--format json-schema]'
      )
    );
  }

  const schemaFormat = readFlag(args, '--format') ?? 'json-schema';
  if (schemaFormat !== 'json-schema') {
    return printFailure(
      argumentFailure('DV_METADATA_SCHEMA_FORMAT_INVALID', 'dv metadata schema only supports --format json-schema.')
    );
  }

  const kind = readMetadataColumnKind(args);
  if (!kind.success) {
    return printFailure(kind);
  }

  if (action === 'create-table' && kind.data) {
    return printFailure(
      argumentFailure('DV_METADATA_SCHEMA_KIND_UNSUPPORTED', 'dv metadata schema create-table does not accept --kind.')
    );
  }

  const result = buildMetadataContractSchema(action, { kind: kind.data });
  if (!result.success || !result.data) {
    return printFailure(result);
  }

  process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
  return 0;
}

export async function runDataverseMetadataInit(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const action = positional[1];

  if (action !== 'create-table' && action !== 'add-column') {
    return printFailure(
      argumentFailure('DV_METADATA_INIT_ACTION_REQUIRED', 'Usage: dv metadata init <create-table|add-column> [--kind KIND] [--format json|yaml]')
    );
  }

  const kind = readMetadataColumnKind(args);
  if (!kind.success) {
    return printFailure(kind);
  }

  if (action === 'create-table' && kind.data) {
    return printFailure(argumentFailure('DV_METADATA_INIT_KIND_UNSUPPORTED', 'dv metadata init create-table does not accept --kind.'));
  }

  const result = buildMetadataScaffold(action, { kind: kind.data });
  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'yaml'));
  return 0;
}

export async function runDataverseMetadataApply(args: string[]): Promise<number> {
  const plan = await readMetadataApplyPlanArgument(args);

  if (!plan.success || !plan.data) {
    return printFailure(plan);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const orderedPlan = orderMetadataApplyPlanForCli(plan.data);

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.apply', { solution: writeOptions.data?.solutionUniqueName }, orderedPlan);

  if (preview !== undefined) {
    return preview;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  process.stderr.write(buildMetadataApplyStartMessage(orderedPlan, writeOptions.data));
  const result = await resolution.data.client.applyMetadataPlan(orderedPlan, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  process.stderr.write(buildMetadataApplyCompletionMessage(result.data));
  printWarnings(result);
  printByFormat(normalizeMetadataApplyResultForOutput(result.data), outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataCreateTable(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_TABLE_FILE_REQUIRED',
    'Usage: dv metadata create-table --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseTableCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-table', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createTable(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataUpdateTable(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];

  if (!tableLogicalName) {
    return printFailure(
      argumentFailure('DV_METADATA_UPDATE_TABLE_REQUIRED', 'Usage: dv metadata update-table <tableLogicalName> --file FILE --environment <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_TABLE_FILE_REQUIRED',
    'Usage: dv metadata update-table <tableLogicalName> --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseTableUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'dv.metadata.update-table',
    { tableLogicalName, solution: writeOptions.data?.solutionUniqueName },
    spec.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateTable(tableLogicalName, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataAddColumn(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];

  if (!tableLogicalName) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_ADD_COLUMN_TABLE_REQUIRED',
        'Usage: dv metadata add-column <tableLogicalName> --file FILE --environment <alias>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_ADD_COLUMN_FILE_REQUIRED',
    'Usage: dv metadata add-column <tableLogicalName> --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseColumnCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.add-column', { tableLogicalName, solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createColumn(tableLogicalName, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataUpdateColumn(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];
  const columnLogicalName = positional[2];

  if (!tableLogicalName || !columnLogicalName) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_UPDATE_COLUMN_REQUIRED',
        'Usage: dv metadata update-column <tableLogicalName> <columnLogicalName> --file FILE --environment <alias>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_COLUMN_FILE_REQUIRED',
    'Usage: dv metadata update-column <tableLogicalName> <columnLogicalName> --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseColumnUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'dv.metadata.update-column',
    { tableLogicalName, columnLogicalName, solution: writeOptions.data?.solutionUniqueName },
    spec.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateColumn(tableLogicalName, columnLogicalName, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataCreateOptionSet(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_OPTION_SET_FILE_REQUIRED',
    'Usage: dv metadata create-option-set --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseGlobalOptionSetCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-option-set', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createGlobalOptionSet(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataUpdateOptionSet(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_OPTION_SET_FILE_REQUIRED',
    'Usage: dv metadata update-option-set --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseGlobalOptionSetUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.update-option-set', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateGlobalOptionSet(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataCreateRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_RELATIONSHIP_FILE_REQUIRED',
    'Usage: dv metadata create-relationship --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseOneToManyRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-relationship', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createOneToManyRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataUpdateRelationship(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const schemaName = positional[1];

  if (!schemaName) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_UPDATE_RELATIONSHIP_REQUIRED',
        'Usage: dv metadata update-relationship <schemaName> --kind one-to-many|many-to-many --file FILE --environment <alias>'
      )
    );
  }

  const kind = readRelationshipKind(args);

  if (!kind.success || !kind.data) {
    return printFailure(kind);
  }

  if (kind.data === 'auto') {
    return printFailure(
      argumentFailure(
        'DV_METADATA_UPDATE_RELATIONSHIP_KIND_REQUIRED',
        'dv metadata update-relationship requires --kind one-to-many or --kind many-to-many.'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_RELATIONSHIP_FILE_REQUIRED',
    'Usage: dv metadata update-relationship <schemaName> --kind one-to-many|many-to-many --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec =
    kind.data === 'one-to-many' ? parseOneToManyRelationshipUpdateSpec(specInput.data) : parseManyToManyRelationshipUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'dv.metadata.update-relationship',
    { schemaName, relationshipKind: kind.data, solution: writeOptions.data?.solutionUniqueName },
    spec.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateRelationship(schemaName, kind.data, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataCreateManyToManyRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_MANY_TO_MANY_FILE_REQUIRED',
    'Usage: dv metadata create-many-to-many --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseManyToManyRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-many-to-many', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createManyToManyRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runDataverseMetadataCreateCustomerRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_CUSTOMER_RELATIONSHIP_FILE_REQUIRED',
    'Usage: dv metadata create-customer-relationship --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseCustomerRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-customer-relationship', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createCustomerRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

function readMetadataCreateOptions(
  args: string[]
): OperationResult<{
  solutionUniqueName?: string;
  languageCode?: number;
  publish?: boolean;
  includeAnnotations?: string[];
}> {
  const languageCode = readNumberFlag(args, '--language-code');

  if (languageCode !== undefined && (!Number.isInteger(languageCode) || languageCode <= 0)) {
    return argumentFailure('DV_METADATA_LANGUAGE_CODE_INVALID', '--language-code must be a positive integer.');
  }

  return ok(
    {
      solutionUniqueName: readFlag(args, '--solution'),
      languageCode,
      publish: hasFlag(args, '--no-publish') ? false : true,
      includeAnnotations: readListFlag(args, '--annotations'),
    },
    {
      supportTier: 'preview',
    }
  );
}

function readAttributeListView(args: string[]): OperationResult<AttributeListView> {
  const view = readFlag(args, '--view') ?? 'common';

  if (view === 'common' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_COLUMNS_VIEW_INVALID', 'Unsupported --view for `dv metadata columns`. Use `common` or `raw`.');
}

function readAttributeDetailView(args: string[]): OperationResult<AttributeMetadataView> {
  const view = readFlag(args, '--view') ?? 'detailed';

  if (view === 'common' || view === 'detailed' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_COLUMN_VIEW_INVALID', 'Unsupported --view for `dv metadata column`. Use `common`, `detailed`, or `raw`.');
}

function readMetadataInspectView(args: string[]): OperationResult<'normalized' | 'raw'> {
  const view = readFlag(args, '--view') ?? 'normalized';

  if (view === 'normalized' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_VIEW_INVALID', 'Unsupported --view. Use `normalized` or `raw`.');
}

function readMetadataColumnKind(args: string[]): OperationResult<ColumnCreateKind | undefined> {
  const kind = readFlag(args, '--kind');

  if (!kind) {
    return ok(undefined, {
      supportTier: 'preview',
    });
  }

  if (listColumnCreateKinds().includes(kind as ColumnCreateKind)) {
    return ok(kind as ColumnCreateKind, {
      supportTier: 'preview',
    });
  }

  return argumentFailure(
    'DV_METADATA_COLUMN_KIND_INVALID',
    `Unsupported --kind. Use ${listColumnCreateKinds().join(', ')}.`
  );
}

function readRelationshipKind(args: string[]): OperationResult<RelationshipMetadataKind> {
  const kind = readFlag(args, '--kind') ?? 'auto';

  if (kind === 'auto' || kind === 'one-to-many' || kind === 'many-to-many') {
    return ok(kind, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_RELATIONSHIP_KIND_INVALID', 'Unsupported --kind. Use `auto`, `one-to-many`, or `many-to-many`.');
}

function orderMetadataApplyPlanForCli(plan: MetadataApplyPlan): MetadataApplyPlan {
  const precedence: Record<MetadataApplyPlan['operations'][number]['kind'], number> = {
    'create-option-set': 10,
    'update-option-set': 20,
    'create-table': 30,
    'update-table': 40,
    'add-column': 50,
    'update-column': 60,
    'create-relationship': 70,
    'update-relationship': 80,
    'create-many-to-many': 90,
    'create-customer-relationship': 100,
  };

  return {
    operations: plan.operations
      .map((operation, index) => ({ operation, index }))
      .sort((left, right) => {
        const precedenceDelta = precedence[left.operation.kind] - precedence[right.operation.kind];
        return precedenceDelta !== 0 ? precedenceDelta : left.index - right.index;
      })
      .map((entry) => entry.operation),
  };
}

function mergeUniqueStrings(base: readonly string[], extra: string[] | undefined): string[] {
  return [...new Set([...base, ...(extra ?? [])])];
}

function readDataverseResponseType(args: string[]): OperationResult<'json' | 'text' | 'void'> {
  const value = readFlag(args, '--response-type') ?? 'json';

  if (value === 'json' || value === 'text' || value === 'void') {
    return ok(value, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_RESPONSE_TYPE_INVALID', 'Unsupported --response-type. Use `json`, `text`, or `void`.');
}

function readDataverseFunctionParameters(args: string[]): OperationResult<Record<string, unknown>> {
  const parameters: Record<string, unknown> = {};

  for (const entry of readRepeatedFlags(args, '--param')) {
    const separatorIndex = entry.indexOf('=');

    if (separatorIndex <= 0) {
      return argumentFailure('DV_FUNCTION_PARAM_INVALID', 'Use `--param key=value` for Dataverse function parameters.');
    }

    parameters[entry.slice(0, separatorIndex)] = entry.slice(separatorIndex + 1);
  }

  for (const entry of readRepeatedFlags(args, '--param-json')) {
    const separatorIndex = entry.indexOf('=');

    if (separatorIndex <= 0) {
      return argumentFailure('DV_FUNCTION_PARAM_JSON_INVALID', 'Use `--param-json key=JSON` for typed Dataverse function parameters.');
    }

    const key = entry.slice(0, separatorIndex);
    const rawValue = entry.slice(separatorIndex + 1);

    try {
      parameters[key] = JSON.parse(rawValue);
    } catch (error) {
      return fail(
        createDiagnostic('error', 'DV_FUNCTION_PARAM_JSON_INVALID', `Failed to parse JSON value for function parameter ${key}.`, {
          source: '@pp/cli',
          detail: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  return ok(parameters, {
    supportTier: 'preview',
  });
}

async function readDataverseBatchArgument(args: string[]): Promise<OperationResult<DataverseBatchRequest[]>> {
  const file = readFlag(args, '--file');

  if (!file) {
    return argumentFailure('DV_BATCH_FILE_REQUIRED', 'Usage: dv batch --file FILE --environment <alias>');
  }

  const document = await readStructuredSpecFile(file);

  if (!document.success || !document.data) {
    return document as unknown as OperationResult<DataverseBatchRequest[]>;
  }

  if (!isRecord(document.data)) {
    return fail(
      createDiagnostic('error', 'DV_BATCH_SPEC_INVALID', 'Dataverse batch files must parse to an object with a requests array.', {
        source: '@pp/cli',
        path: file,
      })
    );
  }

  const requests = document.data.requests;

  if (!Array.isArray(requests) || requests.length === 0) {
    return fail(
      createDiagnostic('error', 'DV_BATCH_REQUESTS_REQUIRED', 'Dataverse batch files require a non-empty requests array.', {
        source: '@pp/cli',
        path: file,
      })
    );
  }

  const normalized: DataverseBatchRequest[] = [];

  for (let index = 0; index < requests.length; index += 1) {
    const entry = requests[index];

    if (!isRecord(entry)) {
      return fail(
        createDiagnostic('error', 'DV_BATCH_REQUEST_INVALID', `Batch request ${index + 1} must be an object.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    const method = typeof entry.method === 'string' ? entry.method.toUpperCase() : undefined;
    const path = typeof entry.path === 'string' ? entry.path : undefined;

    if (!path || !method || !['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      return fail(
        createDiagnostic(
          'error',
          'DV_BATCH_REQUEST_INVALID',
          `Batch request ${index + 1} must include method GET|POST|PATCH|DELETE and path.`,
          {
            source: '@pp/cli',
            path: file,
          }
        )
      );
    }

    if (entry.headers !== undefined && !isRecord(entry.headers)) {
      return fail(
        createDiagnostic('error', 'DV_BATCH_HEADERS_INVALID', `Batch request ${index + 1} headers must be an object when provided.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    normalized.push({
      id: typeof entry.id === 'string' ? entry.id : undefined,
      method: method as DataverseBatchRequest['method'],
      path,
      headers: entry.headers as Record<string, string> | undefined,
      body: entry.body,
      atomicGroup: typeof entry.atomicGroup === 'string' ? entry.atomicGroup : undefined,
    });
  }

  return ok(normalized, {
    supportTier: 'preview',
  });
}

async function readDataverseRowsApplyArgument(
  args: string[]
): Promise<OperationResult<{ table?: string; continueOnError: boolean; operations: DataverseRowApplyOperation[] }>> {
  const file = readFlag(args, '--file');

  if (!file) {
    return argumentFailure('DV_ROWS_APPLY_FILE_REQUIRED', 'Usage: dv rows apply --file FILE --environment <alias>');
  }

  const document = await readStructuredSpecFile(file);

  if (!document.success || !document.data) {
    return document as unknown as OperationResult<{ table?: string; continueOnError: boolean; operations: DataverseRowApplyOperation[] }>;
  }

  if (!isRecord(document.data)) {
    return fail(
      createDiagnostic('error', 'DV_ROWS_APPLY_SPEC_INVALID', 'Row apply files must parse to an object.', {
        source: '@pp/cli',
        path: file,
      })
    );
  }

  const defaultTable = typeof document.data.table === 'string' ? document.data.table : undefined;
  const continueOnError = hasFlag(args, '--continue-on-error') || document.data.continueOnError === true;
  const operationsValue = document.data.operations;

  if (!Array.isArray(operationsValue) || operationsValue.length === 0) {
    return fail(
      createDiagnostic('error', 'DV_ROWS_APPLY_OPERATIONS_REQUIRED', 'Row apply files require a non-empty operations array.', {
        source: '@pp/cli',
        path: file,
      })
    );
  }

  const operations: DataverseRowApplyOperation[] = [];

  for (let index = 0; index < operationsValue.length; index += 1) {
    const entry = operationsValue[index];

    if (!isRecord(entry)) {
      return fail(
        createDiagnostic('error', 'DV_ROWS_APPLY_OPERATION_INVALID', `Row operation ${index + 1} must be an object.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    const kind = entry.kind;

    if (kind !== 'create' && kind !== 'update' && kind !== 'upsert' && kind !== 'delete') {
      return fail(
        createDiagnostic('error', 'DV_ROWS_APPLY_KIND_INVALID', `Row operation ${index + 1} has unsupported kind ${String(kind)}.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    if (entry.headers !== undefined && !isRecord(entry.headers)) {
      return fail(
        createDiagnostic('error', 'DV_ROWS_APPLY_HEADERS_INVALID', `Row operation ${index + 1} headers must be an object when provided.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    const body = entry.body;

    if (body !== undefined && !isRecord(body)) {
      return fail(
        createDiagnostic('error', 'DV_ROWS_APPLY_BODY_INVALID', `Row operation ${index + 1} body must be an object when provided.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    operations.push({
      kind,
      requestId: typeof entry.requestId === 'string' ? entry.requestId : undefined,
      table: typeof entry.table === 'string' ? entry.table : undefined,
      recordId: typeof entry.recordId === 'string' ? entry.recordId : undefined,
      path: typeof entry.path === 'string' ? entry.path : undefined,
      body: body as Record<string, unknown> | undefined,
      headers: entry.headers as Record<string, string> | undefined,
      atomicGroup: typeof entry.atomicGroup === 'string' ? entry.atomicGroup : undefined,
      ifMatch: typeof entry.ifMatch === 'string' ? entry.ifMatch : undefined,
      ifNoneMatch: typeof entry.ifNoneMatch === 'string' ? entry.ifNoneMatch : undefined,
      returnRepresentation: entry.returnRepresentation === true,
      select: readStringArrayValue(entry.select),
      expand: readStringArrayValue(entry.expand),
      prefer: readStringArrayValue(entry.prefer),
    });
  }

  return ok(
    {
      table: defaultTable,
      continueOnError,
      operations,
    },
    {
      supportTier: 'preview',
    }
  );
}

async function readMetadataApplyPlanArgument(args: string[]): Promise<OperationResult<MetadataApplyPlan>> {
  const manifestPath = readFlag(args, '--file');

  if (!manifestPath) {
    return argumentFailure('DV_METADATA_APPLY_FILE_REQUIRED', 'Usage: dv metadata apply --file FILE --environment <alias>');
  }

  const manifest = await readStructuredSpecFile(manifestPath);

  if (!manifest.success || manifest.data === undefined) {
    return manifest as OperationResult<MetadataApplyPlan>;
  }

  if (!isRecord(manifest.data)) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_INVALID', 'Structured spec files must parse to an object.', {
        source: '@pp/cli',
        path: manifestPath,
      })
    );
  }

  const operationsValue = manifest.data.operations;

  if (!Array.isArray(operationsValue) || operationsValue.length === 0) {
    return fail(
      createDiagnostic('error', 'DV_METADATA_APPLY_OPERATIONS_REQUIRED', 'Metadata apply manifests require a non-empty operations array.', {
        source: '@pp/cli',
        path: manifestPath,
      })
    );
  }

  const loadedOperations: unknown[] = [];

  for (let index = 0; index < operationsValue.length; index += 1) {
    const entry = operationsValue[index];

    if (!isRecord(entry)) {
      return fail(
        createDiagnostic('error', 'DV_METADATA_APPLY_OPERATION_INVALID', `Operation ${index + 1} must be an object.`, {
          source: '@pp/cli',
          path: manifestPath,
        })
      );
    }

    const kind = typeof entry.kind === 'string' ? entry.kind : undefined;
    const specFile = typeof entry.file === 'string' ? entry.file : undefined;

    if (!kind || !specFile) {
      return fail(
        createDiagnostic(
          'error',
          'DV_METADATA_APPLY_OPERATION_INVALID',
          `Operation ${index + 1} must include string values for kind and file.`,
          {
            source: '@pp/cli',
            path: manifestPath,
          }
        )
      );
    }

    const childPath = resolvePath(dirname(manifestPath), specFile);
    const childSpec = await readStructuredSpecFile(childPath);

    if (!childSpec.success || childSpec.data === undefined) {
      return childSpec as unknown as OperationResult<MetadataApplyPlan>;
    }

    switch (kind) {
      case 'create-table': {
        const spec = parseTableCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-table': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;

        if (!tableLogicalName) {
          return fail(
            createDiagnostic(
              'error',
              'DV_METADATA_APPLY_TABLE_REQUIRED',
              `Operation ${index + 1} must include tableLogicalName for update-table.`,
              {
                source: '@pp/cli',
                path: manifestPath,
              }
            )
          );
        }

        const spec = parseTableUpdateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, tableLogicalName, spec: spec.data });
        break;
      }
      case 'add-column': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;

        if (!tableLogicalName) {
          return fail(
            createDiagnostic(
              'error',
              'DV_METADATA_APPLY_TABLE_REQUIRED',
              `Operation ${index + 1} must include tableLogicalName for add-column.`,
              {
                source: '@pp/cli',
                path: manifestPath,
              }
            )
          );
        }

        const spec = parseColumnCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, tableLogicalName, spec: spec.data });
        break;
      }
      case 'update-column': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;
        const columnLogicalName = typeof entry.columnLogicalName === 'string' ? entry.columnLogicalName : undefined;

        if (!tableLogicalName || !columnLogicalName) {
          return fail(
            createDiagnostic(
              'error',
              'DV_METADATA_APPLY_COLUMN_REQUIRED',
              `Operation ${index + 1} must include tableLogicalName and columnLogicalName for update-column.`,
              {
                source: '@pp/cli',
                path: manifestPath,
              }
            )
          );
        }

        const spec = parseColumnUpdateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, tableLogicalName, columnLogicalName, spec: spec.data });
        break;
      }
      case 'create-option-set': {
        const spec = parseGlobalOptionSetCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-option-set': {
        const spec = parseGlobalOptionSetUpdateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'create-relationship': {
        const spec = parseOneToManyRelationshipCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-relationship': {
        const schemaName = typeof entry.schemaName === 'string' ? entry.schemaName : undefined;
        const relationshipKind =
          entry.relationshipKind === 'one-to-many' || entry.relationshipKind === 'many-to-many'
            ? entry.relationshipKind
            : undefined;

        if (!schemaName || !relationshipKind) {
          return fail(
            createDiagnostic(
              'error',
              'DV_METADATA_APPLY_RELATIONSHIP_REQUIRED',
              `Operation ${index + 1} must include schemaName and relationshipKind for update-relationship.`,
              {
                source: '@pp/cli',
                path: manifestPath,
              }
            )
          );
        }

        const spec =
          relationshipKind === 'one-to-many'
            ? parseOneToManyRelationshipUpdateSpec(childSpec.data)
            : parseManyToManyRelationshipUpdateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, schemaName, relationshipKind, spec: spec.data });
        break;
      }
      case 'create-many-to-many': {
        const spec = parseManyToManyRelationshipCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'create-customer-relationship': {
        const spec = parseCustomerRelationshipCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      default:
        return fail(
          createDiagnostic('error', 'DV_METADATA_APPLY_KIND_INVALID', `Unsupported metadata apply kind ${kind}.`, {
            source: '@pp/cli',
            path: manifestPath,
          })
        );
    }
  }

  return parseMetadataApplyPlan({ operations: loadedOperations });
}

function normalizeMetadataApplyResultForOutput(result: DataverseMetadataApplyResult): DataverseMetadataApplyResult {
  return {
    operations: result.operations.map((operation) => ({
      kind: operation.kind,
      status: operation.status,
      entityId: operation.entityId,
      location: operation.location,
      entitySummary: operation.entitySummary,
      publishTargets: operation.publishTargets,
      optionSetPublishTargets: operation.optionSetPublishTargets,
    })),
    summary: result.summary,
    published: result.published,
    publishTargets: result.publishTargets,
    optionSetPublishTargets: result.optionSetPublishTargets,
  };
}

function buildMetadataApplyStartMessage(plan: MetadataApplyPlan, options: { publish?: boolean; solutionUniqueName?: string }): string {
  const counts = new Map<string, number>();

  for (const operation of plan.operations) {
    counts.set(operation.kind, (counts.get(operation.kind) ?? 0) + 1);
  }

  const breakdown = Array.from(counts.entries())
    .map(([kind, count]) => `${kind}=${count}`)
    .join(', ');
  const publishMode = options.publish === false ? 'publish disabled' : 'publish enabled';
  const solutionScope = options.solutionUniqueName ? ` in solution ${options.solutionUniqueName}` : '';

  return `Applying Dataverse metadata plan${solutionScope}: ${plan.operations.length} operations (${breakdown}); ${publishMode}.\n`;
}

function buildMetadataApplyCompletionMessage(result: DataverseMetadataApplyResult): string {
  const parts = [`Dataverse metadata apply completed: ${result.summary?.operationCount ?? result.operations.length} operations`];

  if (result.published) {
    parts.push(`published ${result.publishTargets?.length ?? 0} table target(s)`);
  } else {
    parts.push('no publish step ran');
  }

  if (result.optionSetPublishTargets?.length) {
    parts.push(`published ${result.optionSetPublishTargets.length} option set(s)`);
  }

  return `${parts.join('; ')}.\n`;
}
