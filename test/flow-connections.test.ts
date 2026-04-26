import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFlowConnectionModel,
  compatibleEnvironmentConnections,
  removeFlowConnectionReference,
  setActionConnectionReference,
  setFlowConnectionReference,
  type FlowEnvironmentConnection
} from '../src/ui-react/automate/flow-connections.js';

const dataverseConnection: FlowEnvironmentConnection = {
  name: 'shared-commondataser-da8725a8',
  id: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps/connections/shared-commondataser-da8725a8',
  displayName: 'callum@example.test',
  apiName: 'shared_commondataserviceforapps',
  apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
  status: 'Connected'
};

const dataverseConnectionWithSolutionReference: FlowEnvironmentConnection = {
  ...dataverseConnection,
  solutionReferences: [
    {
      id: 'd44dc40b-3e3a-f111-88b5-6045bde68dac',
      logicalName: 'new_sharedcommondataserviceforapps_7f348',
      displayName: 'Microsoft Dataverse'
    }
  ]
};

const outlookConnection: FlowEnvironmentConnection = {
  name: 'office-connection',
  id: '/providers/Microsoft.PowerApps/apis/shared_office365users/connections/office-connection',
  displayName: 'callum@example.test',
  apiName: 'shared_office365users',
  apiId: '/providers/Microsoft.PowerApps/apis/shared_office365users',
  status: 'Connected'
};

test('flow connection model binds references to environment connections and action usages', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_commondataserviceforapps: {
          connectionName: dataverseConnection.name,
          api: { name: 'shared_commondataserviceforapps', id: dataverseConnection.apiId }
        }
      },
      definition: {
        actions: {
          List_rows: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: 'shared_commondataserviceforapps',
                operationId: 'ListRecords',
                apiId: dataverseConnection.apiId
              }
            }
          }
        }
      }
    }
  });

  const model = buildFlowConnectionModel(source, [dataverseConnection]);

  assert.equal(model.references.length, 1);
  assert.equal(model.references[0].status, 'bound');
  assert.equal(model.references[0].connection?.name, dataverseConnection.name);
  assert.deepEqual(
    model.references[0].usages.map((usage) => usage.name),
    ['List_rows']
  );
  assert.equal(model.issues.filter((issue) => issue.level === 'error').length, 0);
});

test('compatible environment connections accept shared connector aliases', () => {
  const model = buildFlowConnectionModel(JSON.stringify({ properties: { definition: { actions: {} } } }), [dataverseConnection, outlookConnection]);

  assert.deepEqual(
    compatibleEnvironmentConnections(model, 'commondataserviceforapps').map((connection) => connection.name),
    [dataverseConnection.name]
  );
  assert.deepEqual(
    compatibleEnvironmentConnections(model, dataverseConnection.apiId).map((connection) => connection.name),
    [dataverseConnection.name]
  );
});

test('flow connection model accepts Flow detail Dataverse API aliases', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_commondataserviceforapps: {
          connectionName: dataverseConnection.name,
          connectionReferenceLogicalName: 'new_sharedcommondataserviceforapps_7f348',
          source: 'Embedded',
          id: dataverseConnection.apiId,
          displayName: 'Microsoft Dataverse',
          apiName: 'commondataserviceforapps'
        }
      },
      definition: {
        actions: {
          List_accounts: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: 'shared_commondataserviceforapps',
                operationId: 'ListRecords',
                apiId: dataverseConnection.apiId
              }
            }
          }
        }
      }
    }
  });

  const model = buildFlowConnectionModel(source, [dataverseConnection]);

  assert.equal(model.references[0].status, 'bound');
  assert.equal(model.references[0].apiName, 'shared_commondataserviceforapps');
  assert.equal(model.references[0].apiDisplayName, 'Microsoft Dataverse');
  assert.equal(model.references[0].connection?.name, dataverseConnection.name);
  assert.deepEqual(
    model.references[0].usages.map((usage) => usage.name),
    ['List_accounts']
  );
  assert.equal(model.issues.filter((issue) => issue.level === 'error').length, 0);
});

test('flow connection model handles embedded solution logical references', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_commondataserviceforapps_1: {
          runtimeSource: 'embedded',
          connection: { connectionReferenceLogicalName: 'msdyn_Dataverse' },
          api: { name: 'shared_commondataserviceforapps' }
        }
      },
      definition: {
        actions: {
          Search_rows: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionName: 'shared_commondataserviceforapps_1',
                operationId: 'GetRelevantRows',
                apiId: dataverseConnection.apiId
              }
            }
          }
        }
      }
    }
  });

  const model = buildFlowConnectionModel(source, []);

  assert.equal(model.references[0].status, 'logical');
  assert.equal(model.references[0].logicalName, 'msdyn_Dataverse');
  assert.equal(model.references[0].usages[0].name, 'Search_rows');
  assert.equal(
    model.issues.some((issue) => issue.code === 'CONNECTION_REFERENCE_LOGICAL'),
    true
  );
  assert.equal(
    model.issues.some((issue) => issue.level === 'error'),
    false
  );
});

test('flow connection model binds logical solution references to matching environment connections', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_commondataserviceforapps_1: {
          runtimeSource: 'embedded',
          connection: { connectionReferenceLogicalName: 'new_sharedcommondataserviceforapps_7f348' },
          api: { name: 'shared_commondataserviceforapps' }
        }
      },
      definition: {
        actions: {
          List_accounts: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionName: 'shared_commondataserviceforapps_1',
                operationId: 'ListRecords',
                apiId: dataverseConnection.apiId
              }
            }
          }
        }
      }
    }
  });

  const model = buildFlowConnectionModel(source, [dataverseConnectionWithSolutionReference]);

  assert.equal(model.references[0].status, 'bound');
  assert.equal(model.references[0].connection?.name, dataverseConnection.name);
  assert.equal(
    model.issues.some((issue) => issue.code === 'CONNECTION_REFERENCE_LOGICAL'),
    false
  );
});

test('flow connection model reports missing and unused references', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        unused_ref: {
          connectionName: 'missing-connection',
          api: { name: 'shared_commondataserviceforapps' }
        }
      },
      definition: {
        actions: {
          Send_mail: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: 'missing_outlook',
                operationId: 'SendEmailV2',
                apiId: outlookConnection.apiId
              }
            }
          }
        }
      }
    }
  });

  const model = buildFlowConnectionModel(source, [outlookConnection]);

  assert.equal(model.references[0].status, 'missing-connection');
  assert.equal(
    model.issues.some((issue) => issue.code === 'CONNECTION_REFERENCE_NOT_FOUND' && issue.referenceName === 'missing_outlook'),
    true
  );
  assert.equal(
    model.issues.some((issue) => issue.code === 'CONNECTION_REFERENCE_UNUSED' && issue.referenceName === 'unused_ref'),
    true
  );
});

test('flow connection model reports connector mismatches', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_commondataserviceforapps: {
          connectionName: outlookConnection.name,
          api: { name: 'shared_commondataserviceforapps' }
        }
      },
      definition: { actions: {} }
    }
  });

  const model = buildFlowConnectionModel(source, [outlookConnection]);

  assert.equal(model.references[0].status, 'wrong-connector');
  assert.equal(
    model.issues.some((issue) => issue.code === 'CONNECTION_API_MISMATCH'),
    true
  );
});

test('flow connection reference edits add, rebind, and remove references', () => {
  const initial = JSON.stringify({ properties: { displayName: 'Flow', definition: { actions: {} } } });
  const added = setFlowConnectionReference(initial, 'shared_commondataserviceforapps', dataverseConnection);
  let parsed = JSON.parse(added);

  assert.equal(parsed.properties.connectionReferences.shared_commondataserviceforapps.connectionName, dataverseConnection.name);
  assert.equal(parsed.properties.connectionReferences.shared_commondataserviceforapps.api.name, dataverseConnection.apiName);

  const rebound = setFlowConnectionReference(added, 'shared_commondataserviceforapps', outlookConnection);
  parsed = JSON.parse(rebound);
  assert.equal(parsed.properties.connectionReferences.shared_commondataserviceforapps.connectionName, outlookConnection.name);
  assert.equal(parsed.properties.connectionReferences.shared_commondataserviceforapps.api.name, outlookConnection.apiName);

  const removed = removeFlowConnectionReference(rebound, 'shared_commondataserviceforapps');
  parsed = JSON.parse(removed);
  assert.deepEqual(parsed.properties.connectionReferences, {});
});

test('flow connection reference edits prefer solution logical reference shape when available', () => {
  const initial = JSON.stringify({ properties: { displayName: 'Flow', definition: { actions: {} } } });
  const added = setFlowConnectionReference(initial, 'shared_commondataserviceforapps', dataverseConnectionWithSolutionReference);
  const parsed = JSON.parse(added);

  assert.equal(parsed.properties.connectionReferences.shared_commondataserviceforapps.connection.connectionReferenceLogicalName, 'new_sharedcommondataserviceforapps_7f348');
  assert.equal(parsed.properties.connectionReferences.shared_commondataserviceforapps.api.name, dataverseConnection.apiName);
  assert.equal(parsed.properties.connectionReferences.shared_commondataserviceforapps.connectionName, undefined);
  assert.equal(parsed.properties.connectionReferences.shared_commondataserviceforapps.connection.name, undefined);
});

test('setActionConnectionReference updates modern and legacy host fields', () => {
  const action = {
    type: 'OpenApiConnection',
    inputs: {
      host: {
        connectionName: 'old_ref',
        connection: { name: 'old_ref', referenceName: 'old_ref' }
      }
    }
  };

  const updated = setActionConnectionReference(action, 'new_ref') as any;

  assert.equal(updated.inputs.host.connectionReferenceName, 'new_ref');
  assert.equal(updated.inputs.host.connectionName, 'new_ref');
  assert.equal(updated.inputs.host.connection.name, 'new_ref');
  assert.equal(updated.inputs.host.connection.referenceName, 'new_ref');
});
