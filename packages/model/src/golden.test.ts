import { describe, expect, it } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { ModelService } from './index';
import { expectGoldenJson, resolveRepoPath } from '../../../test/golden';
import { createFixtureDataverseClient, type DataverseFixture } from '../../../test/dataverse-fixture';

describe('model fixture-backed goldens', () => {
  it('captures model-driven app list, inspect, and dependency projections from committed Dataverse-like fixtures', async () => {
    const fixture = (await readJsonFile(resolveRepoPath('fixtures', 'model', 'runtime', 'sales-hub.json'))) as DataverseFixture;
    const service = new ModelService(createFixtureDataverseClient(fixture));

    const list = await service.list({
      solutionUniqueName: 'Core',
    });
    const inspect = await service.inspect('Sales Hub', {
      solutionUniqueName: 'Core',
    });
    const sitemap = await service.sitemap('Sales Hub', {
      solutionUniqueName: 'Core',
    });
    const forms = await service.forms('Sales Hub', {
      solutionUniqueName: 'Core',
    });
    const views = await service.views('Sales Hub', {
      solutionUniqueName: 'Core',
    });
    const dependencies = await service.dependencies('Sales Hub', {
      solutionUniqueName: 'Core',
    });

    expect(list.success).toBe(true);
    expect(list.data).toBeDefined();
    expect(inspect.success).toBe(true);
    expect(inspect.data).toBeDefined();
    expect(sitemap.success).toBe(true);
    expect(forms.success).toBe(true);
    expect(views.success).toBe(true);
    expect(dependencies.success).toBe(true);

    await expectGoldenJson(list.data, 'fixtures/model/golden/list-report.json');
    await expectGoldenJson(inspect.data, 'fixtures/model/golden/inspect-report.json');
    await expectGoldenJson(sitemap.data, 'fixtures/model/golden/sitemap-report.json');
    await expectGoldenJson(forms.data, 'fixtures/model/golden/forms-report.json');
    await expectGoldenJson(views.data, 'fixtures/model/golden/views-report.json');
    await expectGoldenJson(dependencies.data, 'fixtures/model/golden/dependencies-report.json');
  });
});
