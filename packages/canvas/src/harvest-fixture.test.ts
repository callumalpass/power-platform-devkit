import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CanvasTemplateRegistryDocument } from './index';
import {
  assertCanvasHarvestFixtureCatalogCanWriteOutputs,
  buildCanvasHarvestFixturePlan,
  renderCanvasHarvestFixture,
  DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH,
  DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH,
  type CanvasControlCatalogDocument,
  type CanvasControlInsertReportDocument,
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

const insertReport: CanvasControlInsertReportDocument = {
  schemaVersion: 1,
  generatedAt: '2026-03-09T09:15:00.000Z',
  catalogPath: '/tmp/canvas-control-catalog-subset.json',
  catalogGeneratedAt: '2026-03-09T08:00:00.000Z',
  catalogCounts: {
    total: 5,
    classic: 3,
    modern: 2,
  },
  fixtureContainerName: 'HarvestFixtureContainer',
  entries: [
    {
      family: 'classic',
      name: 'Button',
      docPath: 'controls/control-button.md',
      status: [],
      outcome: 'not-found',
      strategy: 'search-miss',
      attempts: [
        {
          query: 'Button',
          candidates: [],
        },
      ],
    },
    {
      family: 'modern',
      name: 'Button',
      docPath: 'modern-control-button.md',
      status: ['preview'],
      outcome: 'inserted',
      strategy: 'insert-pane-search',
      attempts: [
        {
          query: 'Button',
          candidates: [
            {
              title: 'Button',
              category: 'Modern',
              iconName: '#fluent-button',
            },
          ],
        },
      ],
      chosenCandidate: {
        title: 'Button',
        category: 'Modern',
        iconName: '#fluent-button',
      },
    },
  ],
  totals: {
    attempted: 2,
    inserted: 1,
    covered: 0,
    notFound: 1,
    failed: 0,
  },
};

const incompleteCatalog: CanvasControlCatalogDocument = {
  schemaVersion: 1,
  generatedAt: '2026-03-09T11:47:50.759Z',
  sources: [],
  controls: [
    {
      family: 'classic',
      name: 'Button',
      description: 'Interact with the app by clicking or tapping.',
      docPath: 'controls/control-button.md',
      learnUrl: 'https://learn.microsoft.com/example/control-button',
      markdownUrl: 'https://raw.example/reference-properties.md',
      status: [],
    },
  ],
};

describe('canvas harvest fixture planning', () => {
  it('refuses to overwrite tracked fixture outputs from an incomplete catalog snapshot', () => {
    expect(() =>
      assertCanvasHarvestFixtureCatalogCanWriteOutputs({
        catalog: incompleteCatalog,
        catalogPath: resolve('registries/canvas-control-catalog.json'),
        planPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH),
        yamlPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH),
        trackedPlanPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH),
        trackedYamlPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH),
      })
    ).toThrow(/Refusing to overwrite tracked harvest fixture outputs/);
  });

  it('allows incomplete catalogs when writing alternate outputs for subset experiments', () => {
    expect(() =>
      assertCanvasHarvestFixtureCatalogCanWriteOutputs({
        catalog: incompleteCatalog,
        catalogPath: resolve('/tmp/canvas-control-catalog-subset.json'),
        planPath: resolve('/tmp/fixture-plan.json'),
        yamlPath: resolve('/tmp/HarvestFixtureContainer.pa.yaml'),
        trackedPlanPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH),
        trackedYamlPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH),
      })
    ).not.toThrow();
  });

  it('allows explicit override when an incomplete catalog shrink is intentional', () => {
    expect(() =>
      assertCanvasHarvestFixtureCatalogCanWriteOutputs({
        catalog: incompleteCatalog,
        catalogPath: resolve('registries/canvas-control-catalog.json'),
        planPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH),
        yamlPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH),
        trackedPlanPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH),
        trackedYamlPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH),
        allowIncompleteCatalog: true,
      })
    ).not.toThrow();
  });

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
    expect(plan.catalogCounts).toEqual({
      total: 5,
      classic: 3,
      modern: 2,
    });
    expect(plan.registryTemplateCount).toBe(4);
    expect(plan.prototypeCount).toBe(4);
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

  it('annotates the plan with the latest Studio insert outcomes when provided', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      catalogPath: resolve('registries/canvas-control-catalog.json'),
      registry,
      prototypes,
      insertReport,
      insertReportPath: resolve('/tmp/canvas-control-insert-report.json'),
      generatedAt: '2026-03-09T09:30:00.000Z',
    });

    expect(plan.insertReportSummary).toEqual({
      path: resolve('/tmp/canvas-control-insert-report.json'),
      generatedAt: '2026-03-09T09:15:00.000Z',
      entryCount: 2,
      totals: {
        attempted: 2,
        inserted: 1,
        covered: 0,
        notFound: 1,
        failed: 0,
      },
      catalog: {
        path: '/tmp/canvas-control-catalog-subset.json',
        generatedAt: '2026-03-09T08:00:00.000Z',
        counts: {
          total: 5,
          classic: 3,
          modern: 2,
        },
      },
      matchedControlCount: 2,
      unmatchedCatalogControlCount: 3,
      unmatchedReportEntryCount: 0,
      alignment: 'partial',
      notes: [
        'Insert report catalog snapshot matches the current catalog generatedAt.',
        `Insert report was captured from /tmp/canvas-control-catalog-subset.json while this plan used ${resolve('registries/canvas-control-catalog.json')}.`,
        '3 current catalog controls have no insert observation in this report.',
      ],
    });
    expect(plan.controls[0]).toEqual(
      expect.objectContaining({
        family: 'classic',
        catalogName: 'Button',
        latestInsertObservation: expect.objectContaining({
          generatedAt: '2026-03-09T09:15:00.000Z',
          outcome: 'not-found',
          strategy: 'search-miss',
          attemptedQueries: ['Button'],
        }),
        notes: expect.arrayContaining([
          'Latest Studio insert attempt (2026-03-09T09:15:00.000Z) found no insert/search candidates via search-miss. Queries: Button.',
        ]),
      })
    );
    expect(plan.controls[3]).toEqual(
      expect.objectContaining({
        family: 'modern',
        catalogName: 'Button',
        latestInsertObservation: expect.objectContaining({
          generatedAt: '2026-03-09T09:15:00.000Z',
          outcome: 'inserted',
          strategy: 'insert-pane-search',
          attemptedQueries: ['Button'],
          chosenCandidate: expect.objectContaining({
            title: 'Button',
            category: 'Modern',
          }),
        }),
        notes: expect.arrayContaining([
          'Latest Studio insert attempt (2026-03-09T09:15:00.000Z) inserted this control via Button (Modern) using insert-pane-search. Queries: Button.',
          'Catalog status: preview.',
          'Awaiting pinned registry coverage.',
        ]),
      })
    );
  });

  it('flags insert reports that no longer match the current catalog slice', () => {
    const mismatchedInsertReport: CanvasControlInsertReportDocument = {
      schemaVersion: 1,
      generatedAt: '2026-03-09T10:00:00.000Z',
      catalogPath: '/tmp/older-catalog.json',
      catalogGeneratedAt: '2026-03-08T23:59:59.000Z',
      fixtureContainerName: 'HarvestFixtureContainer',
      entries: [
        {
          family: 'modern',
          name: 'Info button',
          docPath: 'modern-control-info-button.md',
          status: [],
          outcome: 'not-found',
          strategy: 'search-miss',
          attempts: [
            {
              query: 'Information button',
              candidates: [],
            },
          ],
        },
      ],
      totals: {
        attempted: 1,
        inserted: 0,
        covered: 0,
        notFound: 1,
        failed: 0,
      },
    };

    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      catalogPath: resolve('registries/canvas-control-catalog.json'),
      registry,
      prototypes,
      insertReport: mismatchedInsertReport,
      insertReportPath: resolve('/tmp/mismatched-insert-report.json'),
      generatedAt: '2026-03-09T10:05:00.000Z',
    });

    expect(plan.insertReportSummary).toEqual(
      expect.objectContaining({
        alignment: 'mismatch',
        matchedControlCount: 0,
        unmatchedCatalogControlCount: 5,
        unmatchedReportEntryCount: 1,
        notes: expect.arrayContaining([
          'Insert report catalog snapshot 2026-03-08T23:59:59.000Z differs from current catalog snapshot 2026-03-09T08:00:00.000Z.',
          `Insert report was captured from /tmp/older-catalog.json while this plan used ${resolve('registries/canvas-control-catalog.json')}.`,
          '5 current catalog controls have no insert observation in this report.',
          '1 insert report entries do not exist in the current catalog input.',
        ]),
      })
    );
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
