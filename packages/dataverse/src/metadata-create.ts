import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { z } from 'zod';

const requiredLevelSchema = z.enum(['none', 'recommended', 'applicationRequired', 'systemRequired']).default('none');
const ownershipTypeSchema = z.enum(['userOwned', 'organizationOwned']).default('userOwned');
const integerFormatSchema = z.enum(['none', 'duration', 'timeZone', 'language', 'locale']).default('none');
const dateTimeFormatSchema = z.enum(['dateOnly', 'dateAndTime']).default('dateOnly');
const dateTimeBehaviorSchema = z.enum(['userLocal', 'dateOnly', 'timeZoneIndependent']).optional();
const associatedMenuBehaviorSchema = z.enum(['useCollectionName', 'useLabel', 'doNotDisplay']).default('useCollectionName');
const associatedMenuGroupSchema = z.enum(['details', 'sales', 'service', 'marketing']).default('details');
const cascadeTypeSchema = z.enum(['cascade', 'active', 'userOwned', 'noCascade', 'removeLink', 'restrict']);

const optionDefinitionSchema = z.object({
  label: z.string().min(1),
  value: z.number().int().nullable().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
});

const baseColumnSchema = z.object({
  schemaName: z.string().min(1),
  logicalName: z.string().min(1).optional(),
  displayName: z.string().min(1),
  description: z.string().optional(),
  requiredLevel: requiredLevelSchema.optional(),
});

const stringColumnSchema = baseColumnSchema.extend({
  kind: z.literal('string'),
  maxLength: z.number().int().min(1).max(4000).default(100),
  format: z.enum(['text', 'email', 'phone', 'url', 'ticker', 'textArea']).default('text'),
});

const memoColumnSchema = baseColumnSchema.extend({
  kind: z.literal('memo'),
  maxLength: z.number().int().min(1).max(1048576).default(500),
  format: z.enum(['text', 'textArea']).default('textArea'),
});

const integerColumnSchema = baseColumnSchema.extend({
  kind: z.literal('integer'),
  minValue: z.number().int().optional(),
  maxValue: z.number().int().optional(),
  format: integerFormatSchema.optional(),
});

const decimalColumnSchema = baseColumnSchema.extend({
  kind: z.literal('decimal'),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  precision: z.number().int().min(0).max(10).default(2),
});

const moneyColumnSchema = baseColumnSchema.extend({
  kind: z.literal('money'),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  precision: z.number().int().min(0).max(4).default(2),
  precisionSource: z.number().int().min(0).max(2).default(1),
});

const dateTimeColumnSchema = baseColumnSchema.extend({
  kind: z.literal('datetime'),
  format: dateTimeFormatSchema.optional(),
  behavior: dateTimeBehaviorSchema,
});

const booleanColumnSchema = baseColumnSchema.extend({
  kind: z.literal('boolean'),
  defaultValue: z.boolean().default(false),
  trueLabel: z.string().min(1).default('True'),
  falseLabel: z.string().min(1).default('False'),
});

const localChoiceColumnSchema = baseColumnSchema.extend({
  kind: z.literal('choice'),
  options: z.array(optionDefinitionSchema).min(1),
  globalOptionSetName: z.undefined().optional(),
});

const globalChoiceColumnSchema = baseColumnSchema.extend({
  kind: z.literal('choice'),
  options: z.undefined().optional(),
  globalOptionSetName: z.string().min(1),
});

export const columnCreateSpecSchema = z.union([
  stringColumnSchema,
  memoColumnSchema,
  integerColumnSchema,
  decimalColumnSchema,
  moneyColumnSchema,
  dateTimeColumnSchema,
  booleanColumnSchema,
  localChoiceColumnSchema,
  globalChoiceColumnSchema,
]);

const primaryNameColumnSchema = z.object({
  schemaName: z.string().min(1),
  logicalName: z.string().min(1).optional(),
  displayName: z.string().min(1),
  description: z.string().optional(),
  maxLength: z.number().int().min(1).max(4000).default(100),
  requiredLevel: requiredLevelSchema.optional(),
});

export const tableCreateSpecSchema = z.object({
  schemaName: z.string().min(1),
  logicalName: z.string().min(1).optional(),
  displayName: z.string().min(1),
  pluralDisplayName: z.string().min(1),
  description: z.string().optional(),
  ownership: ownershipTypeSchema.default('userOwned'),
  hasActivities: z.boolean().default(false),
  hasNotes: z.boolean().default(false),
  isActivity: z.boolean().default(false),
  primaryName: primaryNameColumnSchema,
});

export const globalOptionSetCreateSpecSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  options: z.array(optionDefinitionSchema).min(1),
});

export const oneToManyRelationshipCreateSpecSchema = z.object({
  schemaName: z.string().min(1),
  referencedEntity: z.string().min(1),
  referencedAttribute: z.string().min(1).default('id'),
  referencingEntity: z.string().min(1),
  lookup: baseColumnSchema,
  associatedMenuLabel: z.string().optional(),
  associatedMenuBehavior: associatedMenuBehaviorSchema.default('useCollectionName'),
  associatedMenuGroup: associatedMenuGroupSchema.default('details'),
  associatedMenuOrder: z.number().int().min(0).default(10000),
  cascade: z
    .object({
      assign: cascadeTypeSchema.optional(),
      delete: cascadeTypeSchema.optional(),
      merge: cascadeTypeSchema.optional(),
      reparent: cascadeTypeSchema.optional(),
      share: cascadeTypeSchema.optional(),
      unshare: cascadeTypeSchema.optional(),
    })
    .optional(),
});

export type RequiredLevel = z.output<typeof requiredLevelSchema>;
export type TableCreateSpec = z.output<typeof tableCreateSpecSchema>;
export type ColumnCreateSpec = z.output<typeof columnCreateSpecSchema>;
export type GlobalOptionSetCreateSpec = z.output<typeof globalOptionSetCreateSpecSchema>;
export type OneToManyRelationshipCreateSpec = z.output<typeof oneToManyRelationshipCreateSpecSchema>;

export interface MetadataBuildOptions {
  languageCode?: number;
}

export function parseTableCreateSpec(input: unknown): OperationResult<TableCreateSpec> {
  return parseSpec(tableCreateSpecSchema, input, 'DATAVERSE_METADATA_TABLE_SPEC_INVALID', 'Table creation spec is invalid.');
}

export function parseColumnCreateSpec(input: unknown): OperationResult<ColumnCreateSpec> {
  return parseSpec(columnCreateSpecSchema, input, 'DATAVERSE_METADATA_COLUMN_SPEC_INVALID', 'Column creation spec is invalid.');
}

export function parseGlobalOptionSetCreateSpec(input: unknown): OperationResult<GlobalOptionSetCreateSpec> {
  return parseSpec(
    globalOptionSetCreateSpecSchema,
    input,
    'DATAVERSE_METADATA_OPTIONSET_SPEC_INVALID',
    'Global option set creation spec is invalid.'
  );
}

export function parseOneToManyRelationshipCreateSpec(input: unknown): OperationResult<OneToManyRelationshipCreateSpec> {
  return parseSpec(
    oneToManyRelationshipCreateSpecSchema,
    input,
    'DATAVERSE_METADATA_RELATIONSHIP_SPEC_INVALID',
    'One-to-many relationship creation spec is invalid.'
  );
}

export function buildTableCreatePayload(spec: TableCreateSpec, options: MetadataBuildOptions = {}): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;
  const tableLogicalName = resolveLogicalName(spec.schemaName, spec.logicalName);
  const primaryNameLogicalName = resolveLogicalName(spec.primaryName.schemaName, spec.primaryName.logicalName);

  return compactObject({
    '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
    Attributes: [
      compactObject({
        '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
        AttributeType: 'String',
        AttributeTypeName: {
          Value: 'StringType',
        },
        SchemaName: spec.primaryName.schemaName,
        LogicalName: primaryNameLogicalName,
        DisplayName: buildLabel(spec.primaryName.displayName, languageCode),
        Description: spec.primaryName.description ? buildLabel(spec.primaryName.description, languageCode) : undefined,
        IsPrimaryName: true,
        RequiredLevel: buildRequiredLevel(spec.primaryName.requiredLevel ?? 'none'),
        FormatName: {
          Value: 'Text',
        },
        MaxLength: spec.primaryName.maxLength,
      }),
    ],
    SchemaName: spec.schemaName,
    LogicalName: tableLogicalName,
    DisplayName: buildLabel(spec.displayName, languageCode),
    DisplayCollectionName: buildLabel(spec.pluralDisplayName, languageCode),
    Description: spec.description ? buildLabel(spec.description, languageCode) : undefined,
    OwnershipType: mapOwnershipType(spec.ownership ?? 'userOwned'),
    IsActivity: spec.isActivity,
    HasActivities: spec.hasActivities,
    HasNotes: spec.hasNotes,
    PrimaryNameAttribute: primaryNameLogicalName,
  });
}

export function buildColumnCreatePayload(spec: ColumnCreateSpec, options: MetadataBuildOptions = {}): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;
  const base = buildBaseColumnPayload(spec, languageCode);

  switch (spec.kind) {
    case 'string':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
        AttributeType: 'String',
        AttributeTypeName: { Value: 'StringType' },
        MaxLength: spec.maxLength,
        FormatName: { Value: mapStringFormat(spec.format) },
      });
    case 'memo':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.MemoAttributeMetadata',
        AttributeType: 'Memo',
        AttributeTypeName: { Value: 'MemoType' },
        MaxLength: spec.maxLength,
        Format: spec.format === 'text' ? 'Text' : 'TextArea',
      });
    case 'integer':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata',
        AttributeType: 'Integer',
        AttributeTypeName: { Value: 'IntegerType' },
        MinValue: spec.minValue,
        MaxValue: spec.maxValue,
        Format: mapIntegerFormat(spec.format),
        SourceTypeMask: 0,
      });
    case 'decimal':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.DecimalAttributeMetadata',
        AttributeType: 'Decimal',
        AttributeTypeName: { Value: 'DecimalType' },
        MinValue: spec.minValue,
        MaxValue: spec.maxValue,
        Precision: spec.precision,
      });
    case 'money':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.MoneyAttributeMetadata',
        AttributeType: 'Money',
        AttributeTypeName: { Value: 'MoneyType' },
        ImeMode: 'Disabled',
        MinValue: spec.minValue,
        MaxValue: spec.maxValue,
        Precision: spec.precision,
        PrecisionSource: spec.precisionSource,
        SourceTypeMask: 0,
        IsBaseCurrency: false,
      });
    case 'datetime':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata',
        AttributeType: 'DateTime',
        AttributeTypeName: { Value: 'DateTimeType' },
        Format: mapDateTimeFormat(spec.format),
        DateTimeBehavior: spec.behavior ? { Value: mapDateTimeBehavior(spec.behavior) } : undefined,
      });
    case 'boolean':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
        AttributeType: 'Boolean',
        AttributeTypeName: { Value: 'BooleanType' },
        DefaultValue: spec.defaultValue,
        OptionSet: {
          TrueOption: buildOptionMetadata(
            {
              label: spec.trueLabel,
              value: 1,
            },
            languageCode
          ),
          FalseOption: buildOptionMetadata(
            {
              label: spec.falseLabel,
              value: 0,
            },
            languageCode
          ),
          OptionSetType: 'Boolean',
        },
      });
    case 'choice':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
        AttributeType: 'Picklist',
        AttributeTypeName: { Value: 'PicklistType' },
        SourceTypeMask: 0,
        OptionSet: spec.options
          ? {
              '@odata.type': 'Microsoft.Dynamics.CRM.OptionSetMetadata',
              OptionSetType: 'Picklist',
              Options: spec.options.map((option) => buildOptionMetadata(option, languageCode)),
            }
          : undefined,
        'GlobalOptionSet@odata.bind': spec.globalOptionSetName ? `/GlobalOptionSetDefinitions(Name='${spec.globalOptionSetName}')` : undefined,
      });
  }

  const exhaustiveCheck: never = spec;
  return exhaustiveCheck;
}

export function buildGlobalOptionSetCreatePayload(
  spec: GlobalOptionSetCreateSpec,
  options: MetadataBuildOptions = {}
): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;

  return compactObject({
    '@odata.type': 'Microsoft.Dynamics.CRM.OptionSetMetadata',
    Name: spec.name,
    DisplayName: buildLabel(spec.displayName, languageCode),
    Description: spec.description ? buildLabel(spec.description, languageCode) : undefined,
    OptionSetType: 'Picklist',
    Options: spec.options.map((option) => buildOptionMetadata(option, languageCode)),
  });
}

export function buildOneToManyRelationshipCreatePayload(
  spec: OneToManyRelationshipCreateSpec,
  options: MetadataBuildOptions = {}
): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;
  const lookupLogicalName = resolveLogicalName(spec.lookup.schemaName, spec.lookup.logicalName);

  return compactObject({
    '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
    SchemaName: spec.schemaName,
    ReferencedEntity: spec.referencedEntity,
    ReferencedAttribute: normalizeReferencedAttribute(spec.referencedEntity, spec.referencedAttribute ?? 'id'),
    ReferencingEntity: spec.referencingEntity,
    AssociatedMenuConfiguration: {
      Behavior: mapAssociatedMenuBehavior(spec.associatedMenuBehavior ?? 'useCollectionName'),
      Group: mapAssociatedMenuGroup(spec.associatedMenuGroup ?? 'details'),
      Label: buildLabel(spec.associatedMenuLabel ?? spec.lookup.displayName, languageCode),
      Order: spec.associatedMenuOrder,
    },
    CascadeConfiguration: {
      Assign: mapCascadeType(spec.cascade?.assign ?? 'noCascade'),
      Delete: mapCascadeType(spec.cascade?.delete ?? 'removeLink'),
      Merge: mapCascadeType(spec.cascade?.merge ?? 'noCascade'),
      Reparent: mapCascadeType(spec.cascade?.reparent ?? 'noCascade'),
      Share: mapCascadeType(spec.cascade?.share ?? 'noCascade'),
      Unshare: mapCascadeType(spec.cascade?.unshare ?? 'noCascade'),
    },
    Lookup: compactObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.LookupAttributeMetadata',
      AttributeType: 'Lookup',
      AttributeTypeName: { Value: 'LookupType' },
      SchemaName: spec.lookup.schemaName,
      LogicalName: lookupLogicalName,
      DisplayName: buildLabel(spec.lookup.displayName, languageCode),
      Description: spec.lookup.description ? buildLabel(spec.lookup.description, languageCode) : undefined,
      RequiredLevel: buildRequiredLevel(spec.lookup.requiredLevel ?? 'none'),
    }),
  });
}

export function resolveLogicalName(schemaName: string, logicalName?: string): string {
  return logicalName ?? schemaName.toLowerCase();
}

function parseSpec<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  code: string,
  message: string
): OperationResult<z.output<TSchema>> {
  const result = schema.safeParse(input);

  if (!result.success) {
    return fail(
      createDiagnostic('error', code, message, {
        source: '@pp/dataverse',
        detail: result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; '),
      })
    );
  }

  return ok(result.data, {
    supportTier: 'preview',
  });
}

function buildBaseColumnPayload(
  spec: Pick<ColumnCreateSpec, 'schemaName' | 'logicalName' | 'displayName' | 'description' | 'requiredLevel'>,
  languageCode: number
): Record<string, unknown> {
  return compactObject({
    SchemaName: spec.schemaName,
    LogicalName: resolveLogicalName(spec.schemaName, spec.logicalName),
    DisplayName: buildLabel(spec.displayName, languageCode),
    Description: spec.description ? buildLabel(spec.description, languageCode) : undefined,
    RequiredLevel: buildRequiredLevel(spec.requiredLevel ?? 'none'),
  });
}

function buildOptionMetadata(
  option: z.output<typeof optionDefinitionSchema> | { label: string; value: number },
  languageCode: number
): Record<string, unknown> {
  return compactObject({
    Value: 'value' in option ? option.value ?? null : null,
    Label: buildLabel(option.label, languageCode),
    Description: 'description' in option && option.description ? buildLabel(option.description, languageCode) : undefined,
    Color: 'color' in option ? option.color : undefined,
  });
}

function buildLabel(text: string, languageCode: number): Record<string, unknown> {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.Label',
    LocalizedLabels: [
      {
        '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
        Label: text,
        LanguageCode: languageCode,
        IsManaged: false,
      },
    ],
    UserLocalizedLabel: {
      '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
      Label: text,
      LanguageCode: languageCode,
      IsManaged: false,
    },
  };
}

function buildRequiredLevel(requiredLevel: RequiredLevel): Record<string, unknown> {
  return {
    Value: mapRequiredLevel(requiredLevel),
    CanBeChanged: true,
    ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings',
  };
}

function mapRequiredLevel(requiredLevel: RequiredLevel): string {
  switch (requiredLevel) {
    case 'applicationRequired':
      return 'ApplicationRequired';
    case 'recommended':
      return 'Recommended';
    case 'systemRequired':
      return 'SystemRequired';
    case 'none':
    default:
      return 'None';
  }
}

function mapOwnershipType(value: z.output<typeof ownershipTypeSchema>): string {
  return value === 'organizationOwned' ? 'OrganizationOwned' : 'UserOwned';
}

function mapStringFormat(value: z.output<typeof stringColumnSchema>['format']): string {
  switch (value) {
    case 'email':
      return 'Email';
    case 'phone':
      return 'Phone';
    case 'url':
      return 'Url';
    case 'ticker':
      return 'TickerSymbol';
    case 'textArea':
      return 'TextArea';
    case 'text':
    default:
      return 'Text';
  }
}

function mapIntegerFormat(value: z.output<typeof integerFormatSchema> | undefined): string {
  switch (value ?? 'none') {
    case 'duration':
      return 'Duration';
    case 'timeZone':
      return 'TimeZone';
    case 'language':
      return 'Language';
    case 'locale':
      return 'Locale';
    case 'none':
    default:
      return 'None';
  }
}

function mapDateTimeFormat(value: z.output<typeof dateTimeFormatSchema> | undefined): string {
  return value === 'dateAndTime' ? 'DateAndTime' : 'DateOnly';
}

function mapDateTimeBehavior(value: z.output<typeof dateTimeBehaviorSchema>): string {
  switch (value) {
    case 'dateOnly':
      return 'DateOnly';
    case 'timeZoneIndependent':
      return 'TimeZoneIndependent';
    case 'userLocal':
    default:
      return 'UserLocal';
  }
}

function normalizeReferencedAttribute(entityLogicalName: string, referencedAttribute: string): string {
  if (referencedAttribute !== 'id') {
    return referencedAttribute;
  }

  return `${entityLogicalName}id`;
}

function mapAssociatedMenuBehavior(value: z.output<typeof associatedMenuBehaviorSchema>): string {
  switch (value) {
    case 'useLabel':
      return 'UseLabel';
    case 'doNotDisplay':
      return 'DoNotDisplay';
    case 'useCollectionName':
    default:
      return 'UseCollectionName';
  }
}

function mapAssociatedMenuGroup(value: z.output<typeof associatedMenuGroupSchema>): string {
  switch (value) {
    case 'sales':
      return 'Sales';
    case 'service':
      return 'Service';
    case 'marketing':
      return 'Marketing';
    case 'details':
    default:
      return 'Details';
  }
}

function mapCascadeType(value: z.output<typeof cascadeTypeSchema>): string {
  switch (value) {
    case 'noCascade':
      return 'NoCascade';
    case 'removeLink':
      return 'RemoveLink';
    case 'userOwned':
      return 'UserOwned';
    case 'active':
      return 'Active';
    case 'restrict':
      return 'Restrict';
    case 'cascade':
    default:
      return 'Cascade';
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
