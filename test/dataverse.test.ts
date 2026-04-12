import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataverseODataPath, buildFetchXml } from '../src/services/dataverse.js';

test('buildDataverseODataPath builds encoded OData query paths', () => {
  const path = buildDataverseODataPath({
    environmentAlias: 'dev',
    entitySetName: 'accounts',
    select: ['accountid', 'name'],
    filter: "contains(name,'Contoso North')",
    orderBy: ['name asc', 'createdon desc'],
    expand: ['primarycontactid($select=fullname,emailaddress1)'],
    top: 25,
    includeCount: true,
  });

  assert.equal(
    path,
    "/api/data/v9.2/accounts?%24select=accountid%2Cname&%24filter=contains%28name%2C%27Contoso+North%27%29&%24orderby=name+asc%2Ccreatedon+desc&%24expand=primarycontactid%28%24select%3Dfullname%2Cemailaddress1%29&%24top=25&%24count=true",
  );
});

test('buildDataverseODataPath normalizes raw paths without double-prefixing api/data', () => {
  assert.equal(
    buildDataverseODataPath({ environmentAlias: 'dev', entitySetName: '', rawPath: '/api/data/v9.2/accounts?$top=5' }),
    '/api/data/v9.2/accounts?$top=5',
  );
  assert.equal(
    buildDataverseODataPath({ environmentAlias: 'dev', entitySetName: '', rawPath: 'contacts?$select=fullname' }),
    '/api/data/v9.2/contacts?$select=fullname',
  );
});

test('buildFetchXml emits attributes, filters, ordering, and linked entities', () => {
  const xml = buildFetchXml({
    environmentAlias: 'dev',
    entity: 'account',
    attributes: ['accountid', 'name'],
    top: 10,
    distinct: true,
    conditions: [
      { attribute: 'name', operator: 'like', value: '%Contoso%' },
      { attribute: 'statecode', operator: 'eq', value: '0' },
    ],
    orders: [{ attribute: 'name', descending: false }],
    linkEntities: [{
      name: 'contact',
      from: 'contactid',
      to: 'primarycontactid',
      alias: 'primary',
      linkType: 'outer',
      attributes: ['fullname'],
      conditions: [{ attribute: 'emailaddress1', operator: 'not-null' }],
    }],
  });

  assert.match(xml, /<fetch version="1\.0" mapping="logical" distinct="true" top="10">/);
  assert.match(xml, /<entity name="account">/);
  assert.match(xml, /<attribute name="accountid" \/>/);
  assert.match(xml, /<condition attribute="name" operator="like" value="%Contoso%" \/>/);
  assert.match(xml, /<order attribute="name" \/>/);
  assert.match(xml, /<link-entity name="contact" from="contactid" to="primarycontactid" link-type="outer" alias="primary">/);
  assert.match(xml, /<attribute name="fullname" \/>/);
  assert.match(xml, /<condition attribute="emailaddress1" operator="not-null" \/>/);
});

test('buildFetchXml returns raw XML unchanged when provided', () => {
  const rawXml = '<fetch><entity name="account" /></fetch>';
  assert.equal(buildFetchXml({ environmentAlias: 'dev', entity: 'account', rawXml }), rawXml);
});
