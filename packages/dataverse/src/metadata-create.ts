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

const autoNumberColumnSchema = baseColumnSchema.extend({
  kind: z.literal('autonumber'),
  autoNumberFormat: z.string().min(1),
  maxLength: z.number().int().min(1).max(4000).default(100),
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

const fileColumnSchema = baseColumnSchema.extend({
  kind: z.literal('file'),
  maxSizeInKB: z.number().int().min(1).default(30720),
});

const imageColumnSchema = baseColumnSchema.extend({
  kind: z.literal('image'),
  maxSizeInKB: z.number().int().min(1).default(30720),
  canStoreFullImage: z.boolean().default(false),
  isPrimaryImage: z.boolean().optional(),
});

export const columnCreateSpecSchema = z.union([
  stringColumnSchema,
  memoColumnSchema,
  integerColumnSchema,
  decimalColumnSchema,
  moneyColumnSchema,
  dateTimeColumnSchema,
  booleanColumnSchema,
  autoNumberColumnSchema,
  localChoiceColumnSchema,
  globalChoiceColumnSchema,
  fileColumnSchema,
  imageColumnSchema,
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

const associatedMenuConfigSchema = z.object({
  label: z.string().min(1).optional(),
  behavior: associatedMenuBehaviorSchema.default('useCollectionName'),
  group: associatedMenuGroupSchema.default('details'),
  order: z.number().int().min(0).default(10000),
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

export const manyToManyRelationshipCreateSpecSchema = z.object({
  schemaName: z.string().min(1),
  entity1LogicalName: z.string().min(1),
  entity2LogicalName: z.string().min(1),
  intersectEntityName: z.string().min(1).optional(),
  entity1NavigationPropertyName: z.string().min(1).optional(),
  entity2NavigationPropertyName: z.string().min(1).optional(),
  entity1Menu: associatedMenuConfigSchema.optional(),
  entity2Menu: associatedMenuConfigSchema.optional(),
});

export const customerRelationshipCreateSpecSchema = z.object({
  tableLogicalName: z.string().min(1),
  lookup: baseColumnSchema,
  accountRelationshipSchemaName: z.string().min(1).optional(),
  accountReferencedAttribute: z.string().min(1).default('id'),
  accountMenu: associatedMenuConfigSchema.optional(),
  contactRelationshipSchemaName: z.string().min(1).optional(),
  contactReferencedAttribute: z.string().min(1).default('id'),
  contactMenu: associatedMenuConfigSchema.optional(),
});

const optionPatchSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  color: z.string().optional(),
});

const optionInsertSchema = optionPatchSchema.extend({
  value: z.number().int().nullable().optional(),
  label: z.string().min(1),
});

const optionUpdateSchema = optionPatchSchema.extend({
  value: z.number().int(),
  mergeLabels: z.boolean().default(true),
});

export const globalOptionSetUpdateSpecSchema = z.object({
  name: z.string().min(1),
  add: z.array(optionInsertSchema).optional(),
  update: z.array(optionUpdateSchema).optional(),
  removeValues: z.array(z.number().int()).optional(),
  orderValues: z.array(z.number().int()).optional(),
});

export const tableUpdateSpecSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    pluralDisplayName: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one table metadata field must be provided.',
  });

export const columnUpdateSpecSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    description: z.string().optional(),
    requiredLevel: requiredLevelSchema.optional(),
    trueLabel: z.string().min(1).optional(),
    falseLabel: z.string().min(1).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one column metadata field must be provided.',
  })
  .superRefine((value, ctx) => {
    const hasTrueLabel = value.trueLabel !== undefined;
    const hasFalseLabel = value.falseLabel !== undefined;

    if (hasTrueLabel !== hasFalseLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasTrueLabel ? ['falseLabel'] : ['trueLabel'],
        message: 'Boolean label updates require both trueLabel and falseLabel.',
      });
    }
  });

export const oneToManyRelationshipUpdateSpecSchema = z
  .object({
    associatedMenuLabel: z.string().min(1).optional(),
    associatedMenuBehavior: associatedMenuBehaviorSchema.optional(),
    associatedMenuGroup: associatedMenuGroupSchema.optional(),
    associatedMenuOrder: z.number().int().min(0).optional(),
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
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one one-to-many relationship field must be provided.',
  });

export const manyToManyRelationshipUpdateSpecSchema = z
  .object({
    entity1Menu: associatedMenuConfigSchema.optional(),
    entity2Menu: associatedMenuConfigSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one many-to-many relationship field must be provided.',
  });

export const metadataApplyOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create-table'),
    spec: tableCreateSpecSchema,
  }),
  z.object({
    kind: z.literal('update-table'),
    tableLogicalName: z.string().min(1),
    spec: tableUpdateSpecSchema,
  }),
  z.object({
    kind: z.literal('add-column'),
    tableLogicalName: z.string().min(1),
    spec: columnCreateSpecSchema,
  }),
  z.object({
    kind: z.literal('update-column'),
    tableLogicalName: z.string().min(1),
    columnLogicalName: z.string().min(1),
    spec: columnUpdateSpecSchema,
  }),
  z.object({
    kind: z.literal('create-option-set'),
    spec: globalOptionSetCreateSpecSchema,
  }),
  z.object({
    kind: z.literal('update-option-set'),
    spec: globalOptionSetUpdateSpecSchema,
  }),
  z.object({
    kind: z.literal('create-relationship'),
    spec: oneToManyRelationshipCreateSpecSchema,
  }),
  z.object({
    kind: z.literal('update-relationship'),
    schemaName: z.string().min(1),
    relationshipKind: z.enum(['one-to-many', 'many-to-many']),
    spec: z.union([oneToManyRelationshipUpdateSpecSchema, manyToManyRelationshipUpdateSpecSchema]),
  }),
  z.object({
    kind: z.literal('create-many-to-many'),
    spec: manyToManyRelationshipCreateSpecSchema,
  }),
  z.object({
    kind: z.literal('create-customer-relationship'),
    spec: customerRelationshipCreateSpecSchema,
  }),
]);

export const metadataApplyPlanSchema = z.object({
  operations: z.array(metadataApplyOperationSchema).min(1),
});

export type RequiredLevel = z.output<typeof requiredLevelSchema>;
export type TableCreateSpec = z.output<typeof tableCreateSpecSchema>;
export type ColumnCreateSpec = z.output<typeof columnCreateSpecSchema>;
export type GlobalOptionSetCreateSpec = z.output<typeof globalOptionSetCreateSpecSchema>;
export type OneToManyRelationshipCreateSpec = z.output<typeof oneToManyRelationshipCreateSpecSchema>;
export type ManyToManyRelationshipCreateSpec = z.output<typeof manyToManyRelationshipCreateSpecSchema>;
export type CustomerRelationshipCreateSpec = z.output<typeof customerRelationshipCreateSpecSchema>;
export type GlobalOptionSetUpdateSpec = z.output<typeof globalOptionSetUpdateSpecSchema>;
export type TableUpdateSpec = z.output<typeof tableUpdateSpecSchema>;
export type ColumnUpdateSpec = z.output<typeof columnUpdateSpecSchema>;
export type OneToManyRelationshipUpdateSpec = z.output<typeof oneToManyRelationshipUpdateSpecSchema>;
export type ManyToManyRelationshipUpdateSpec = z.output<typeof manyToManyRelationshipUpdateSpecSchema>;
export type MetadataApplyOperation = z.output<typeof metadataApplyOperationSchema>;
export type MetadataApplyPlan = z.output<typeof metadataApplyPlanSchema>;

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

export function parseManyToManyRelationshipCreateSpec(input: unknown): OperationResult<ManyToManyRelationshipCreateSpec> {
  return parseSpec(
    manyToManyRelationshipCreateSpecSchema,
    input,
    'DATAVERSE_METADATA_RELATIONSHIP_SPEC_INVALID',
    'Many-to-many relationship creation spec is invalid.'
  );
}

export function parseCustomerRelationshipCreateSpec(input: unknown): OperationResult<CustomerRelationshipCreateSpec> {
  return parseSpec(
    customerRelationshipCreateSpecSchema,
    input,
    'DATAVERSE_METADATA_RELATIONSHIP_SPEC_INVALID',
    'Customer relationship creation spec is invalid.'
  );
}

export function parseGlobalOptionSetUpdateSpec(input: unknown): OperationResult<GlobalOptionSetUpdateSpec> {
  return parseSpec(
    globalOptionSetUpdateSpecSchema,
    input,
    'DATAVERSE_METADATA_OPTIONSET_SPEC_INVALID',
    'Global option set update spec is invalid.'
  );
}

export function parseTableUpdateSpec(input: unknown): OperationResult<TableUpdateSpec> {
  return parseSpec(tableUpdateSpecSchema, input, 'DATAVERSE_METADATA_TABLE_UPDATE_SPEC_INVALID', 'Table update spec is invalid.');
}

export function parseColumnUpdateSpec(input: unknown): OperationResult<ColumnUpdateSpec> {
  return parseSpec(columnUpdateSpecSchema, input, 'DATAVERSE_METADATA_COLUMN_UPDATE_SPEC_INVALID', 'Column update spec is invalid.');
}

export function parseOneToManyRelationshipUpdateSpec(input: unknown): OperationResult<OneToManyRelationshipUpdateSpec> {
  return parseSpec(
    oneToManyRelationshipUpdateSpecSchema,
    input,
    'DATAVERSE_METADATA_RELATIONSHIP_UPDATE_SPEC_INVALID',
    'One-to-many relationship update spec is invalid.'
  );
}

export function parseManyToManyRelationshipUpdateSpec(input: unknown): OperationResult<ManyToManyRelationshipUpdateSpec> {
  return parseSpec(
    manyToManyRelationshipUpdateSpecSchema,
    input,
    'DATAVERSE_METADATA_RELATIONSHIP_UPDATE_SPEC_INVALID',
    'Many-to-many relationship update spec is invalid.'
  );
}

export function parseMetadataApplyPlan(input: unknown): OperationResult<MetadataApplyPlan> {
  return parseSpec(
    metadataApplyPlanSchema,
    input,
    'DATAVERSE_METADATA_APPLY_PLAN_INVALID',
    'Metadata apply plan is invalid.'
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
    case 'autonumber':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
        AttributeType: 'String',
        AttributeTypeName: { Value: 'StringType' },
        AutoNumberFormat: spec.autoNumberFormat,
        MaxLength: spec.maxLength,
        FormatName: { Value: 'Text' },
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
              IsGlobal: false,
              OptionSetType: 'Picklist',
              Options: spec.options.map((option) => buildOptionMetadata(option, languageCode)),
            }
          : undefined,
        'GlobalOptionSet@odata.bind': spec.globalOptionSetName ? `/GlobalOptionSetDefinitions(Name='${spec.globalOptionSetName}')` : undefined,
      });
    case 'file':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.FileAttributeMetadata',
        AttributeTypeName: { Value: 'FileType' },
        MaxSizeInKB: spec.maxSizeInKB,
      });
    case 'image':
      return compactObject({
        ...base,
        '@odata.type': 'Microsoft.Dynamics.CRM.ImageAttributeMetadata',
        AttributeTypeName: { Value: 'ImageType' },
        MaxSizeInKB: spec.maxSizeInKB,
        CanStoreFullImage: spec.canStoreFullImage,
        IsPrimaryImage: spec.isPrimaryImage,
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

export function buildTableUpdatePayload(spec: TableUpdateSpec, options: MetadataBuildOptions = {}): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;

  return compactObject({
    DisplayName: spec.displayName ? buildLabel(spec.displayName, languageCode) : undefined,
    DisplayCollectionName: spec.pluralDisplayName ? buildLabel(spec.pluralDisplayName, languageCode) : undefined,
    Description: spec.description !== undefined ? buildLabel(spec.description, languageCode) : undefined,
  });
}

export function buildColumnUpdatePayload(spec: ColumnUpdateSpec, options: MetadataBuildOptions = {}): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;

  return compactObject({
    DisplayName: spec.displayName ? buildLabel(spec.displayName, languageCode) : undefined,
    Description: spec.description !== undefined ? buildLabel(spec.description, languageCode) : undefined,
    RequiredLevel: spec.requiredLevel ? buildRequiredLevel(spec.requiredLevel) : undefined,
    OptionSet:
      spec.trueLabel && spec.falseLabel
        ? {
            TrueOption: buildOptionMetadata({ label: spec.trueLabel, value: 1 }, languageCode),
            FalseOption: buildOptionMetadata({ label: spec.falseLabel, value: 0 }, languageCode),
            OptionSetType: 'Boolean',
          }
        : undefined,
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
    AssociatedMenuConfiguration: buildAssociatedMenuConfiguration(
      {
        label: spec.associatedMenuLabel ?? spec.lookup.displayName,
        behavior: spec.associatedMenuBehavior ?? 'useCollectionName',
        group: spec.associatedMenuGroup ?? 'details',
        order: spec.associatedMenuOrder,
      },
      spec.lookup.displayName,
      languageCode
    ),
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

export function buildManyToManyRelationshipCreatePayload(
  spec: ManyToManyRelationshipCreateSpec,
  options: MetadataBuildOptions = {}
): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;

  return compactObject({
    '@odata.type': 'Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata',
    SchemaName: spec.schemaName,
    Entity1LogicalName: spec.entity1LogicalName,
    Entity2LogicalName: spec.entity2LogicalName,
    IntersectEntityName: spec.intersectEntityName ?? resolveLogicalName(spec.schemaName),
    Entity1NavigationPropertyName: spec.entity1NavigationPropertyName,
    Entity2NavigationPropertyName: spec.entity2NavigationPropertyName,
    Entity1AssociatedMenuConfiguration: buildAssociatedMenuConfiguration(spec.entity1Menu, spec.entity1LogicalName, languageCode),
    Entity2AssociatedMenuConfiguration: buildAssociatedMenuConfiguration(spec.entity2Menu, spec.entity2LogicalName, languageCode),
  });
}

export function buildCustomerRelationshipCreatePayload(
  spec: CustomerRelationshipCreateSpec,
  options: MetadataBuildOptions = {}
): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;
  const lookupLogicalName = resolveLogicalName(spec.lookup.schemaName, spec.lookup.logicalName);

  return compactObject({
    Lookup: compactObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.ComplexLookupAttributeMetadata',
      AttributeType: 'Lookup',
      AttributeTypeName: { Value: 'LookupType' },
      SchemaName: spec.lookup.schemaName,
      LogicalName: lookupLogicalName,
      DisplayName: buildLabel(spec.lookup.displayName, languageCode),
      Description: spec.lookup.description ? buildLabel(spec.lookup.description, languageCode) : undefined,
      RequiredLevel: buildRequiredLevel(spec.lookup.requiredLevel ?? 'none'),
    }),
    OneToManyRelationships: [
      buildCustomerOneToManyRelationship(
        spec.accountRelationshipSchemaName ?? `${spec.tableLogicalName}_${lookupLogicalName}_account`,
        'account',
        spec.accountReferencedAttribute ?? 'id',
        spec.tableLogicalName,
        spec.accountMenu,
        spec.lookup.displayName,
        languageCode
      ),
      buildCustomerOneToManyRelationship(
        spec.contactRelationshipSchemaName ?? `${spec.tableLogicalName}_${lookupLogicalName}_contact`,
        'contact',
        spec.contactReferencedAttribute ?? 'id',
        spec.tableLogicalName,
        spec.contactMenu,
        spec.lookup.displayName,
        languageCode
      ),
    ],
  });
}

export function buildOneToManyRelationshipUpdatePayload(
  spec: OneToManyRelationshipUpdateSpec,
  currentRelationship: {
    associatedMenuLabel?: string;
    lookupDisplayName?: string;
    associatedMenuBehavior?: z.output<typeof associatedMenuBehaviorSchema>;
    associatedMenuGroup?: z.output<typeof associatedMenuGroupSchema>;
    associatedMenuOrder?: number;
  },
  options: MetadataBuildOptions = {}
): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;

  const menuConfigured =
    spec.associatedMenuLabel !== undefined ||
    spec.associatedMenuBehavior !== undefined ||
    spec.associatedMenuGroup !== undefined ||
    spec.associatedMenuOrder !== undefined;

  const fallbackLabel = currentRelationship.associatedMenuLabel ?? currentRelationship.lookupDisplayName ?? 'Related';

  return compactObject({
    AssociatedMenuConfiguration: menuConfigured
      ? buildAssociatedMenuConfiguration(
          {
            label: spec.associatedMenuLabel ?? currentRelationship.associatedMenuLabel ?? currentRelationship.lookupDisplayName,
            behavior: spec.associatedMenuBehavior ?? currentRelationship.associatedMenuBehavior ?? 'useCollectionName',
            group: spec.associatedMenuGroup ?? currentRelationship.associatedMenuGroup ?? 'details',
            order: spec.associatedMenuOrder ?? currentRelationship.associatedMenuOrder ?? 10000,
          },
          fallbackLabel,
          languageCode
        )
      : undefined,
    CascadeConfiguration: spec.cascade
      ? compactObject({
          Assign: spec.cascade.assign ? mapCascadeType(spec.cascade.assign) : undefined,
          Delete: spec.cascade.delete ? mapCascadeType(spec.cascade.delete) : undefined,
          Merge: spec.cascade.merge ? mapCascadeType(spec.cascade.merge) : undefined,
          Reparent: spec.cascade.reparent ? mapCascadeType(spec.cascade.reparent) : undefined,
          Share: spec.cascade.share ? mapCascadeType(spec.cascade.share) : undefined,
          Unshare: spec.cascade.unshare ? mapCascadeType(spec.cascade.unshare) : undefined,
        })
      : undefined,
  });
}

export function buildManyToManyRelationshipUpdatePayload(
  spec: ManyToManyRelationshipUpdateSpec,
  currentRelationship: {
    entity1LogicalName?: string;
    entity2LogicalName?: string;
    entity1Menu?: {
      label?: string;
      behavior?: z.output<typeof associatedMenuBehaviorSchema>;
      group?: z.output<typeof associatedMenuGroupSchema>;
      order?: number;
    };
    entity2Menu?: {
      label?: string;
      behavior?: z.output<typeof associatedMenuBehaviorSchema>;
      group?: z.output<typeof associatedMenuGroupSchema>;
      order?: number;
    };
  },
  options: MetadataBuildOptions = {}
): Record<string, unknown> {
  const languageCode = options.languageCode ?? 1033;

  return compactObject({
    Entity1AssociatedMenuConfiguration: spec.entity1Menu
      ? buildAssociatedMenuConfiguration(
          {
            label: spec.entity1Menu.label ?? currentRelationship.entity1Menu?.label,
            behavior: spec.entity1Menu.behavior ?? currentRelationship.entity1Menu?.behavior ?? 'useCollectionName',
            group: spec.entity1Menu.group ?? currentRelationship.entity1Menu?.group ?? 'details',
            order: spec.entity1Menu.order ?? currentRelationship.entity1Menu?.order ?? 10000,
          },
          currentRelationship.entity1LogicalName ?? 'Entity1',
          languageCode
        )
      : undefined,
    Entity2AssociatedMenuConfiguration: spec.entity2Menu
      ? buildAssociatedMenuConfiguration(
          {
            label: spec.entity2Menu.label ?? currentRelationship.entity2Menu?.label,
            behavior: spec.entity2Menu.behavior ?? currentRelationship.entity2Menu?.behavior ?? 'useCollectionName',
            group: spec.entity2Menu.group ?? currentRelationship.entity2Menu?.group ?? 'details',
            order: spec.entity2Menu.order ?? currentRelationship.entity2Menu?.order ?? 10000,
          },
          currentRelationship.entity2LogicalName ?? 'Entity2',
          languageCode
        )
      : undefined,
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

function buildAssociatedMenuConfiguration(
  menu:
    | {
        label?: string;
        behavior?: z.output<typeof associatedMenuBehaviorSchema>;
        group?: z.output<typeof associatedMenuGroupSchema>;
        order?: number;
      }
    | undefined,
  fallbackLabel: string,
  languageCode: number
): Record<string, unknown> {
  return {
    Behavior: mapAssociatedMenuBehavior(menu?.behavior ?? 'useCollectionName'),
    Group: mapAssociatedMenuGroup(menu?.group ?? 'details'),
    Label: buildLabel(menu?.label ?? fallbackLabel, languageCode),
    Order: menu?.order ?? 10000,
  };
}

function buildCustomerOneToManyRelationship(
  schemaName: string,
  referencedEntity: string,
  referencedAttribute: string,
  referencingEntity: string,
  menu: z.output<typeof associatedMenuConfigSchema> | undefined,
  fallbackLabel: string,
  languageCode: number
): Record<string, unknown> {
  return compactObject({
    SchemaName: schemaName,
    ReferencedEntity: referencedEntity,
    ReferencedAttribute: normalizeReferencedAttribute(referencedEntity, referencedAttribute),
    ReferencingEntity: referencingEntity,
    AssociatedMenuConfiguration: buildAssociatedMenuConfiguration(menu, fallbackLabel, languageCode),
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
