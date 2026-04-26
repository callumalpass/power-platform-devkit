import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cli.ts',
    'src/accounts.ts',
    'src/api.ts',
    'src/auth.ts',
    'src/client.ts',
    'src/config.ts',
    'src/dataverse.ts',
    'src/diagnostics.ts',
    'src/environments.ts',
    'src/experimental/canvas-authoring.ts',
    'src/fetchxml-language.ts',
    'src/flow-language.ts',
    'src/mcp.ts',
    'src/mcp-server.ts',
    'src/request.ts',
    'src/setup.ts'
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022'
});
