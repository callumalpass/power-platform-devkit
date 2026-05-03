import test from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { findDesktopRoute, routeMatches, type DesktopRoute } from '../src/desktop-api-router.js';

type TestRoute = DesktopRoute<{ marker: string }, { status: number }>;

const routes: TestRoute[] = [
  { method: 'GET', path: '/api/state', handler: () => ({ status: 200 }) },
  { method: 'POST', path: /^\/api\/items\/[^/]+$/, handler: () => ({ status: 201 }) }
];

test('routeMatches handles literal and regex desktop API routes', () => {
  assert.equal(routeMatches('/api/state', '/api/state'), true);
  assert.equal(routeMatches('/api/state', '/api/state/extra'), false);
  assert.equal(routeMatches(/^\/api\/items\/[^/]+$/, '/api/items/abc'), true);
  assert.equal(routeMatches(/^\/api\/items\/[^/]+$/, '/api/items/abc/extra'), false);
});

test('findDesktopRoute selects by method and path', async () => {
  const literal = findDesktopRoute(routes, 'GET', '/api/state');
  assert.ok(literal);
  assert.equal((await literal.handler(new URL('app://pp/api/state'), undefined, { marker: 'x' })).status, 200);

  const regex = findDesktopRoute(routes, 'POST', '/api/items/abc');
  assert.ok(regex);
  assert.equal((await regex.handler(new URL('app://pp/api/items/abc'), undefined, { marker: 'x' })).status, 201);

  assert.equal(findDesktopRoute(routes, 'GET', '/api/items/abc'), undefined);
});
