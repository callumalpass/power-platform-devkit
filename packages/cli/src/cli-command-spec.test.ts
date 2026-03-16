import { describe, expect, it } from 'vitest';
import { buildCompletionNodes, collectOptionsForPath, resolveCommandPath } from './cli-command-spec';

describe('cli command spec', () => {
  it('resolves aliased and nested command paths canonically', () => {
    expect(resolveCommandPath(['environment', 'inspect']).path).toEqual(['env', 'inspect']);
    expect(resolveCommandPath(['auth', 'profile', 'add-user', '--name', 'work']).path).toEqual(['auth', 'profile', 'add-user']);
    expect(resolveCommandPath(['model', 'patch', 'plan', 'SalesHub', '--kind', 'app']).path).toEqual(['model', 'patch', 'plan']);
  });

  it('inherits options down the command tree for completion use', () => {
    expect(collectOptionsForPath(['model', 'patch', 'plan']).map((optionSpec) => optionSpec.name)).toContain('--kind');
    expect(collectOptionsForPath(['canvas', 'build']).map((optionSpec) => optionSpec.name)).toContain('--mode');
    expect(collectOptionsForPath(['canvas', 'build']).map((optionSpec) => optionSpec.name)).toContain('--out');
  });

  it('emits completion nodes for deep command paths', () => {
    const nodes = buildCompletionNodes();
    const authProfile = nodes.find((node) => node.path.join(' ') === 'auth profile');
    const canvasPatch = nodes.find((node) => node.path.join(' ') === 'canvas patch');

    expect(authProfile?.subcommands).toContain('add-user');
    expect(canvasPatch?.subcommands).toContain('plan');
  });
});
