import { defineConfig } from 'tsup';

const esmRequireBanner = [
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
].join('\n');

export default defineConfig(({ watch }) => ({
  entry: ['src/index.ts'],
  clean: !watch,
  dts: true,
  format: ['esm', 'cjs'],
  banner: ({ format }) => (format === 'esm' ? { js: esmRequireBanner } : {}),
}));
