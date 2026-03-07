import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const packagePaths = [
  'auth',
  'http',
  'diagnostics',
  'cache',
  'config',
  'project',
  'dataverse',
  'solution',
  'model',
  'canvas',
  'flow',
  'artifacts',
  'analysis',
  'sharepoint',
  'powerbi',
  'deploy',
  'cli',
  'mcp',
  'adapters/github-actions',
  'adapters/azure-devops',
  'adapters/power-platform-pipelines',
];

const root = new URL('..', import.meta.url).pathname;

function toPackageName(packagePath) {
  if (packagePath.startsWith('adapters/')) {
    return `@pp/adapter-${packagePath.split('/')[1]}`;
  }

  return `@pp/${packagePath}`;
}

function toExportName(packageName) {
  return packageName.split('/')[1].replace(/-/g, '_');
}

function relativeRootTsconfig(packagePath) {
  return packagePath.includes('/') ? '../../../tsconfig.base.json' : '../../tsconfig.base.json';
}

async function ensureFile(path, content) {
  await mkdir(dirname(path), { recursive: true });

  try {
    await readFile(path, 'utf8');
  } catch {
    await writeFile(path, content, 'utf8');
  }
}

for (const packagePath of packagePaths) {
  const packageDir = join(root, 'packages', packagePath);
  const packageName = toPackageName(packagePath);
  const exportName = toExportName(packageName);
  const isCli = packagePath === 'cli';

  await mkdir(join(packageDir, 'src'), { recursive: true });

  await ensureFile(
    join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version: '0.1.0',
        private: true,
        type: 'module',
        main: './dist/index.cjs',
        module: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
            require: './dist/index.cjs',
          },
        },
        scripts: {
          build: 'tsup src/index.ts --dts --format esm,cjs --clean',
          clean: 'rm -rf dist',
          typecheck: 'tsc --noEmit',
          ...(isCli ? { dev: 'tsx src/index.ts' } : {}),
        },
      },
      null,
      2
    ) + '\n'
  );

  await ensureFile(
    join(packageDir, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: relativeRootTsconfig(packagePath),
        include: ['src/**/*.ts'],
      },
      null,
      2
    ) + '\n'
  );

  await ensureFile(
    join(packageDir, 'src/index.ts'),
    `export const ${exportName}Package = '${packageName}';\n`
  );
}
