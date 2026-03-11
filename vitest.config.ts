import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const workspacePackages = [
  'auth',
  'http',
  'diagnostics',
  'cache',
  'config',
  'project',
  'dataverse',
  'solution',
  'model',
  'artifacts',
  'canvas',
  'flow',
  'analysis',
  'sharepoint',
  'powerbi',
  'deploy',
  'mcp',
  'cli',
] as const;

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(workspacePackages.map((name) => [`@pp/${name}`, resolve(__dirname, `packages/${name}/src/index.ts`)])),
  },
  test: {
    include: ['packages/**/src/**/*.test.ts', '.ops/scripts/**/*.test.ts'],
    coverage: {
      enabled: false,
    },
  },
});
