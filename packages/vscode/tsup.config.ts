import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  clean: true,
  dts: false,
  sourcemap: true,
  external: ['vscode'],
  noExternal: [/^@pp\//],
});
