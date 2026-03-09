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
      family: 'classic',
      name: 'Icon',
      description: 'Classic icon',
      docPath: 'controls/control-shapes-icons.md',
      learnUrl: 'https://learn.microsoft.com/example/classic-icon',
      markdownUrl: 'https://raw.example/classic-icon.md',
      status: [],
    },
    {
      family: 'classic',
      name: 'Label',
      description: 'Classic label',
      docPath: 'controls/control-text-box.md',
      learnUrl: 'https://learn.microsoft.com/example/classic-label',
      markdownUrl: 'https://raw.example/classic-label.md',
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
      templateName: 'icon',
      templateVersion: '2.5.0',
      aliases: {
        constructors: ['Classic/Icon'],
      },
      contentHash: 'classic-icon',
      provenance: {
        kind: 'harvested',
        source: 'test',
      },
    },
    {
      templateName: 'label',
      templateVersion: '2.5.1',
      aliases: {
        constructors: ['Label'],
      },
      contentHash: 'classic-label',
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
      family: 'classic',
      catalogName: 'Icon',
      constructor: 'Classic/Icon',
      properties: {
        Height: '=32',
        Width: '=32',
        Icon: '=Icon.Add',
      },
      notes: ['Harvested alias from the TEST export.'],
    },
    {
      family: 'classic',
      catalogName: 'Label',
      constructor: 'Label',
      properties: {
        Text: '="Classic label fixture"',
      },
      notes: ['Harvested alias from the TEST export.'],
    },
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
      catalogControls: 5,
      resolvedControls: 3,
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
        family: 'classic',
        catalogName: 'Icon',
        status: 'resolved',
        fixtureConstructor: 'Classic/Icon',
        templateName: 'icon',
        templateVersion: '2.5.0',
      }),
      expect.objectContaining({
        family: 'classic',
        catalogName: 'Label',
        status: 'resolved',
        fixtureConstructor: 'Label',
        templateName: 'label',
        templateVersion: '2.5.1',
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

    expect(rendered.renderedControlCount).toBe(5);
    expect(rendered.pendingMarkerCount).toBe(2);
    expect(rendered.containerTemplateVersion).toBe('1.5.0');
    expect(rendered.markerTemplateVersion).toBe('1.0.0');
    expect(rendered.yaml).toContain('- HarvestFixtureContainer:');
    expect(rendered.yaml).toContain('Control: GroupContainer@1.5.0');
    expect(rendered.yaml).toContain('- HarvestClassicIcon:');
    expect(rendered.yaml).toContain('Control: Classic/Icon@2.5.0');
    expect(rendered.yaml).toContain('Icon: =Icon.Add');
    expect(rendered.yaml).toContain('- HarvestClassicLabel:');
    expect(rendered.yaml).toContain('Control: Label@2.5.1');
    expect(rendered.yaml).toContain('Text: ="Classic label fixture"');
    expect(rendered.yaml).toContain('- HarvestModernText:');
    expect(rendered.yaml).toContain('Control: ModernText@1.0.0');
    expect(rendered.yaml).toContain('Text: ="Modern text fixture"');
    expect(rendered.yaml).toContain('- HarvestClassicButtonMarker:');
    expect(rendered.yaml).toContain('Text: ="Classic: Button [prototype missing]"');
    expect(rendered.yaml).toContain('- HarvestModernButtonMarker:');
    expect(rendered.yaml).toContain('Text: ="Modern: Button [registry missing]"');
  });
});
