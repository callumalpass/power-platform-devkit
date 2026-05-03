import test from 'node:test';
import assert from 'node:assert/strict';
import { cliCompletionWords, renderCompletionScript, renderMainHelp, resolveCliCommandName } from '../src/cli-command-registry.js';

test('CLI command registry resolves documented aliases', () => {
  assert.equal(resolveCliCommandName('sharepoint'), 'sharepoint');
  assert.equal(resolveCliCommandName('sp'), 'sharepoint');
  assert.equal(resolveCliCommandName('missing'), undefined);
});

test('CLI command registry renders main help from metadata', () => {
  const help = renderMainHelp();
  assert.match(help, /Usage:\n\s{2}pp <command> \[args\]/);
  assert.match(help, /auth {2,}Manage accounts/);
  assert.match(help, /sp\s+Alias for "sharepoint"/);
  assert.match(help, /completion\s+Print shell completion script/);
});

test('CLI command registry drives shell completion words', () => {
  assert.ok(cliCompletionWords().includes('sharepoint'));
  assert.ok(cliCompletionWords().includes('sp'));
  assert.match(renderCompletionScript('bash'), /complete -W ".*sharepoint sp.*" pp/);
  assert.match(renderCompletionScript('zsh'), /#compdef pp/);
  assert.match(renderCompletionScript('powershell'), /Register-ArgumentCompleter -CommandName pp/);
});
