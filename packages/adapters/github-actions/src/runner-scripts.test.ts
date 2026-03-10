import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolveRepoPath } from '../../../../test/golden';

function runScript(scriptName: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [resolveRepoPath('scripts', scriptName)], {
    cwd: resolveRepoPath(),
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

describe('deploy adapter runner scripts', { timeout: 30000 }, () => {
  it('runs the GitHub Actions wrapper and returns machine-readable validation failures', () => {
    const result = runScript('run-github-deploy.mjs', {
      INPUT_MODE: 'live',
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: false,
      diagnostics: [{ code: 'DEPLOY_ADAPTER_MODE_INVALID' }],
    });
  });

  it('runs the Azure DevOps wrapper and returns machine-readable validation failures', () => {
    const result = runScript('run-azure-deploy.mjs', {
      PP_DEPLOY_CONFIRM: 'ship-it',
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: false,
      diagnostics: [{ code: 'DEPLOY_ADAPTER_CONFIRM_INVALID' }],
    });
  });

  it('runs the Power Platform Pipelines wrapper and returns machine-readable validation failures', () => {
    const result = runScript('run-pp-pipeline-deploy.mjs', {
      PP_DEPLOY_MODE: 'execute',
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: false,
      diagnostics: [{ code: 'DEPLOY_ADAPTER_MODE_INVALID' }],
    });
  });
});
