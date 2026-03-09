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
