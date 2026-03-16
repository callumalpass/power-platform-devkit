import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const workspacePackages = [
  'auth',
  'http',
  'diagnostics',
  'cache',
  'config',
  'dataverse',
  'solution',
  'model',
  'artifacts',
  'canvas',
  'flow',
  'mcp',
  'flow-language-server',
  'cli',
] as const;

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(workspacePackages.map((name) => [`@pp/${name}`, resolve(__dirname, `packages/${name}/src/index.ts`)])),
  },
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    coverage: {
      enabled: false,
    },
  },
});
