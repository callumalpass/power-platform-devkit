import { describe, expect, it } from 'vitest';
import type { CanvasTemplateRegistryDocument } from './index';
import {
  buildCanvasHarvestFixturePlan,
  renderCanvasHarvestFixture,
  type CanvasControlCatalogDocument,
  type CanvasHarvestFixturePrototypeDocument,
} from './harvest-fixture';

const catalog: CanvasControlCatalogDocument = {
  schemaVersion: 1,
  generatedAt: '2026-03-09T08:00:00.000Z',
  sources: [],
  controls: [
    {
      family: 'classic',
      name: 'Button',
      description: 'Classic button',
      docPath: 'controls/control-button.md',
      learnUrl: 'https://learn.microsoft.com/example/classic-button',
      markdownUrl: 'https://raw.example/classic-button.md',
      status: [],
    },
    {
      family: 'modern',
      name: 'Button',
      description: 'Modern button',
      docPath: 'modern-control-button.md',
      learnUrl: 'https://learn.microsoft.com/example/modern-button',
      markdownUrl: 'https://raw.example/modern-button.md',
      status: ['preview'],
    },
    {
      family: 'modern',
      name: 'Text',
      description: 'Modern text',
      docPath: 'modern-control-text.md',
      learnUrl: 'https://learn.microsoft.com/example/modern-text',
      markdownUrl: 'https://raw.example/modern-text.md',
      status: [],
    },
  ],
};

const registry: CanvasTemplateRegistryDocument = {
  schemaVersion: 1,
  generatedAt: '2026-03-09T08:30:00.000Z',
  templates: [
    {
      templateName: 'groupContainer',
      templateVersion: '1.5.0',
      aliases: {
        constructors: ['GroupContainer'],
      },
      contentHash: 'group-container',
      provenance: {
        kind: 'harvested',
        source: 'test',
      },
    },
    {
      templateName: 'modernText',
      templateVersion: '1.0.0',
      aliases: {
        constructors: ['ModernText'],
      },
      contentHash: 'modern-text',
      provenance: {
        kind: 'harvested',
        source: 'test',
      },
    },
  ],
  supportMatrix: [],
};

const prototypes: CanvasHarvestFixturePrototypeDocument = {
  schemaVersion: 1,
  generatedAt: '2026-03-09T09:00:00.000Z',
  prototypes: [
    {
      family: 'modern',
      catalogName: 'Button',
      constructor: 'ModernButton',
      properties: {
        Text: '="Modern button"',
      },
      notes: ['Awaiting pinned registry coverage.'],
    },
    {
      family: 'modern',
      catalogName: 'Text',
      constructor: 'ModernText',
      properties: {
        Text: '="Modern text fixture"',
      },
      notes: ['Validated as a top-level pasted control.'],
    },
  ],
};

describe('canvas harvest fixture planning', () => {
  it('tracks prototype and registry coverage against the pinned catalog', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });

    expect(plan.counts).toEqual({
      catalogControls: 3,
      resolvedControls: 1,
      prototypeMissingControls: 1,
      registryMissingControls: 1,
    });
    expect(plan.controls).toEqual([
      expect.objectContaining({
        family: 'classic',
        catalogName: 'Button',
        status: 'prototype-missing',
      }),
      expect.objectContaining({
        family: 'modern',
        catalogName: 'Button',
        status: 'registry-missing',
        fixtureConstructor: 'ModernButton',
        notes: expect.arrayContaining(['Catalog status: preview.', 'Awaiting pinned registry coverage.']),
      }),
      expect.objectContaining({
        family: 'modern',
        catalogName: 'Text',
        status: 'resolved',
        fixtureConstructor: 'ModernText',
        templateName: 'modernText',
        templateVersion: '1.0.0',
      }),
    ]);
  });

  it('renders a planning container with resolved controls and pending markers', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });
    const rendered = renderCanvasHarvestFixture({
      plan,
      registry,
      prototypes,
      columns: 2,
      cellWidth: 240,
      cellHeight: 40,
      gutterX: 16,
      gutterY: 12,
    });

    expect(rendered.renderedControlCount).toBe(3);
    expect(rendered.pendingMarkerCount).toBe(2);
    expect(rendered.containerTemplateVersion).toBe('1.5.0');
    expect(rendered.markerTemplateVersion).toBe('1.0.0');
    expect(rendered.yaml).toContain('- HarvestFixtureContainer:');
    expect(rendered.yaml).toContain('Control: GroupContainer@1.5.0');
    expect(rendered.yaml).toContain('- HarvestModernText:');
    expect(rendered.yaml).toContain('Control: ModernText@1.0.0');
    expect(rendered.yaml).toContain('Text: ="Modern text fixture"');
    expect(rendered.yaml).toContain('- HarvestClassicButtonMarker:');
    expect(rendered.yaml).toContain('Text: ="Classic: Button [prototype missing]"');
    expect(rendered.yaml).toContain('- HarvestModernButtonMarker:');
    expect(rendered.yaml).toContain('Text: ="Modern: Button [registry missing]"');
  });
});
