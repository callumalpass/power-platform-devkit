#!/usr/bin/env node

import process from 'node:process';
import { runSetupCli } from './setup-cli.js';

void runSetupCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
