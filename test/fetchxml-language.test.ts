import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFetchXml, type FetchXmlLanguageEntity } from '../src/fetchxml-language.js';

test('FetchXML entity completions match entity set names but insert logical names', () => {
  const source = '<fetch><entity name="workflows"></entity></fetch>';
  const cursor = source.indexOf('"></entity>');
  const result = analyzeFetchXml(source, cursor, {
    entities: [
      {
        logicalName: 'workflow',
        displayName: 'Process',
        entitySetName: 'workflows',
        attributes: []
      }
    ]
  });

  assert.equal(result.context.kind, 'attribute-value');
  assert.equal(result.context.elementName, 'entity');
  assert.equal(result.context.attributeName, 'name');
  assert.ok(result.completions.some((item) => item.label === 'workflow' && item.info === 'workflows'));
});

test('FetchXML empty entity-name completions include entities beyond the default cap', () => {
  const source = '<fetch><entity name=""></entity></fetch>';
  const cursor = source.indexOf('"></entity>');
  const entities: FetchXmlLanguageEntity[] = Array.from({ length: 150 }, (_, index) => ({
    logicalName: `entity${String(index).padStart(3, '0')}`,
    attributes: []
  }));
  entities.push({
    logicalName: 'workflow',
    displayName: 'Process',
    entitySetName: 'workflows',
    attributes: []
  });

  const result = analyzeFetchXml(source, cursor, { entities });

  assert.ok(result.completions.length > 100);
  assert.ok(result.completions.some((item) => item.label === 'workflow'));
});

test('FetchXML nested attribute completions follow the entity named in the XML', () => {
  const source = '<fetch><entity name="contact"><attribute name="" /></entity></fetch>';
  const cursor = source.indexOf('" /></entity>');
  const result = analyzeFetchXml(source, cursor, {
    rootEntityName: 'account',
    entities: [entity('account', ['accountid', 'name']), entity('contact', ['contactid', 'fullname'])]
  });

  assert.equal(result.context.entityScope, 'contact');
  assert.deepEqual(completionLabels(result), ['contactid', 'fullname']);
});

test('FetchXML nested attribute completions read single-quoted entity names', () => {
  const source = "<fetch><entity name='contact'><attribute name='' /></entity></fetch>";
  const cursor = source.indexOf("' /></entity>");
  const result = analyzeFetchXml(source, cursor, {
    rootEntityName: 'account',
    entities: [entity('account', ['accountid', 'name']), entity('contact', ['contactid', 'fullname'])]
  });

  assert.equal(result.context.entityScope, 'contact');
  assert.deepEqual(completionLabels(result), ['contactid', 'fullname']);
});

test('FetchXML nested attribute completions read unquoted entity names while editing', () => {
  const source = '<fetch><entity name=contact><attribute name="" /></entity></fetch>';
  const cursor = source.indexOf('" /></entity>');
  const result = analyzeFetchXml(source, cursor, {
    rootEntityName: 'account',
    entities: [entity('account', ['accountid', 'name']), entity('contact', ['contactid', 'fullname'])]
  });

  assert.equal(result.context.entityScope, 'contact');
  assert.deepEqual(completionLabels(result), ['contactid', 'fullname']);
});

test('FetchXML condition attribute and operator completions follow the entity named in the XML', () => {
  const metadata = {
    rootEntityName: 'account',
    entities: [
      entity('account', ['accountid', 'name']),
      {
        logicalName: 'contact',
        attributes: [
          { logicalName: 'contactid', attributeTypeName: 'LookupType' },
          { logicalName: 'birthdate', attributeTypeName: 'DateTimeType' }
        ]
      }
    ]
  };

  const attributeSource = '<fetch><entity name="contact"><filter><condition attribute="" operator="eq" /></filter></entity></fetch>';
  const attributeResult = analyzeFetchXml(attributeSource, attributeSource.indexOf('" operator='), metadata);
  assert.equal(attributeResult.context.entityScope, 'contact');
  assert.deepEqual(completionLabels(attributeResult), ['contactid', 'birthdate']);

  const operatorSource = '<fetch><entity name="contact"><filter><condition attribute="birthdate" operator="" /></filter></entity></fetch>';
  const operatorResult = analyzeFetchXml(operatorSource, operatorSource.indexOf('" /></filter>'), metadata);
  assert.ok(completionLabels(operatorResult).includes('today'));
  assert.equal(completionLabels(operatorResult).includes('like'), false);
});

test('FetchXML link-entity completions use linked and parent entity scopes correctly', () => {
  const metadata = {
    rootEntityName: 'account',
    entities: [entity('account', ['accountid', 'name', 'primarycontactid']), entity('contact', ['contactid', 'fullname', 'parentcustomerid'])]
  };

  const fromSource = '<fetch><entity name="account"><link-entity name="contact" from="" to="primarycontactid"></link-entity></entity></fetch>';
  const fromResult = analyzeFetchXml(fromSource, fromSource.indexOf('" to='), metadata);
  assert.deepEqual(completionLabels(fromResult), ['contactid', 'fullname', 'parentcustomerid']);

  const toSource = '<fetch><entity name="account"><link-entity name="contact" from="contactid" to=""></link-entity></entity></fetch>';
  const toResult = analyzeFetchXml(toSource, toSource.indexOf('"></link-entity>'), metadata);
  assert.deepEqual(completionLabels(toResult), ['accountid', 'name', 'primarycontactid']);

  const nestedSource = '<fetch><entity name="account"><link-entity name="contact" from="contactid" to="primarycontactid"><attribute name="" /></link-entity></entity></fetch>';
  const nestedResult = analyzeFetchXml(nestedSource, nestedSource.indexOf('" /></link-entity>'), metadata);
  assert.equal(nestedResult.context.entityScope, 'contact');
  assert.deepEqual(completionLabels(nestedResult), ['contactid', 'fullname', 'parentcustomerid']);
});

function entity(logicalName: string, attributeNames: string[]): FetchXmlLanguageEntity {
  return {
    logicalName,
    attributes: attributeNames.map((attributeName) => ({
      logicalName: attributeName,
      attributeTypeName: attributeName.endsWith('id') ? 'LookupType' : 'StringType'
    }))
  };
}

function completionLabels(result: ReturnType<typeof analyzeFetchXml>): string[] {
  return result.completions.map((item) => item.label);
}
