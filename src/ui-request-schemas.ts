import { z } from 'zod';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { API_KINDS, ENVIRONMENT_TOKEN_API_KINDS, type ApiKind, type EnvironmentTokenApi } from './request.js';

const ACCOUNT_KINDS = ['user', 'device-code', 'client-secret', 'environment-token', 'static-token'] as const;
const PROMPTS = ['select_account', 'login', 'consent', 'none'] as const;
const ACCESS_MODES = ['read-only', 'read-write'] as const;
const FILTER_TYPES = ['and', 'or'] as const;
const LINK_TYPES = ['inner', 'outer'] as const;

export interface UiPayloadDiagnostic {
  code: string;
  message: string;
  source?: string;
}

export function parseUiPayload<TSchema extends z.ZodTypeAny>(
  value: unknown,
  schema: TSchema,
  invalidObject: UiPayloadDiagnostic,
  invalidShape: UiPayloadDiagnostic = invalidObject
): OperationResult<z.infer<TSchema>> {
  if (!isPlainRecord(value)) {
    return fail(payloadDiagnostic(invalidObject));
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return fail(payloadDiagnostic(invalidShape));
  }
  return ok(parsed.data);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOwnInput(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const trimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}, z.string().optional());

const rawStringSchema = z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string());

const numberSchema = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}, z.number().finite().optional());

const integerStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}, z.number().optional());

const optionalBooleanSchema = z.preprocess((value) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined), z.boolean().optional());
const booleanFromTruthinessSchema = z.preprocess((value) => Boolean(value), z.boolean());
const trueOnlyBooleanSchema = z.preprocess((value) => value === true, z.boolean());

const optionalPlainRecordSchema = z.preprocess((value) => (isPlainRecord(value) ? value : undefined), z.record(z.string(), z.unknown()).optional());

const stringArraySchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => (typeof item === 'string' && item.trim() ? item.trim() : undefined)).filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
}, z.array(z.string()).optional());

const csvArraySchema = z.preprocess((value) => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}, z.array(z.string()).optional());

const accountKindSchema = optionalEnumSchema(ACCOUNT_KINDS);
const promptSchema = optionalEnumSchema(PROMPTS);
const accessModeSchema = optionalEnumSchema(ACCESS_MODES);
const filterTypeSchema = optionalEnumSchema(FILTER_TYPES);
const linkTypeSchema = optionalEnumSchema(LINK_TYPES);
const apiKindSchema = z.preprocess((value) => (typeof value === 'string' && API_KINDS.includes(value as ApiKind) ? value : 'dv'), z.enum(API_KINDS));
const pingApiSchema = z.preprocess((value) => (typeof value === 'string' && ENVIRONMENT_TOKEN_API_KINDS.includes(value as EnvironmentTokenApi) ? value : 'dv'), z.enum(ENVIRONMENT_TOKEN_API_KINDS));

export const uiLoginInputSchema = z
  .object({
    name: trimmedStringSchema,
    kind: accountKindSchema,
    description: trimmedStringSchema,
    tenantId: trimmedStringSchema,
    clientId: trimmedStringSchema,
    scopes: stringArraySchema,
    loginHint: trimmedStringSchema,
    accountUsername: trimmedStringSchema,
    homeAccountId: trimmedStringSchema,
    localAccountId: trimmedStringSchema,
    tokenCacheKey: trimmedStringSchema,
    prompt: promptSchema,
    fallbackToDeviceCode: booleanFromTruthinessSchema,
    clientSecretEnv: trimmedStringSchema,
    environmentVariable: trimmedStringSchema,
    token: trimmedStringSchema
  })
  .passthrough();

export const uiAccountUpdateInputSchema = z
  .object({
    kind: accountKindSchema,
    description: trimmedStringSchema,
    tenantId: trimmedStringSchema,
    clientId: trimmedStringSchema,
    loginHint: trimmedStringSchema,
    accountUsername: trimmedStringSchema,
    homeAccountId: trimmedStringSchema,
    localAccountId: trimmedStringSchema,
    tokenCacheKey: trimmedStringSchema,
    clientSecretEnv: trimmedStringSchema,
    environmentVariable: trimmedStringSchema,
    token: trimmedStringSchema
  })
  .passthrough();

export const uiEnvironmentInputSchema = z
  .object({
    alias: trimmedStringSchema,
    url: trimmedStringSchema,
    account: trimmedStringSchema,
    displayName: trimmedStringSchema,
    accessMode: accessModeSchema
  })
  .passthrough();

export const uiApiRequestInputSchema = z
  .object({
    environment: trimmedStringSchema,
    account: trimmedStringSchema,
    api: apiKindSchema,
    method: trimmedStringSchema,
    path: trimmedStringSchema,
    query: optionalPlainRecordSchema,
    headers: optionalPlainRecordSchema,
    body: z.unknown(),
    allowInteractive: z.unknown(),
    rawBody: trimmedStringSchema,
    responseType: trimmedStringSchema,
    timeoutMs: numberSchema,
    jq: trimmedStringSchema,
    maxResponseBytes: numberSchema,
    softFail: trueOnlyBooleanSchema,
    readIntent: z.unknown()
  })
  .passthrough();

export const uiDataverseQuerySpecSchema = z
  .object({
    environmentAlias: trimmedStringSchema,
    environment: trimmedStringSchema,
    accountName: trimmedStringSchema,
    account: trimmedStringSchema,
    entitySetName: trimmedStringSchema,
    rawPath: trimmedStringSchema,
    select: stringArraySchema,
    selectCsv: csvArraySchema,
    filter: trimmedStringSchema,
    orderBy: stringArraySchema,
    orderByCsv: csvArraySchema,
    expand: stringArraySchema,
    expandCsv: csvArraySchema,
    top: numberSchema,
    includeCount: trueOnlyBooleanSchema,
    search: trimmedStringSchema
  })
  .passthrough();

export const uiDataverseCreateRecordInputSchema = z
  .object({
    environmentAlias: trimmedStringSchema,
    environment: trimmedStringSchema,
    accountName: trimmedStringSchema,
    account: trimmedStringSchema,
    entitySetName: trimmedStringSchema,
    logicalName: trimmedStringSchema,
    primaryIdAttribute: trimmedStringSchema,
    body: optionalPlainRecordSchema
  })
  .passthrough();

const fetchXmlConditionSchema = z
  .object({
    attribute: trimmedStringSchema,
    operator: trimmedStringSchema,
    value: trimmedStringSchema
  })
  .passthrough();

const fetchXmlOrderSchema = z
  .object({
    attribute: trimmedStringSchema,
    descending: trueOnlyBooleanSchema
  })
  .passthrough();

const fetchXmlLinkEntitySchema = z
  .object({
    name: trimmedStringSchema,
    from: trimmedStringSchema,
    to: trimmedStringSchema,
    alias: trimmedStringSchema,
    linkType: linkTypeSchema,
    attributes: stringArraySchema,
    attributesCsv: csvArraySchema,
    conditions: z.preprocess((value) => (Array.isArray(value) ? value.filter(isPlainRecord) : []), z.array(fetchXmlConditionSchema))
  })
  .passthrough();

export const uiFetchXmlSpecSchema = z
  .object({
    environmentAlias: trimmedStringSchema,
    environment: trimmedStringSchema,
    accountName: trimmedStringSchema,
    account: trimmedStringSchema,
    entity: trimmedStringSchema,
    entitySetName: trimmedStringSchema,
    attributes: stringArraySchema,
    attributesCsv: csvArraySchema,
    top: numberSchema,
    distinct: trueOnlyBooleanSchema,
    rawXml: trimmedStringSchema,
    conditions: z.preprocess((value) => (Array.isArray(value) ? value.filter(isPlainRecord) : []), z.array(fetchXmlConditionSchema)),
    orders: z.preprocess((value) => (Array.isArray(value) ? value.filter(isPlainRecord) : []), z.array(fetchXmlOrderSchema)),
    filterType: filterTypeSchema,
    linkEntities: z.preprocess((value) => (Array.isArray(value) ? value.filter(isPlainRecord) : []), z.array(fetchXmlLinkEntitySchema))
  })
  .passthrough();

export const uiFetchXmlLanguageRequestSchema = z
  .object({
    environmentAlias: trimmedStringSchema,
    environment: trimmedStringSchema,
    source: rawStringSchema,
    cursor: numberSchema,
    rootEntityName: trimmedStringSchema,
    entity: trimmedStringSchema
  })
  .passthrough();

export const uiFlowLanguageRequestSchema = z
  .object({
    source: rawStringSchema,
    cursor: numberSchema
  })
  .passthrough();

export const uiPingInputSchema = z
  .object({
    api: pingApiSchema,
    allowInteractive: optionalBooleanSchema,
    top: integerStringSchema
  })
  .passthrough();

export type UiLoginInputPayload = z.infer<typeof uiLoginInputSchema>;
export type UiAccountUpdateInputPayload = z.infer<typeof uiAccountUpdateInputSchema>;
export type UiEnvironmentInputPayload = z.infer<typeof uiEnvironmentInputSchema>;
export type UiApiRequestInputPayload = z.infer<typeof uiApiRequestInputSchema>;
export type UiDataverseQuerySpecPayload = z.infer<typeof uiDataverseQuerySpecSchema>;
export type UiDataverseCreateRecordInputPayload = z.infer<typeof uiDataverseCreateRecordInputSchema>;
export type UiFetchXmlSpecPayload = z.infer<typeof uiFetchXmlSpecSchema>;
export type UiFetchXmlLanguageRequestPayload = z.infer<typeof uiFetchXmlLanguageRequestSchema>;
export type UiFlowLanguageRequestPayload = z.infer<typeof uiFlowLanguageRequestSchema>;

function optionalEnumSchema<const TValues extends readonly [string, ...string[]]>(values: TValues) {
  const enumSchema = z.enum(values);
  return z.preprocess((value) => (typeof value === 'string' && values.includes(value) ? value : undefined), enumSchema.optional());
}

function payloadDiagnostic(input: UiPayloadDiagnostic) {
  return createDiagnostic('error', input.code, input.message, { source: input.source ?? 'pp/ui' });
}
