#!/usr/bin/env node

import { runDeployAdapterScript } from './deploy-adapter-runner.mjs';

process.exitCode = await runDeployAdapterScript({
  adapterModulePath: '../packages/adapters/github-actions/dist/index.js',
  exportName: 'runGitHubActionsDeploy',
  parentUrl: import.meta.url,
});
