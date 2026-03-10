import { describe, expect, it } from 'vitest';
import {
  buildColumnCreatePayload,
  buildCustomerRelationshipCreatePayload,
  buildManyToManyRelationshipCreatePayload,
  buildOneToManyRelationshipCreatePayload,
  buildTableCreatePayload,
  parseColumnCreateSpec,
  parseGlobalOptionSetUpdateSpec,
  parseTableCreateSpec,
} from './metadata-create';

describe('metadata-create specs', () => {
  it('parses a valid table creation spec', () => {
    const result = parseTableCreateSpec({
      schemaName: 'pp_Project',
      displayName: 'Project',
      pluralDisplayName: 'Projects',
      primaryName: {
        schemaName: 'pp_Name',
        displayName: 'Name',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      schemaName: 'pp_Project',
      ownership: 'userOwned',
      primaryName: {
        schemaName: 'pp_Name',
        maxLength: 100,
      },
    });
  });

  it('rejects choice columns that specify both local and global options', () => {
    const result = parseColumnCreateSpec({
      kind: 'choice',
      schemaName: 'pp_Status',
      displayName: 'Status',
      options: [{ label: 'New' }],
      globalOptionSetName: 'pp_status',
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DATAVERSE_METADATA_COLUMN_SPEC_INVALID');
  });

  it('parses global option set update operations', () => {
    const result = parseGlobalOptionSetUpdateSpec({
      name: 'pp_status',
      add: [{ label: 'Paused' }],
      update: [{ value: 100000000, label: 'New', mergeLabels: false }],
      removeValues: [100000009],
      orderValues: [100000000, 100000001],
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: 'pp_status',
      add: [{ label: 'Paused' }],
      update: [{ value: 100000000, label: 'New', mergeLabels: false }],
      removeValues: [100000009],
      orderValues: [100000000, 100000001],
    });
  });
});

describe('metadata-create payloads', () => {
  it('builds a table payload with a primary name attribute', () => {
    const payload = buildTableCreatePayload({
      schemaName: 'pp_Project',
      displayName: 'Project',
      pluralDisplayName: 'Projects',
      ownership: 'userOwned',
      hasActivities: false,
      hasNotes: true,
      isActivity: false,
      primaryName: {
        schemaName: 'pp_Name',
        displayName: 'Name',
        maxLength: 200,
      },
    });

    expect(payload).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
      SchemaName: 'pp_Project',
      LogicalName: 'pp_project',
      PrimaryNameAttribute: 'pp_name',
      HasNotes: true,
    });
    expect(payload.Attributes).toHaveLength(1);
    expect((payload.Attributes as Array<Record<string, unknown>>)[0]).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
      SchemaName: 'pp_Name',
      LogicalName: 'pp_name',
      IsPrimaryName: true,
      MaxLength: 200,
    });
  });

  it('builds a global choice column payload using odata bind', () => {
    const payload = buildColumnCreatePayload({
      kind: 'choice',
      schemaName: 'pp_Status',
      displayName: 'Status',
      globalOptionSetName: 'pp_status',
    });

    expect(payload).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
      SchemaName: 'pp_Status',
      LogicalName: 'pp_status',
      'GlobalOptionSet@odata.bind': "/GlobalOptionSetDefinitions(Name='pp_status')",
    });
    expect(payload.OptionSet).toBeUndefined();
  });

  it('builds a local choice column payload with a non-global option set', () => {
    const payload = buildColumnCreatePayload({
      kind: 'choice',
      schemaName: 'pp_Status',
      displayName: 'Status',
      options: [{ label: 'Proposed' }, { label: 'Active' }],
    });

    expect(payload).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
      SchemaName: 'pp_Status',
      LogicalName: 'pp_status',
      OptionSet: {
        '@odata.type': 'Microsoft.Dynamics.CRM.OptionSetMetadata',
        IsGlobal: false,
        OptionSetType: 'Picklist',
      },
    });
  });

  it('builds an autonumber column payload', () => {
    const payload = buildColumnCreatePayload({
      kind: 'autonumber',
      schemaName: 'pp_ProjectNumber',
      displayName: 'Project Number',
      autoNumberFormat: 'PROJ-{SEQNUM:6}',
      maxLength: 20,
    });

    expect(payload).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
      SchemaName: 'pp_ProjectNumber',
      LogicalName: 'pp_projectnumber',
      AutoNumberFormat: 'PROJ-{SEQNUM:6}',
      MaxLength: 20,
    });
  });

  it('builds file and image column payloads', () => {
    const filePayload = buildColumnCreatePayload({
      kind: 'file',
      schemaName: 'pp_Specification',
      displayName: 'Specification',
      maxSizeInKB: 10240,
    });
    const imagePayload = buildColumnCreatePayload({
      kind: 'image',
      schemaName: 'pp_Thumbnail',
      displayName: 'Thumbnail',
      maxSizeInKB: 5120,
      canStoreFullImage: true,
    });

    expect(filePayload).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.FileAttributeMetadata',
      AttributeTypeName: { Value: 'FileType' },
      MaxSizeInKB: 10240,
    });
    expect(imagePayload).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.ImageAttributeMetadata',
      AttributeTypeName: { Value: 'ImageType' },
      MaxSizeInKB: 5120,
      CanStoreFullImage: true,
    });
  });

  it('builds a one-to-many relationship payload with a lookup definition', () => {
    const payload = buildOneToManyRelationshipCreatePayload({
      schemaName: 'pp_project_account',
      referencedEntity: 'account',
      referencedAttribute: 'id',
      referencingEntity: 'pp_project',
      lookup: {
        schemaName: 'pp_AccountId',
        displayName: 'Account',
      },
      associatedMenuBehavior: 'useCollectionName',
      associatedMenuGroup: 'details',
      associatedMenuOrder: 10000,
    });

    expect(payload).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
      SchemaName: 'pp_project_account',
      ReferencedEntity: 'account',
      ReferencedAttribute: 'accountid',
      ReferencingEntity: 'pp_project',
    });
    expect(payload.Lookup).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.LookupAttributeMetadata',
      SchemaName: 'pp_AccountId',
      LogicalName: 'pp_accountid',
    });
  });

  it('builds a many-to-many relationship payload', () => {
    const payload = buildManyToManyRelationshipCreatePayload({
      schemaName: 'pp_project_contact',
      entity1LogicalName: 'pp_project',
      entity2LogicalName: 'contact',
      entity1Menu: {
        label: 'Contacts',
        behavior: 'useCollectionName',
        group: 'details',
        order: 10000,
      },
    });

    expect(payload).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata',
      SchemaName: 'pp_project_contact',
      Entity1LogicalName: 'pp_project',
      Entity2LogicalName: 'contact',
      IntersectEntityName: 'pp_project_contact',
    });
  });

  it('builds a customer relationship action payload', () => {
    const payload = buildCustomerRelationshipCreatePayload({
      tableLogicalName: 'pp_project',
      lookup: {
        schemaName: 'pp_CustomerId',
        displayName: 'Customer',
      },
      accountReferencedAttribute: 'id',
      contactReferencedAttribute: 'id',
    });

    expect(payload.Lookup).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.ComplexLookupAttributeMetadata',
      SchemaName: 'pp_CustomerId',
      LogicalName: 'pp_customerid',
    });
    expect(payload.OneToManyRelationships).toMatchObject([
      {
        ReferencedEntity: 'account',
        ReferencingEntity: 'pp_project',
      },
      {
        ReferencedEntity: 'contact',
        ReferencingEntity: 'pp_project',
      },
    ]);
  });
});
