import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workRoot = join(repoRoot, '.tmp-test', 'consumer-package');

await rm(workRoot, { recursive: true, force: true });
await mkdir(join(workRoot, 'pack'), { recursive: true });
