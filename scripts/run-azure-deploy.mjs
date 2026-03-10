#!/usr/bin/env node

import { runDeployAdapterScript } from './deploy-adapter-runner.mjs';

process.exitCode = await runDeployAdapterScript({
  adapterModulePath: '../packages/adapters/azure-devops/dist/index.js',
  exportName: 'runAzureDevOpsDeploy',
  parentUrl: import.meta.url,
});
