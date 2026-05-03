import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCanvasAppId as normalizeCanvasAppIdFromService } from '../src/services/canvas-authoring.js';
import {
  buildCanvasAuthoringBaseUrl,
  buildCanvasAuthoringInvokeUrl,
  buildCanvasAuthoringSessionStartUrl,
  buildCanvasAuthoringSignalRWebsocketUrl,
  buildVersionedCanvasAuthoringUrl,
  normalizeCanvasAppId
} from '../src/services/canvas-authoring-url.js';

test('normalizeCanvasAppId accepts raw, resource, and URL-encoded app ids', () => {
  const appId = '4a18698e-7be8-413c-a5ff-d8ff0d02da71';

  assert.equal(normalizeCanvasAppId(appId), appId);
  assert.equal(normalizeCanvasAppId(`/providers/Microsoft.PowerApps/apps/${appId}`), appId);
  assert.equal(normalizeCanvasAppId(encodeURIComponent(`/providers/Microsoft.PowerApps/apps/${appId}`)), appId);
  assert.equal(normalizeCanvasAppIdFromService(appId), appId);
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

test('buildCanvasAuthoringInvokeUrl appends versioned invoke path', () => {
  assert.equal(
    buildCanvasAuthoringInvokeUrl({
      authoringBaseUrl: 'https://authoring.au-il102.gateway.prod.island.powerapps.com',
      webAuthoringVersion: '/v3.25042.10'
    }),
    'https://authoring.au-il102.gateway.prod.island.powerapps.com/v3.25042.10/api/v2/invoke'
  );
});

test('buildVersionedCanvasAuthoringUrl preserves absolute and already versioned paths', () => {
  const session = {
    authoringBaseUrl: 'https://authoring.au-il102.gateway.prod.island.powerapps.com',
    webAuthoringVersion: 'v3.25042.10'
  };

  assert.equal(buildVersionedCanvasAuthoringUrl(session, 'api/status'), 'https://authoring.au-il102.gateway.prod.island.powerapps.com/v3.25042.10/api/status');
  assert.equal(buildVersionedCanvasAuthoringUrl(session, '/v3.25042.10/api/status'), 'https://authoring.au-il102.gateway.prod.island.powerapps.com/v3.25042.10/api/status');
  assert.equal(buildVersionedCanvasAuthoringUrl(session, 'https://example.test/custom'), 'https://example.test/custom');
});

test('buildCanvasAuthoringSignalRWebsocketUrl uses negotiate token and connection id', () => {
  const url = new URL(
    buildCanvasAuthoringSignalRWebsocketUrl(
      {
        authoringBaseUrl: 'https://authoring.au-il102.gateway.prod.island.powerapps.com',
        webAuthoringVersion: 'v3.25042.10',
        sessionId: 'session-1',
        sessionState: 'state-1'
      },
      {
        url: 'https://authoring.au-il102.gateway.prod.island.powerapps.com/v3.25042.10/api/signalr/diagnosticshub?existing=1',
        accessToken: 'negotiate-token',
        connectionId: 'connection-1'
      },
      'fallback-token'
    )
  );

  assert.equal(url.protocol, 'wss:');
  assert.equal(url.searchParams.get('existing'), '1');
  assert.equal(url.searchParams.get('id'), 'connection-1');
  assert.equal(url.searchParams.get('access_token'), 'negotiate-token');
  assert.equal(url.searchParams.get('x-ms-client-session-id'), 'session-1');
  assert.equal(url.searchParams.get('x-ms-session-state'), 'state-1');
});
