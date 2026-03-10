import { describe, expect, it } from 'vitest';
import { resolvePowerBiTarget, resolveSharePointTarget } from './provider-targets';

describe('resolveSharePointTarget', () => {
  it('resolves nested SharePoint bindings and inherits auth profiles', () => {
    const result = resolveSharePointTarget(
      {
        providerBindings: {
          financeSite: {
            kind: 'sharepoint-site',
            target: 'https://example.sharepoint.com/sites/finance',
            metadata: {
              authProfile: 'graph-user',
            },
          },
          financeDocuments: {
            kind: 'sharepoint-file',
            target: '/Shared Documents/Budget.xlsx',
            metadata: {
              site: 'financeSite',
              drive: 'Documents',
            },
          },
        },
      },
      'financeDocuments',
      {
        expectedKind: 'sharepoint-file',
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      kind: 'sharepoint-file',
      bindingName: 'financeDocuments',
      authProfile: 'graph-user',
      metadata: {
        site: 'financeSite',
        drive: 'Documents',
      },
      site: {
        bindingName: 'financeSite',
        value: 'https://example.sharepoint.com/sites/finance',
        source: 'binding',
        referenceType: 'url',
      },
      drive: {
        value: 'Documents',
        source: 'binding',
        referenceType: 'name',
      },
      file: {
        bindingName: 'financeDocuments',
        value: '/Shared Documents/Budget.xlsx',
        source: 'binding',
        referenceType: 'path',
      },
    });
  });

  it('requires a site reference when resolving a raw SharePoint list target', () => {
    const result = resolveSharePointTarget(
      {
        providerBindings: {},
      },
      'Campaigns',
      {
        expectedKind: 'sharepoint-list',
      }
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('PROJECT_SHAREPOINT_SITE_REQUIRED');
  });
});

describe('resolvePowerBiTarget', () => {
  it('resolves Power BI dataset bindings through workspace bindings', () => {
    const result = resolvePowerBiTarget(
      {
        providerBindings: {
          financeWorkspace: {
            kind: 'powerbi-workspace',
            target: 'Finance',
            metadata: {
              authProfile: 'powerbi-user',
            },
          },
          financeDataset: {
            kind: 'powerbi-dataset',
            target: 'Budget Model',
            metadata: {
              workspace: 'financeWorkspace',
            },
          },
        },
      },
      'financeDataset',
      {
        expectedKind: 'powerbi-dataset',
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      kind: 'powerbi-dataset',
      bindingName: 'financeDataset',
      authProfile: 'powerbi-user',
      metadata: {
        workspace: 'financeWorkspace',
      },
      workspace: {
        bindingName: 'financeWorkspace',
        value: 'Finance',
        source: 'binding',
        referenceType: 'name',
      },
      dataset: {
        bindingName: 'financeDataset',
        value: 'Budget Model',
        source: 'binding',
        referenceType: 'name',
      },
    });
  });

  it('detects recursive Power BI bindings', () => {
    const result = resolvePowerBiTarget(
      {
        providerBindings: {
          datasetA: {
            kind: 'powerbi-dataset',
            target: 'Sales',
            metadata: {
              workspace: 'datasetA',
            },
          },
        },
      },
      'datasetA',
      {
        expectedKind: 'powerbi-dataset',
      }
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('PROJECT_PROVIDER_BINDING_CYCLE');
  });
});
