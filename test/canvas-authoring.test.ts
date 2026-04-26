import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanvasAuthoringBaseUrl, buildCanvasAuthoringSessionStartUrl, normalizeCanvasAppId } from '../src/services/canvas-authoring.js';

test('normalizeCanvasAppId accepts raw, resource, and URL-encoded app ids', () => {
  const appId = '4a18698e-7be8-413c-a5ff-d8ff0d02da71';

  assert.equal(normalizeCanvasAppId(appId), appId);
  assert.equal(normalizeCanvasAppId(`/providers/Microsoft.PowerApps/apps/${appId}`), appId);
  assert.equal(normalizeCanvasAppId(encodeURIComponent(`/providers/Microsoft.PowerApps/apps/${appId}`)), appId);
});

test('buildCanvasAuthoringBaseUrl builds the authoring gateway host from cluster discovery', () => {
  const result = buildCanvasAuthoringBaseUrl({
    geoName: 'au',
    clusterNumber: 102,
    environment: 'Prod',
    clusterName: 'prdil102seau'
  });

  assert.equal(result.success, true);
  assert.equal(result.data, 'https://authoring.seau-il102.gateway.prod.island.powerapps.com');
});

test('buildCanvasAuthoringSessionStartUrl includes environment and cadence query params', () => {
  const result = buildCanvasAuthoringSessionStartUrl('https://authoring.au-il102.gateway.prod.island.powerapps.com', 'f3f934b0-7b79-e09e-b393-f0b21c05fcce', 'Frequent');

  assert.equal(
    result,
    'https://authoring.au-il102.gateway.prod.island.powerapps.com/api/authoringsession/start?environment-name=f3f934b0-7b79-e09e-b393-f0b21c05fcce&environment-update-cadence=Frequent'
  );
});
