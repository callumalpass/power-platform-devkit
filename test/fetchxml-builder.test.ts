import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFetchXmlPayload, buildRawFetchXml, formatDiagnosticsCount, replaceConditionRow, type ConditionRow, type LinkRow } from '../src/ui-react/dataverse/fetchxml-builder.js';

test('buildRawFetchXml emits selected attributes or all-attributes fallback', () => {
  assert.equal(
    buildRawFetchXml('account', ['name', 'accountnumber']),
    '<fetch top="50">\n  <entity name="account">\n    <attribute name="name" />\n    <attribute name="accountnumber" />\n  </entity>\n</fetch>'
  );
  assert.equal(buildRawFetchXml('contact', []), '<fetch top="50">\n  <entity name="contact">\n    <all-attributes />\n  </entity>\n</fetch>');
});

test('buildFetchXmlPayload normalizes builder rows without undefined optional fields', () => {
  const conditions: ConditionRow[] = [
    { id: 1, attribute: 'name', operator: 'like', value: '%Contoso%' },
    { id: 2, attribute: 'statecode', operator: 'eq', value: '' },
    { id: 3, attribute: '', operator: 'eq', value: 'ignored' }
  ];
  const links: LinkRow[] = [
    {
      id: 4,
      name: 'contact',
      from: 'parentcustomerid',
      to: 'accountid',
      linkType: 'outer',
      alias: '',
      attributes: [],
      conditions: [{ id: 5, attribute: 'emailaddress1', operator: 'not-null', value: '' }]
    },
    {
      id: 6,
      name: '',
      from: 'ownerid',
      to: 'systemuserid',
      linkType: 'inner',
      alias: 'owner',
      attributes: ['fullname'],
      conditions: []
    }
  ];

  const payload = buildFetchXmlPayload({
    environment: 'dev',
    entityName: '',
    entityDetail: { logicalName: 'account', entitySetName: 'accounts' },
    selectedAttrs: ['name'],
    distinct: true,
    filterType: 'and',
    conditions,
    orderAttribute: 'name',
    orderDescending: false,
    links
  });

  assert.deepEqual(payload, {
    environmentAlias: 'dev',
    entity: 'account',
    entitySetName: 'accounts',
    attributes: ['name'],
    distinct: true,
    top: 50,
    filterType: 'and',
    conditions: [
      { attribute: 'name', operator: 'like', value: '%Contoso%' },
      { attribute: 'statecode', operator: 'eq' }
    ],
    orders: [{ attribute: 'name', descending: false }],
    linkEntities: [
      {
        name: 'contact',
        from: 'parentcustomerid',
        to: 'accountid',
        linkType: 'outer',
        conditions: [{ attribute: 'emailaddress1', operator: 'not-null' }]
      }
    ]
  });
});

test('replaceConditionRow updates only matching rows', () => {
  const rows: ConditionRow[] = [
    { id: 1, attribute: 'name', operator: 'eq', value: 'A' },
    { id: 2, attribute: 'accountnumber', operator: 'eq', value: 'B' }
  ];

  assert.deepEqual(replaceConditionRow(rows, 2, { value: 'C' }), [
    { id: 1, attribute: 'name', operator: 'eq', value: 'A' },
    { id: 2, attribute: 'accountnumber', operator: 'eq', value: 'C' }
  ]);
});

test('formatDiagnosticsCount prioritizes errors over warnings', () => {
  assert.equal(formatDiagnosticsCount([]), 'IntelliSense ready');
  assert.equal(formatDiagnosticsCount([{ level: 'warning', message: 'heads up' }]), '1 advisory warning');
  assert.equal(
    formatDiagnosticsCount([
      { level: 'warning', message: 'heads up' },
      { level: 'error', message: 'broken' }
    ]),
    '1 issue'
  );
});
