#!/usr/bin/env node

import process from 'node:process';
import { startFlowLanguageServer } from './index.js';

void startFlowLanguageServer().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exit(1);
});
