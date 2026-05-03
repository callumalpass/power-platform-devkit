import type { LoginAccountInput } from './auth.js';
import type { EnvironmentAccessMode, Account } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import type { FetchXmlLanguageRequest } from './fetchxml-language-service.js';
import type { FlowLanguageRequest } from './flow-language-service.js';
import { isAccountScopedApi, isApiKind, isEnvironmentTokenApi, type ApiKind, type EnvironmentTokenApi } from './request.js';
import type { DataverseCreateRecordInput, DataverseQuerySpec, FetchXmlSpec } from './services/dataverse.js';
import {
  hasOwnInput,
  parseUiPayload,
  uiAccountUpdateInputSchema,
  uiApiRequestInputSchema,
  uiDataverseCreateRecordInputSchema,
  uiDataverseQuerySpecSchema,
  uiEnvironmentInputSchema,
  uiFetchXmlLanguageRequestSchema,
  uiFetchXmlSpecSchema,
  uiFlowLanguageRequestSchema,
  uiLoginInputSchema
} from './ui-request-schemas.js';

export interface UiEnvironmentInput {
  alias: string;
  url: string;
  account: string;
  displayName?: string;
  accessMode?: EnvironmentAccessMode;
}

export interface UiApiRequestInput {
  environment?: string;
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
  const parsed = parseUiPayload(value, uiLoginInputSchema, { code: 'INVALID_LOGIN_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const name = input.name;
  const kind = input.kind;
  if (!name) return fail(createDiagnostic('error', 'ACCOUNT_NAME_REQUIRED', 'name is required.', { source: 'pp/ui' }));
  if (!kind) return fail(createDiagnostic('error', 'ACCOUNT_KIND_REQUIRED', 'kind must be one of user, device-code, client-secret, environment-token, static-token.', { source: 'pp/ui' }));
  return ok(
    omitUndefined({
      name,
      kind,
      description: input.description,
      tenantId: input.tenantId,
      clientId: input.clientId,
      scopes: input.scopes,
      loginHint: input.loginHint,
      prompt: input.prompt,
      fallbackToDeviceCode: input.fallbackToDeviceCode,
      clientSecretEnv: input.clientSecretEnv,
      environmentVariable: input.environmentVariable,
      token: input.token
    })
  );
}

export function readAccountUpdateInput(name: string, value: unknown): OperationResult<Account> {
  const parsed = parseUiPayload(value, uiAccountUpdateInputSchema, { code: 'INVALID_ACCOUNT_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const kind = input.kind ?? 'user';
  const account: Partial<Account> = {
    name,
    kind,
    ...omitUndefined({
      description: input.description,
      tenantId: input.tenantId,
      clientId: input.clientId,
      loginHint: input.loginHint,
      accountUsername: input.accountUsername,
      homeAccountId: input.homeAccountId,
      localAccountId: input.localAccountId,
      tokenCacheKey: input.tokenCacheKey
    })
  } as Account;
  if (kind === 'client-secret') (account as Extract<Account, { kind: 'client-secret' }>).clientSecretEnv = input.clientSecretEnv ?? '';
  if (kind === 'environment-token') (account as Extract<Account, { kind: 'environment-token' }>).environmentVariable = input.environmentVariable ?? '';
  if (kind === 'static-token') (account as Extract<Account, { kind: 'static-token' }>).token = input.token ?? '';
  return ok(account as Account);
}

export function readEnvironmentInput(value: unknown): OperationResult<UiEnvironmentInput> {
  const parsed = parseUiPayload(value, uiEnvironmentInputSchema, { code: 'INVALID_ENVIRONMENT_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const alias = input.alias;
  const url = input.url;
  const account = input.account;
  const accessMode = input.accessMode;
  if (!alias) return fail(createDiagnostic('error', 'ENV_ALIAS_REQUIRED', 'alias is required.', { source: 'pp/ui' }));
  if (!url) return fail(createDiagnostic('error', 'ENV_URL_REQUIRED', 'url is required.', { source: 'pp/ui' }));
  if (!account) return fail(createDiagnostic('error', 'ENV_ACCOUNT_REQUIRED', 'account is required.', { source: 'pp/ui' }));
  if (hasOwnInput(value as Record<string, unknown>, 'accessMode') && !accessMode) {
    return fail(createDiagnostic('error', 'ENV_ACCESS_MODE_INVALID', 'accessMode must be read-only or read-write.', { source: 'pp/ui' }));
  }
  return ok(omitUndefined({ alias, url, account, displayName: input.displayName, accessMode }));
}

export function readApiRequestInput(value: unknown, defaultAllowInteractive: boolean): OperationResult<UiApiRequestInput> {
  const parsed = parseUiPayload(value, uiApiRequestInputSchema, { code: 'INVALID_REQUEST_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const environment = input.environment;
  const path = input.path;
  const method = input.method ?? 'GET';
  const api = input.api;
  const account = input.account;
  if (!environment && !(account && isAccountScopedApi(api))) {
    return fail(createDiagnostic('error', 'REQUEST_SCOPE_REQUIRED', 'environment is required unless an account-scoped API is used with account.', { source: 'pp/ui' }));
  }
  if (!path) {
    return fail(createDiagnostic('error', 'PATH_REQUIRED', 'path is required.', { source: 'pp/ui' }));
  }
  const reqMethod = method.toUpperCase();
  return ok({
    ...omitUndefined({ environment, account, query: input.query as Record<string, string> | undefined, headers: input.headers as Record<string, string> | undefined }),
    api,
    method: reqMethod,
    path,
    body: input.body,
    allowInteractive: hasOwnInput(value as Record<string, unknown>, 'allowInteractive') ? Boolean(input.allowInteractive) : defaultAllowInteractive,
    readIntent: reqMethod === 'GET' || reqMethod === 'HEAD'
  });
}

export function readDataverseQuerySpec(value: unknown): OperationResult<DataverseQuerySpec> {
  const parsed = parseUiPayload(value, uiDataverseQuerySpecSchema, { code: 'INVALID_QUERY_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const environmentAlias = input.environmentAlias ?? input.environment;
  const entitySetName = input.entitySetName;
  const rawPath = input.rawPath;
  if (!environmentAlias) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environmentAlias is required.', { source: 'pp/ui' }));
  }
  if (!entitySetName && !rawPath) {
    return fail(createDiagnostic('error', 'DV_ENTITY_SET_REQUIRED', 'entitySetName or rawPath is required.', { source: 'pp/ui' }));
  }
  return ok(
    omitUndefined({
      environmentAlias,
      accountName: input.accountName ?? input.account,
      entitySetName: entitySetName ?? '',
      select: input.select ?? input.selectCsv,
      filter: input.filter,
      orderBy: input.orderBy ?? input.orderByCsv,
      expand: input.expand ?? input.expandCsv,
      top: input.top,
      includeCount: input.includeCount,
      search: input.search,
      rawPath
    })
  );
}

export function readDataverseCreateRecordInput(value: unknown): OperationResult<DataverseCreateRecordInput> {
  const parsed = parseUiPayload(value, uiDataverseCreateRecordInputSchema, { code: 'INVALID_DV_CREATE_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const environmentAlias = input.environmentAlias ?? input.environment;
  const entitySetName = input.entitySetName;
  const body = input.body;
  if (!environmentAlias) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environmentAlias is required.', { source: 'pp/ui' }));
  }
  if (!entitySetName) {
    return fail(createDiagnostic('error', 'DV_ENTITY_SET_REQUIRED', 'entitySetName is required.', { source: 'pp/ui' }));
  }
  if (!body || !Object.keys(body).length) {
    return fail(createDiagnostic('error', 'DV_RECORD_BODY_REQUIRED', 'body must contain at least one field.', { source: 'pp/ui' }));
  }
  return ok(
    omitUndefined({
      environmentAlias,
      accountName: input.accountName ?? input.account,
      entitySetName,
      logicalName: input.logicalName,
      primaryIdAttribute: input.primaryIdAttribute,
      body
    })
  );
}

export function readFetchXmlSpec(value: unknown): OperationResult<FetchXmlSpec> {
  const parsed = parseUiPayload(value, uiFetchXmlSpecSchema, { code: 'INVALID_FETCHXML_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const environmentAlias = input.environmentAlias ?? input.environment;
  const entity = input.entity;
  if (!environmentAlias) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environmentAlias is required.', { source: 'pp/ui' }));
  }
  if (!entity && !input.rawXml) {
    return fail(createDiagnostic('error', 'DV_FETCHXML_ENTITY_REQUIRED', 'entity or rawXml is required.', { source: 'pp/ui' }));
  }
  return ok(
    omitUndefined({
      environmentAlias,
      accountName: input.accountName ?? input.account,
      entity: entity ?? 'unknown',
      entitySetName: input.entitySetName,
      attributes: input.attributes ?? input.attributesCsv,
      top: input.top,
      distinct: input.distinct,
      rawXml: input.rawXml,
      conditions: input.conditions.map((condition) =>
        omitUndefined({
          attribute: condition.attribute ?? '',
          operator: condition.operator ?? '',
          value: condition.value
        })
      ),
      orders: input.orders.map((order) =>
        omitUndefined({
          attribute: order.attribute ?? '',
          descending: order.descending
        })
      ),
      filterType: input.filterType,
      linkEntities: input.linkEntities.map((link) =>
        omitUndefined({
          name: link.name ?? '',
          from: link.from ?? '',
          to: link.to ?? '',
          alias: link.alias,
          linkType: link.linkType,
          attributes: link.attributes ?? link.attributesCsv,
          conditions: link.conditions.map((condition) =>
            omitUndefined({
              attribute: condition.attribute ?? '',
              operator: condition.operator ?? '',
              value: condition.value
            })
          )
        })
      )
    })
  );
}

export function readFetchXmlLanguageRequest(value: unknown): OperationResult<FetchXmlLanguageRequest> {
  const parsed = parseUiPayload(value, uiFetchXmlLanguageRequestSchema, { code: 'INVALID_FETCHXML_LANGUAGE_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const cursor = input.cursor;
  if (cursor === undefined || !Number.isInteger(cursor) || cursor < 0) {
    return fail(createDiagnostic('error', 'FETCHXML_CURSOR_REQUIRED', 'cursor must be a non-negative integer.', { source: 'pp/ui' }));
  }
  return ok(
    omitUndefined({
      environmentAlias: input.environmentAlias ?? input.environment,
      source: input.source,
      cursor,
      rootEntityName: input.rootEntityName ?? input.entity
    })
  );
}

export function readFlowLanguageRequest(value: unknown): OperationResult<FlowLanguageRequest> {
  const parsed = parseUiPayload(value, uiFlowLanguageRequestSchema, { code: 'INVALID_FLOW_LANGUAGE_INPUT', message: 'Request body must be a JSON object.' });
  if (!parsed.success) return fail(...parsed.diagnostics);
  const input = parsed.data;
  const cursor = input.cursor;
  if (cursor === undefined || !Number.isInteger(cursor) || cursor < 0) {
    return fail(createDiagnostic('error', 'FLOW_CURSOR_REQUIRED', 'cursor must be a non-negative integer.', { source: 'pp/ui' }));
  }
  return ok({
    source: input.source,
    cursor
  });
}

export function readAccountKind(value: unknown): LoginAccountInput['kind'] | undefined {
  return value === 'user' || value === 'device-code' || value === 'client-secret' || value === 'environment-token' || value === 'static-token' ? value : undefined;
}

export function readPrompt(value: string | undefined): LoginAccountInput['prompt'] | undefined {
  return value === 'select_account' || value === 'login' || value === 'consent' || value === 'none' ? value : undefined;
}

export function readAccessMode(value: unknown): EnvironmentAccessMode | undefined {
  return value === 'read-only' || value === 'read-write' ? value : undefined;
}

export function readPingApi(value: unknown): EnvironmentTokenApi {
  return typeof value === 'string' && isEnvironmentTokenApi(value) ? value : 'dv';
}

export function readGenericApi(value: unknown): ApiKind {
  return typeof value === 'string' && isApiKind(value) ? value : 'dv';
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function optionalInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
}

type OmitUndefined<T extends Record<string, unknown>> = {
  [Key in keyof T as undefined extends T[Key] ? never : Key]: T[Key];
} & {
  [Key in keyof T as undefined extends T[Key] ? Key : never]?: Exclude<T[Key], undefined>;
};

function omitUndefined<T extends Record<string, unknown>>(value: T): OmitUndefined<T> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result as OmitUndefined<T>;
}
