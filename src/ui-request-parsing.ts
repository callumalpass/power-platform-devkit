import type { LoginAccountInput } from './auth.js';
import type { EnvironmentAccessMode, Account } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import type { FetchXmlLanguageRequest } from './fetchxml-language-service.js';
import type { FlowLanguageRequest } from './flow-language-service.js';
import type { ApiKind } from './request.js';
import type { DataverseQuerySpec, FetchXmlSpec } from './services/dataverse.js';

export interface UiEnvironmentInput {
  alias: string;
  url: string;
  account: string;
  displayName?: string;
  accessMode?: EnvironmentAccessMode;
}

export interface UiApiRequestInput {
  environment: string;
  account?: string;
  api: ApiKind;
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body: unknown;
  allowInteractive: boolean;
  readIntent: boolean;
}

export function readLoginInput(value: unknown): OperationResult<LoginAccountInput> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_LOGIN_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const name = optionalString(value.name);
  const kind = readAccountKind(value.kind);
  if (!name) return fail(createDiagnostic('error', 'ACCOUNT_NAME_REQUIRED', 'name is required.', { source: 'pp/ui' }));
  if (!kind) return fail(createDiagnostic('error', 'ACCOUNT_KIND_REQUIRED', 'kind must be one of user, device-code, client-secret, environment-token, static-token.', { source: 'pp/ui' }));
  return ok({
    name,
    kind,
    description: optionalString(value.description),
    tenantId: optionalString(value.tenantId),
    clientId: optionalString(value.clientId),
    loginHint: optionalString(value.loginHint),
    prompt: readPrompt(optionalString(value.prompt)),
    fallbackToDeviceCode: Boolean(value.fallbackToDeviceCode),
    clientSecretEnv: optionalString(value.clientSecretEnv),
    environmentVariable: optionalString(value.environmentVariable),
    token: optionalString(value.token),
  });
}

export function readAccountUpdateInput(name: string, value: unknown): OperationResult<Account> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_ACCOUNT_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const kind = readAccountKind(value.kind) ?? 'user';
  const account: Partial<Account> = {
    name,
    kind,
    description: optionalString(value.description),
    tenantId: optionalString(value.tenantId),
    clientId: optionalString(value.clientId),
    loginHint: optionalString(value.loginHint),
    accountUsername: optionalString(value.accountUsername),
    homeAccountId: optionalString(value.homeAccountId),
    localAccountId: optionalString(value.localAccountId),
    tokenCacheKey: optionalString(value.tokenCacheKey),
  } as Account;
  if (kind === 'client-secret') (account as Extract<Account, { kind: 'client-secret' }>).clientSecretEnv = optionalString(value.clientSecretEnv) ?? '';
  if (kind === 'environment-token') (account as Extract<Account, { kind: 'environment-token' }>).environmentVariable = optionalString(value.environmentVariable) ?? '';
  if (kind === 'static-token') (account as Extract<Account, { kind: 'static-token' }>).token = optionalString(value.token) ?? '';
  return ok(account as Account);
}

export function readEnvironmentInput(value: unknown): OperationResult<UiEnvironmentInput> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_ENVIRONMENT_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const alias = optionalString(value.alias);
  const url = optionalString(value.url);
  const account = optionalString(value.account);
  const accessMode = readAccessMode(value.accessMode);
  if (!alias) return fail(createDiagnostic('error', 'ENV_ALIAS_REQUIRED', 'alias is required.', { source: 'pp/ui' }));
  if (!url) return fail(createDiagnostic('error', 'ENV_URL_REQUIRED', 'url is required.', { source: 'pp/ui' }));
  if (!account) return fail(createDiagnostic('error', 'ENV_ACCOUNT_REQUIRED', 'account is required.', { source: 'pp/ui' }));
  if (value.accessMode !== undefined && !accessMode) {
    return fail(createDiagnostic('error', 'ENV_ACCESS_MODE_INVALID', 'accessMode must be read-only or read-write.', { source: 'pp/ui' }));
  }
  return ok({ alias, url, account, displayName: optionalString(value.displayName), accessMode });
}

export function readApiRequestInput(
  value: unknown,
  defaultAllowInteractive: boolean,
): OperationResult<UiApiRequestInput> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_REQUEST_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const environment = optionalString(value.environment);
  const path = optionalString(value.path);
  const method = optionalString(value.method) ?? 'GET';
  if (!environment) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' }));
  }
  if (!path) {
    return fail(createDiagnostic('error', 'PATH_REQUIRED', 'path is required.', { source: 'pp/ui' }));
  }
  const reqMethod = method.toUpperCase();
  return ok({
    environment,
    account: optionalString(value.account),
    api: readGenericApi(value.api),
    method: reqMethod,
    path,
    query: isRecord(value.query) ? value.query as Record<string, string> : undefined,
    headers: isRecord(value.headers) ? value.headers as Record<string, string> : undefined,
    body: value.body,
    allowInteractive: value.allowInteractive === undefined ? defaultAllowInteractive : Boolean(value.allowInteractive),
    readIntent: reqMethod === 'GET' || reqMethod === 'HEAD',
  });
}

export function readDataverseQuerySpec(value: unknown): OperationResult<DataverseQuerySpec> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_QUERY_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const environmentAlias = optionalString(value.environmentAlias ?? value.environment);
  const entitySetName = optionalString(value.entitySetName);
  const rawPath = optionalString(value.rawPath);
  if (!environmentAlias) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environmentAlias is required.', { source: 'pp/ui' }));
  }
  if (!entitySetName && !rawPath) {
    return fail(createDiagnostic('error', 'DV_ENTITY_SET_REQUIRED', 'entitySetName or rawPath is required.', { source: 'pp/ui' }));
  }
  return ok({
    environmentAlias,
    accountName: optionalString(value.accountName ?? value.account),
    entitySetName: entitySetName ?? '',
    select: readStringArray(value.select) ?? readCsv(value.selectCsv),
    filter: optionalString(value.filter),
    orderBy: readStringArray(value.orderBy) ?? readCsv(value.orderByCsv),
    expand: readStringArray(value.expand) ?? readCsv(value.expandCsv),
    top: readNumber(value.top),
    includeCount: value.includeCount === true,
    search: optionalString(value.search),
    rawPath,
  });
}

export function readFetchXmlSpec(value: unknown): OperationResult<FetchXmlSpec> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_FETCHXML_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const environmentAlias = optionalString(value.environmentAlias ?? value.environment);
  const entity = optionalString(value.entity);
  if (!environmentAlias) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environmentAlias is required.', { source: 'pp/ui' }));
  }
  if (!entity && !optionalString(value.rawXml)) {
    return fail(createDiagnostic('error', 'DV_FETCHXML_ENTITY_REQUIRED', 'entity or rawXml is required.', { source: 'pp/ui' }));
  }
  return ok({
    environmentAlias,
    accountName: optionalString(value.accountName ?? value.account),
    entity: entity ?? 'unknown',
    entitySetName: optionalString(value.entitySetName),
    attributes: readStringArray(value.attributes) ?? readCsv(value.attributesCsv),
    top: readNumber(value.top),
    distinct: value.distinct === true,
    rawXml: optionalString(value.rawXml),
    conditions: readArrayOfRecords(value.conditions).map((condition) => ({
      attribute: optionalString(condition.attribute) ?? '',
      operator: optionalString(condition.operator) ?? '',
      value: optionalString(condition.value),
    })),
    orders: readArrayOfRecords(value.orders).map((order) => ({
      attribute: optionalString(order.attribute) ?? '',
      descending: order.descending === true,
    })),
    filterType: readFilterType(value.filterType),
    linkEntities: readArrayOfRecords(value.linkEntities).map((link) => ({
      name: optionalString(link.name) ?? '',
      from: optionalString(link.from) ?? '',
      to: optionalString(link.to) ?? '',
      alias: optionalString(link.alias),
      linkType: readLinkType(link.linkType),
      attributes: readStringArray(link.attributes) ?? readCsv(link.attributesCsv),
      conditions: readArrayOfRecords(link.conditions).map((condition) => ({
        attribute: optionalString(condition.attribute) ?? '',
        operator: optionalString(condition.operator) ?? '',
        value: optionalString(condition.value),
      })),
    })),
  });
}

export function readFetchXmlLanguageRequest(value: unknown): OperationResult<FetchXmlLanguageRequest> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_FETCHXML_LANGUAGE_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const cursor = readNumber(value.cursor);
  if (cursor === undefined || !Number.isInteger(cursor) || cursor < 0) {
    return fail(createDiagnostic('error', 'FETCHXML_CURSOR_REQUIRED', 'cursor must be a non-negative integer.', { source: 'pp/ui' }));
  }
  return ok({
    environmentAlias: optionalString(value.environmentAlias ?? value.environment),
    source: typeof value.source === 'string' ? value.source : '',
    cursor,
    rootEntityName: optionalString(value.rootEntityName ?? value.entity),
  });
}

export function readFlowLanguageRequest(value: unknown): OperationResult<FlowLanguageRequest> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_FLOW_LANGUAGE_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const cursor = readNumber(value.cursor);
  if (cursor === undefined || !Number.isInteger(cursor) || cursor < 0) {
    return fail(createDiagnostic('error', 'FLOW_CURSOR_REQUIRED', 'cursor must be a non-negative integer.', { source: 'pp/ui' }));
  }
  return ok({
    source: typeof value.source === 'string' ? value.source : '',
    cursor,
  });
}

export function readAccountKind(value: unknown): LoginAccountInput['kind'] | undefined {
  return value === 'user' || value === 'device-code' || value === 'client-secret' || value === 'environment-token' || value === 'static-token'
    ? value
    : undefined;
}

export function readPrompt(value: string | undefined): LoginAccountInput['prompt'] | undefined {
  return value === 'select_account' || value === 'login' || value === 'consent' || value === 'none' ? value : undefined;
}

export function readAccessMode(value: unknown): EnvironmentAccessMode | undefined {
  return value === 'read-only' || value === 'read-write' ? value : undefined;
}

export function readPingApi(value: unknown): Exclude<ApiKind, 'custom'> {
  return value === 'flow' || value === 'graph' || value === 'bap' || value === 'powerapps' ? value : 'dv';
}

export function readGenericApi(value: unknown): ApiKind {
  return value === 'dv' || value === 'flow' || value === 'graph' || value === 'bap' || value === 'powerapps' ? value : 'dv';
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function optionalInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCsv(value: unknown): string[] | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const items = text.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => optionalString(item)).filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
}

function readArrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readFilterType(value: unknown): 'and' | 'or' | undefined {
  return value === 'and' || value === 'or' ? value : undefined;
}

function readLinkType(value: unknown): 'inner' | 'outer' | undefined {
  return value === 'inner' || value === 'outer' ? value : undefined;
}
