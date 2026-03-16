import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { extension: 'src/extension.ts' },
    format: ['cjs'],
    clean: true,
    dts: false,
    sourcemap: true,
    external: ['vscode'],
    noExternal: ['vscode-languageclient'],
  },
  {
    entry: {
      'canvas-lsp-server': '../canvas/src/lsp-server.ts',
      'flow-lsp-server': '../flow-language-server/src/server.ts',
    },
    format: ['cjs'],
    clean: false,
    dts: false,
    sourcemap: true,
    noExternal: [/.*/],
  },
]);
