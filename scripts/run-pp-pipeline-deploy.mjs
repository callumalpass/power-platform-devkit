#!/usr/bin/env node

import { runDeployAdapterScript } from './deploy-adapter-runner.mjs';

process.exitCode = await runDeployAdapterScript({
  adapterModulePath: '../packages/adapters/power-platform-pipelines/dist/index.js',
  exportName: 'runPowerPlatformPipelinesDeploy',
  parentUrl: import.meta.url,
});
