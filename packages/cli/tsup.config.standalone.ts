import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outDir: 'dist-standalone',
  noExternal: [/^@pp\//],
  external: ['playwright-core'],
  clean: true,
  shims: true,
})
