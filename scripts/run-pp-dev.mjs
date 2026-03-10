import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const forwardedArgs = args[0] === '--' ? args.slice(1) : args;

const child = spawn('pnpm', ['--filter', '@pp/cli', 'dev', '--', ...forwardedArgs], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    INIT_CWD: process.cwd(),
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
