import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const forwardedArgs = args[0] === '--' ? args.slice(1) : args;

process.env.INIT_CWD ??= process.cwd();

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'packages/cli/src/index.ts', ...forwardedArgs],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
