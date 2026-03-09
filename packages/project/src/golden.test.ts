import { describe, expect, it } from 'vitest';
import { discoverProject, summarizeProject, summarizeResolvedParameter } from './index';
import { expectGoldenJson, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';

function normalizeProjectSnapshot<T>(value: T): T {
  return mapSnapshotStrings(value, (entry) =>
    entry
      .replaceAll(repoRoot, '<REPO_ROOT>')
      .replaceAll('\\', '/')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<GENERATED_AT>')
  );
}

describe('project fixture-backed goldens', () => {
  it('captures project inspect payloads from the committed analysis fixture project', async () => {
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
    const payload = {
      summary: summarizeProject(project),
      topology: project.topology,
      providerBindings: project.providerBindings,
      parameters: Object.fromEntries(
        Object.values(project.parameters).map((parameter) => [parameter.name, summarizeResolvedParameter(parameter)])
      ),
      assets: project.assets,
      templateRegistries: project.templateRegistries,
      build: project.build,
      docs: project.docs,
    };

    await expectGoldenJson(payload, 'fixtures/analysis/golden/project-inspect.json', {
      normalize: normalizeProjectSnapshot,
    });
  });
});
