import { spawnSync } from 'node:child_process';

const playwrightArgs = ['exec', 'playwright', 'test', '-c', 'playwright.ui.config.ts', ...process.argv.slice(2)];
const shouldUseXvfb = process.platform === 'linux' && process.env.PP_DESKTOP_E2E_SHOW_WINDOW !== '1' && process.env.PP_DESKTOP_E2E_NO_XVFB !== '1';

const env = {
  ...process.env,
  PP_DESKTOP_E2E_WINDOW_MODE: process.env.PP_DESKTOP_E2E_WINDOW_MODE ?? 'visible'
};

let command = 'pnpm';
let args = playwrightArgs;

if (shouldUseXvfb) {
  const check = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' });
  if (check.error) {
    console.error('xvfb-run was not found. Install Xvfb, set PP_DESKTOP_E2E_SHOW_WINDOW=1 to run visibly, or set PP_DESKTOP_E2E_NO_XVFB=1 to run without Xvfb.');
    process.exit(1);
  }
  command = 'xvfb-run';
  args = ['-a', '-s', '-screen 0 1440x960x24', 'pnpm', ...playwrightArgs];
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
