import { describe, expect, it } from 'vitest';
import { discoverProject } from '@pp/project';
import { generateContextPack, renderMarkdownReport } from './index';
import { expectGoldenJson, expectGoldenText, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';

function normalizeAnalysisSnapshot<T>(value: T): T {
  return mapSnapshotStrings(value, (entry) =>
    entry
      .replaceAll(repoRoot, '<REPO_ROOT>')
      .replaceAll('\\', '/')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<GENERATED_AT>')
  );
}

describe('analysis fixture-backed goldens', () => {
  it('captures markdown and context-pack outputs from a fixture project', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const project = discovery.data!;
    const contextPack = generateContextPack(project, 'apps');

    expect(contextPack.success).toBe(true);

    await expectGoldenJson(contextPack.data, 'fixtures/analysis/golden/context-pack.json', {
      normalize: normalizeAnalysisSnapshot,
    });
    await expectGoldenText(renderMarkdownReport(project), 'fixtures/analysis/golden/report.md', {
      normalize: (value) => normalizeAnalysisSnapshot(value),
    });
  });
});
