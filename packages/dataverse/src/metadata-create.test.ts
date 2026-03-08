import { describe, expect, it } from 'vitest';
import {
  buildColumnCreatePayload,
  buildOneToManyRelationshipCreatePayload,
  buildTableCreatePayload,
  parseColumnCreateSpec,
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

  it('builds a one-to-many relationship payload with a lookup definition', () => {
    const payload = buildOneToManyRelationshipCreatePayload({
      schemaName: 'pp_project_account',
      referencedEntity: 'account',
      referencingEntity: 'pp_project',
      lookup: {
        schemaName: 'pp_AccountId',
        displayName: 'Account',
      },
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
});
