import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktop, createDesktopBuildPaths } from './desktop-build-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

await buildDesktop(createDesktopBuildPaths(repoRoot));
