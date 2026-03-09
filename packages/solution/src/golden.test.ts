import { describe, expect, it } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { SolutionService } from './index';
import { expectGoldenJson, resolveRepoPath } from '../../../test/golden';
import { createFixtureDataverseClient, type DataverseFixture } from '../../../test/dataverse-fixture';

interface SolutionFixtureEnvironments {
  source: DataverseFixture;
  target: DataverseFixture;
}

describe('solution fixture-backed goldens', () => {
  it('captures solution list, inspect, components, and dependencies outputs from committed Dataverse-like fixtures', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    const source = new SolutionService(createFixtureDataverseClient(fixture.source));
    const list = await source.list();
    const inspect = await source.inspect('Core');
    const components = await source.components('Core');
    const dependencies = await source.dependencies('Core');

    expect(list.success).toBe(true);
    expect(list.data).toBeDefined();
    expect(inspect.success).toBe(true);
    expect(inspect.data).toBeDefined();
    expect(components.success).toBe(true);
    expect(components.data).toBeDefined();
    expect(dependencies.success).toBe(true);
    expect(dependencies.data).toBeDefined();

    await expectGoldenJson(list.data, 'fixtures/solution/golden/list-report.json');
    await expectGoldenJson(inspect.data, 'fixtures/solution/golden/inspect-report.json');
    await expectGoldenJson(components.data, 'fixtures/solution/golden/components-report.json');
    await expectGoldenJson(dependencies.data, 'fixtures/solution/golden/dependencies-report.json');
  });

  it('captures solution analysis and compare outputs from committed Dataverse-like fixtures', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    const source = new SolutionService(createFixtureDataverseClient(fixture.source));
    const target = new SolutionService(createFixtureDataverseClient(fixture.target));

    const analysis = await source.analyze('Core');
    const compare = await source.compare('Core', target);

    expect(analysis.success).toBe(true);
    expect(analysis.data).toBeDefined();
    expect(compare.success).toBe(true);
    expect(compare.data).toBeDefined();

    await expectGoldenJson(analysis.data, 'fixtures/solution/golden/analyze-report.json');
    await expectGoldenJson(compare.data, 'fixtures/solution/golden/compare-report.json');
  });
});
