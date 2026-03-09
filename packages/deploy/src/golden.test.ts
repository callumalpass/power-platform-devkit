import { describe, expect, it } from 'vitest';
import { buildDeployPlan } from './index';
import { discoverProject } from '@pp/project';
import { expectGoldenJson, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';

function normalizeDeploySnapshot<T>(value: T): T {
  return mapSnapshotStrings(value, (entry) =>
    entry
      .replaceAll(repoRoot, '<REPO_ROOT>')
      .replaceAll('\\', '/')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<GENERATED_AT>')
  );
}

describe('deploy fixture-backed goldens', () => {
  it('captures deploy plans from the committed analysis fixture project', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const plan = buildDeployPlan(discovery.data!);

    expect(plan.success).toBe(true);

    await expectGoldenJson(plan.data, 'fixtures/analysis/golden/deploy-plan.json', {
      normalize: normalizeDeploySnapshot,
    });
  });
});
