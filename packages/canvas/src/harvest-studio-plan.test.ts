import { describe, expect, it } from 'vitest';
import { makeCanvasStudioInsertPlanKey, resolveCanvasControlCatalogStudioInsertPlan } from './harvest-studio-plan';

describe('canvas studio insert plan', () => {
  it('normalizes plan keys by family and control name', () => {
    expect(makeCanvasStudioInsertPlanKey('classic', 'Column chart')).toBe('classic/column chart');
    expect(makeCanvasStudioInsertPlanKey('modern', 'Tabs or tab list')).toBe('modern/tabs or tab list');
  });

  it('maps classic controls to their runtime insert plans', () => {
    expect(resolveCanvasControlCatalogStudioInsertPlan({ family: 'classic', name: 'Button' })).toEqual({
      kind: 'add',
      template: 'button',
    });
    expect(resolveCanvasControlCatalogStudioInsertPlan({ family: 'classic', name: 'Container' })).toEqual({
      kind: 'add',
      template: 'groupContainer',
      variant: 'ManualLayout',
    });
    expect(resolveCanvasControlCatalogStudioInsertPlan({ family: 'classic', name: 'Column chart' })).toEqual({
      kind: 'add',
      template: 'CompositeColumnChart',
      composite: true,
    });
    expect(resolveCanvasControlCatalogStudioInsertPlan({ family: 'classic', name: 'Screen' })).toEqual({
      kind: 'cover',
      reason: 'covered-by-baseline-screen1',
    });
  });

  it('maps modern controls to their runtime insert plans', () => {
    expect(resolveCanvasControlCatalogStudioInsertPlan({ family: 'modern', name: 'Text input' })).toEqual({
      kind: 'add',
      template: 'modernTextInput',
    });
    expect(resolveCanvasControlCatalogStudioInsertPlan({ family: 'modern', name: 'Table' })).toEqual({
      kind: 'add',
      template: 'PowerAppsOneGrid',
    });
  });

  it('returns undefined for unknown controls', () => {
    expect(resolveCanvasControlCatalogStudioInsertPlan({ family: 'modern', name: 'Imaginary control' })).toBeUndefined();
  });
});
