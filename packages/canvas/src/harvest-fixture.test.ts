import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CanvasTemplateRegistryDocument } from './index';
import {
  assertCanvasHarvestFixtureCatalogCanWriteOutputs,
  buildCanvasControlSearchTerms,
  buildCanvasControlInsertWaitProfile,
  buildCanvasHarvestFixturePlan,
  buildCanvasHarvestFixturePrototypeDraftDocument,
  buildCanvasHarvestFixturePrototypePromotionBatchDocument,
  buildCanvasHarvestPrototypeValidationFixtureDocument,
  buildCanvasHarvestFixturePrototypeValidationBacklogDocument,
  promoteCanvasHarvestFixturePrototypeDraft,
  promoteCanvasHarvestFixturePrototypeDrafts,
  recordCanvasHarvestFixturePrototypeValidation,
  recordCanvasHarvestFixturePrototypeValidations,
  resolveCanvasHarvestFixturePrototypeDraftPromotion,
  resolveCanvasControlInsertReportResumeSelection,
  renderCanvasHarvestFixture,
  renderCanvasHarvestPrototypeValidationFixture,
  DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH,
  DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH,
  type CanvasControlCatalogDocument,
  type CanvasControlInsertReportDocument,
  type CanvasHarvestFixturePrototypeDraftDocument,
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
      templateName: 'button',
      templateVersion: '2.2.0',
      aliases: {
        constructors: ['Classic/Button'],
      },
      files: {
        'Harvest/Runtime.json': {
          rules: {
            Height: {
              sampleScripts: ['40'],
            },
            Width: {
              sampleScripts: ['160'],
            },
            Text: {
              sampleScripts: ['"Button"'],
            },
            X: {
              sampleScripts: ['40'],
            },
          },
        },
      },
      contentHash: 'classic-button',
      provenance: {
        kind: 'harvested',
        source: 'test',
      },
    },
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

  it('builds canonical insert-search terms with aliases and split variants', () => {
    expect(buildCanvasControlSearchTerms({ family: 'classic', name: 'Label' })).toEqual(['Label', 'Text label']);
    expect(buildCanvasControlSearchTerms({ family: 'modern', name: 'Tabs or tab list' })).toEqual([
      'Tabs or tab list',
      'Tab list',
      'Tabs',
    ]);
  });

  it('uses the standard wait profile for simple classic controls', () => {
    expect(
      buildCanvasControlInsertWaitProfile(
        {
          family: 'classic',
          name: 'Label',
          status: [],
        },
        {
          baseSettleMs: 3000,
        }
      )
    ).toEqual({
      tier: 'standard',
      searchSettleMs: 800,
      searchStablePasses: 2,
      postInsertSettleMs: 4000,
      readyPollMs: 500,
      readyTimeoutMs: 8000,
      reasons: [],
    });
  });

  it('uses a modern wait profile for simple fluent controls', () => {
    expect(
      buildCanvasControlInsertWaitProfile(
        {
          family: 'modern',
          name: 'Text',
          status: [],
        },
        {
          baseSettleMs: 4000,
        }
      )
    ).toEqual({
      tier: 'modern',
      searchSettleMs: 1000,
      searchStablePasses: 2,
      postInsertSettleMs: 5000,
      readyPollMs: 750,
      readyTimeoutMs: 12000,
      reasons: ['modern-family'],
    });
  });

  it('escalates to heavy wait profiles for preview or contextual controls', () => {
    expect(
      buildCanvasControlInsertWaitProfile(
        {
          family: 'modern',
          name: 'Date picker',
          status: ['preview'],
        },
        {
          baseSettleMs: 4000,
        }
      )
    ).toEqual({
      tier: 'heavy',
      searchSettleMs: 1600,
      searchStablePasses: 3,
      postInsertSettleMs: 8000,
      readyPollMs: 1000,
      readyTimeoutMs: 16000,
      reasons: ['modern-family', 'preview-status', 'complex-name'],
    });

    expect(
      buildCanvasControlInsertWaitProfile(
        {
          family: 'classic',
          name: 'Display and edit form',
          status: [],
        },
        {
          baseSettleMs: 4000,
        }
      )
    ).toEqual({
      tier: 'heavy',
      searchSettleMs: 1600,
      searchStablePasses: 3,
      postInsertSettleMs: 8000,
      readyPollMs: 1000,
      readyTimeoutMs: 16000,
      reasons: ['complex-name', 'contextual-host'],
    });
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
    expect(plan.registryTemplateCount).toBe(5);
    expect(plan.prototypeCount).toBe(4);
    expect(plan.controls).toEqual([
      expect.objectContaining({
        family: 'classic',
        catalogName: 'Button',
        status: 'prototype-missing',
        suggestedInsertQueries: ['Button'],
        prototypeSuggestions: [
          {
            constructor: 'Classic/Button',
            matchType: 'constructor',
            templateName: 'button',
            templateVersion: '2.2.0',
          },
        ],
        notes: expect.arrayContaining(['Pinned registry suggests future fixture prototypes: Classic/Button -> button@2.2.0.']),
      }),
      expect.objectContaining({
        family: 'classic',
        catalogName: 'Icon',
        status: 'resolved',
        fixtureConstructor: 'Classic/Icon',
        templateName: 'icon',
        templateVersion: '2.5.0',
        suggestedInsertQueries: ['Icon'],
      }),
      expect.objectContaining({
        family: 'classic',
        catalogName: 'Label',
        status: 'resolved',
        fixtureConstructor: 'Label',
        templateName: 'label',
        templateVersion: '2.5.1',
        suggestedInsertQueries: ['Label', 'Text label'],
      }),
      expect.objectContaining({
        family: 'modern',
        catalogName: 'Button',
        status: 'registry-missing',
        fixtureConstructor: 'ModernButton',
        suggestedInsertQueries: ['Button'],
        notes: expect.arrayContaining(['Catalog status: preview.', 'Awaiting pinned registry coverage.']),
      }),
      expect.objectContaining({
        family: 'modern',
        catalogName: 'Text',
        status: 'resolved',
        fixtureConstructor: 'ModernText',
        templateName: 'modernText',
        templateVersion: '1.0.0',
        suggestedInsertQueries: ['Text'],
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

  it('records intentional insert-report chunk selection in the plan summary', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      catalogPath: resolve('registries/canvas-control-catalog.json'),
      registry,
      prototypes,
      insertReport: {
        ...insertReport,
        selection: {
          includeRetired: false,
          family: 'modern',
          startAt: 'Button',
          limit: 1,
          matchingControls: 2,
          selectedControls: 1,
          remainingControls: 1,
          startIndex: 0,
          firstSelectedControl: {
            family: 'modern',
            name: 'Button',
          },
          lastSelectedControl: {
            family: 'modern',
            name: 'Button',
          },
        },
        entries: [insertReport.entries[1]!],
        totals: {
          attempted: 1,
          inserted: 1,
          covered: 0,
          notFound: 0,
          failed: 0,
        },
      },
      insertReportPath: resolve('/tmp/canvas-control-insert-report-chunk.json'),
      generatedAt: '2026-03-10T02:00:00.000Z',
    });

    expect(plan.insertReportSummary?.alignment).toBe('partial');
    expect(plan.insertReportSummary?.notes).toContain(
      'Insert report selection covered 1 of 2 matching catalog controls for the modern family starting at "Button" with limit 1 (range modern/Button -> modern/Button) 1 controls remain after this chunk.'
    );
  });

  it('derives the next chunk selection from a prior insert report', () => {
    expect(
      resolveCanvasControlInsertReportResumeSelection(catalog, {
        ...insertReport,
        selection: {
          includeRetired: false,
          family: 'modern',
          startAt: 'Button',
          limit: 1,
          matchingControls: 2,
          selectedControls: 1,
          remainingControls: 1,
          startIndex: 0,
          firstSelectedControl: {
            family: 'modern',
            name: 'Button',
          },
          lastSelectedControl: {
            family: 'modern',
            name: 'Button',
          },
        },
      })
    ).toEqual({
      includeRetired: false,
      family: 'modern',
      startAt: 'modern/Text',
      limit: 1,
    });
  });

  it('builds draft prototype scaffolds from a persisted legacy plan shape', () => {
    const legacyPlan = {
      schemaVersion: 1,
      generatedAt: '2026-03-09T12:21:27.948Z',
      controls: [
        {
          family: 'classic',
          catalogName: 'Button',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
        },
        {
          family: 'modern',
          catalogName: 'Info button',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
          latestInsertObservation: {
            generatedAt: '2026-03-09T09:15:00.000Z',
            outcome: 'not-found',
            strategy: 'search-miss',
            attemptedQueries: ['Information button'],
          },
        },
        {
          family: 'classic',
          catalogName: 'Label',
          status: 'resolved',
          reason: 'Fixture prototype Label resolves to label@2.5.1.',
          notes: [],
        },
      ],
    } as unknown as Parameters<typeof buildCanvasHarvestFixturePrototypeDraftDocument>[0]['plan'];

    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan: legacyPlan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:00:00.000Z',
    });

    expect(drafts).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:00:00.000Z',
      sourcePlanGeneratedAt: '2026-03-09T12:21:27.948Z',
      sourcePrototypeGeneratedAt: '2026-03-09T09:00:00.000Z',
      counts: {
        draftControls: 1,
        skippedControls: 1,
      },
      drafts: [
        {
          family: 'classic',
          catalogName: 'Button',
          constructor: 'Classic/Button',
          properties: {
            Height: '=40',
            Width: '=160',
            Text: '="Button"',
          },
          notes: [
            'Draft scaffold generated from fixture plan 2026-03-09T12:21:27.948Z.',
            'Registry suggestion selected: Classic/Button -> button@2.2.0 (constructor match).',
            'Suggested Insert-pane queries: Button.',
            'Scaffold properties derived from harvested runtime metadata: Height, Width, Text.',
            'Review properties and live-validate this draft before copying it into fixtures/canvas-harvest/prototypes.json.',
          ],
        },
      ],
      skipped: [
        {
          family: 'modern',
          catalogName: 'Info button',
          status: 'prototype-missing',
          reason: 'The pinned harvested registry does not expose a constructor-backed prototype suggestion for this control yet.',
          suggestedInsertQueries: ['Info button', 'Information button'],
        },
      ],
    });
  });

  it('rejects generic token overlaps that would mis-suggest a different modern constructor', () => {
    const registryWithModernInfoButton: CanvasTemplateRegistryDocument = {
      ...registry,
      templates: registry.templates.concat({
        templateName: 'modernInformationButton',
        templateVersion: '1.0.0',
        aliases: {
          constructors: ['ModernInformationButton'],
        },
        contentHash: 'modern-information-button',
        provenance: {
          kind: 'harvested',
          source: 'test',
        },
      }),
    };
    const prototypesWithoutModernButton: CanvasHarvestFixturePrototypeDocument = {
      ...prototypes,
      prototypes: prototypes.prototypes.filter(
        (prototype) => !(prototype.family === 'modern' && prototype.catalogName === 'Button')
      ),
    };
    const plan = {
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:05:00.000Z',
      controls: [
        {
          family: 'modern',
          catalogName: 'Button',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
        },
      ],
    } as unknown as Parameters<typeof buildCanvasHarvestFixturePrototypeDraftDocument>[0]['plan'];

    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan,
      registry: registryWithModernInfoButton,
      prototypes: prototypesWithoutModernButton,
      generatedAt: '2026-03-10T00:06:00.000Z',
    });

    expect(drafts.counts).toEqual({
      draftControls: 0,
      skippedControls: 1,
    });
    expect(drafts.skipped).toEqual([
      {
        family: 'modern',
        catalogName: 'Button',
        status: 'prototype-missing',
        reason: 'The pinned harvested registry does not expose a constructor-backed prototype suggestion for this control yet.',
        suggestedInsertQueries: ['Button'],
      },
    ]);
  });

  it('uses explicit prototype-match hints for known container variants', () => {
    const plan = {
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:10:00.000Z',
      controls: [
        {
          family: 'classic',
          catalogName: 'Container',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
        },
      ],
    } as unknown as Parameters<typeof buildCanvasHarvestFixturePrototypeDraftDocument>[0]['plan'];

    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:11:00.000Z',
    });

    expect(drafts.counts).toEqual({
      draftControls: 1,
      skippedControls: 0,
    });
    expect(drafts.drafts).toEqual([
      expect.objectContaining({
        family: 'classic',
        catalogName: 'Container',
        constructor: 'GroupContainer',
      }),
    ]);
  });

  it('resolves prototype draft selectors with family-aware ambiguity checks', () => {
    const drafts: CanvasHarvestFixturePrototypeDraftDocument = {
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:12:00.000Z',
      sourcePlanGeneratedAt: '2026-03-10T00:11:00.000Z',
      counts: {
        draftControls: 4,
        skippedControls: 0,
      },
      drafts: [
        {
          family: 'classic',
          catalogName: 'Button',
          constructor: 'Classic/Button',
        },
        {
          family: 'classic',
          catalogName: 'Container',
          constructor: 'GroupContainer',
        },
        {
          family: 'modern',
          catalogName: 'Button',
          constructor: 'ModernButton',
        },
        {
          family: 'modern',
          catalogName: 'Text input',
          constructor: 'ModernText',
        },
      ],
      skipped: [],
    };

    expect(resolveCanvasHarvestFixturePrototypeDraftPromotion(drafts, 'classic/Button')).toEqual({
      family: 'classic',
      catalogName: 'Button',
    });
    expect(resolveCanvasHarvestFixturePrototypeDraftPromotion(drafts, 'Button', 'modern')).toEqual({
      family: 'modern',
      catalogName: 'Button',
    });
    expect(() => resolveCanvasHarvestFixturePrototypeDraftPromotion(drafts, 'Button')).toThrow(
      'Prototype draft selector "Button" is ambiguous. Matching drafts: Classic/Button, Modern/Button.'
    );
  });

  it('builds a windowed prototype promotion batch from the generated draft queue', () => {
    const drafts: CanvasHarvestFixturePrototypeDraftDocument = {
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:13:00.000Z',
      sourcePlanGeneratedAt: '2026-03-10T00:11:00.000Z',
      counts: {
        draftControls: 4,
        skippedControls: 0,
      },
      drafts: [
        {
          family: 'classic',
          catalogName: 'Button',
          constructor: 'Classic/Button',
        },
        {
          family: 'classic',
          catalogName: 'Container',
          constructor: 'GroupContainer',
        },
        {
          family: 'modern',
          catalogName: 'Button',
          constructor: 'ModernButton',
        },
        {
          family: 'modern',
          catalogName: 'Text input',
          constructor: 'ModernText',
        },
      ],
      skipped: [],
    };

    const batch = buildCanvasHarvestFixturePrototypePromotionBatchDocument({
      drafts,
      family: 'classic',
      startAt: 'Container',
      limit: 1,
      generatedAt: '2026-03-10T00:14:00.000Z',
      notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
    });

    expect(batch).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:14:00.000Z',
      sourceDraftGeneratedAt: '2026-03-10T00:13:00.000Z',
      selection: {
        mode: 'window',
        family: 'classic',
        startAt: 'Container',
        startIndex: 1,
        limit: 1,
        matchingDrafts: 2,
        selectedDrafts: 1,
        skippedDrafts: 1,
        firstSelectedControl: 'Classic/Container',
        lastSelectedControl: 'Classic/Container',
      },
      entries: [
        {
          family: 'classic',
          catalogName: 'Container',
          notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
        },
      ],
    });
  });

  it('builds an explicit prototype promotion batch in draft order', () => {
    const drafts: CanvasHarvestFixturePrototypeDraftDocument = {
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:15:00.000Z',
      sourcePlanGeneratedAt: '2026-03-10T00:11:00.000Z',
      counts: {
        draftControls: 4,
        skippedControls: 0,
      },
      drafts: [
        {
          family: 'classic',
          catalogName: 'Button',
          constructor: 'Classic/Button',
        },
        {
          family: 'classic',
          catalogName: 'Container',
          constructor: 'GroupContainer',
        },
        {
          family: 'modern',
          catalogName: 'Button',
          constructor: 'ModernButton',
        },
        {
          family: 'modern',
          catalogName: 'Text input',
          constructor: 'ModernText',
        },
      ],
      skipped: [],
    };

    const batch = buildCanvasHarvestFixturePrototypePromotionBatchDocument({
      drafts,
      promotions: [
        {
          family: 'modern',
          catalogName: 'Text input',
          notes: ['Inserted successfully in the modern-reset subset run on 2026-03-09.'],
        },
        {
          family: 'classic',
          catalogName: 'Container',
        },
      ],
      generatedAt: '2026-03-10T00:16:00.000Z',
      notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
    });

    expect(batch).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:16:00.000Z',
      sourceDraftGeneratedAt: '2026-03-10T00:15:00.000Z',
      selection: {
        mode: 'explicit',
        startIndex: 1,
        matchingDrafts: 4,
        selectedDrafts: 2,
        skippedDrafts: 2,
        firstSelectedControl: 'Classic/Container',
        lastSelectedControl: 'Modern/Text input',
        requestedPromotions: [
          {
            family: 'modern',
            catalogName: 'Text input',
          },
          {
            family: 'classic',
            catalogName: 'Container',
          },
        ],
      },
      entries: [
        {
          family: 'classic',
          catalogName: 'Container',
          notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
        },
        {
          family: 'modern',
          catalogName: 'Text input',
          notes: [
            'Manual review completed on 2026-03-10; live paste validation still pending.',
            'Inserted successfully in the modern-reset subset run on 2026-03-09.',
          ],
        },
      ],
    });
  });

  it('promotes a generated draft into the pinned prototype document with harvested provenance notes', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });
    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:00:00.000Z',
    });

    const promoted = promoteCanvasHarvestFixturePrototypeDraft({
      drafts,
      registry,
      prototypes,
      family: 'classic',
      catalogName: 'Button',
      generatedAt: '2026-03-10T00:10:00.000Z',
      notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
    });

    expect(promoted.promoted).toEqual({
      family: 'classic',
      catalogName: 'Button',
      constructor: 'Classic/Button',
      liveValidation: {
        status: 'pending',
        recordedAt: '2026-03-10T00:10:00.000Z',
      },
      properties: {
        Height: '=40',
        Width: '=160',
        Text: '="Button"',
      },
      notes: [
        'Promoted from generated draft artifact 2026-03-10T00:00:00.000Z (fixture plan 2026-03-09T09:30:00.000Z).',
        'Constructor Classic/Button resolves to button@2.2.0 in the pinned harvested registry.',
        'Properties started from harvested runtime metadata: Height, Width, Text.',
        'Live paste validation inside HarvestFixtureContainer is still pending.',
        'Manual review completed on 2026-03-10; live paste validation still pending.',
      ],
    });
    expect(promoted.resolvedTemplate).toEqual({
      templateName: 'button',
      templateVersion: '2.2.0',
    });
    expect(promoted.prototypes).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:10:00.000Z',
      prototypes: [...prototypes.prototypes, promoted.promoted],
    });
  });

  it('promotes multiple generated drafts in one pass', () => {
    const batchPlan = {
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:21:00.000Z',
      controls: [
        {
          family: 'classic',
          catalogName: 'Button',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
        },
        {
          family: 'classic',
          catalogName: 'Container',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
        },
      ],
    } as unknown as Parameters<typeof buildCanvasHarvestFixturePrototypeDraftDocument>[0]['plan'];
    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan: batchPlan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:22:00.000Z',
    });

    const promoted = promoteCanvasHarvestFixturePrototypeDrafts({
      drafts,
      registry,
      prototypes,
      promotions: [
        {
          family: 'classic',
          catalogName: 'Button',
          notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
        },
        {
          family: 'classic',
          catalogName: 'Container',
          notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
        },
      ],
      generatedAt: '2026-03-10T00:23:00.000Z',
    });

    expect(promoted.updates).toEqual([
      expect.objectContaining({
        promotion: {
          family: 'classic',
          catalogName: 'Button',
          notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
        },
        promoted: expect.objectContaining({
          family: 'classic',
          catalogName: 'Button',
          constructor: 'Classic/Button',
          liveValidation: {
            status: 'pending',
            recordedAt: '2026-03-10T00:23:00.000Z',
          },
          notes: expect.arrayContaining([
            'Promoted from generated draft artifact 2026-03-10T00:22:00.000Z (fixture plan 2026-03-10T00:21:00.000Z).',
            'Constructor Classic/Button resolves to button@2.2.0 in the pinned harvested registry.',
            'Manual review completed on 2026-03-10; live paste validation still pending.',
          ]),
        }),
        resolvedTemplate: {
          templateName: 'button',
          templateVersion: '2.2.0',
        },
      }),
      expect.objectContaining({
        promotion: {
          family: 'classic',
          catalogName: 'Container',
          notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
        },
        promoted: expect.objectContaining({
          family: 'classic',
          catalogName: 'Container',
          constructor: 'GroupContainer',
          liveValidation: {
            status: 'pending',
            recordedAt: '2026-03-10T00:23:00.000Z',
          },
        }),
        resolvedTemplate: {
          templateName: 'groupContainer',
          templateVersion: '1.5.0',
        },
      }),
    ]);
    expect(promoted.prototypes).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:23:00.000Z',
      prototypes: [...prototypes.prototypes, promoted.updates[0]!.promoted, promoted.updates[1]!.promoted],
    });
  });

  it('rejects duplicate prototype draft promotions inside one batch', () => {
    const plan = {
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:24:00.000Z',
      controls: [
        {
          family: 'classic',
          catalogName: 'Button',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
        },
      ],
    } as unknown as Parameters<typeof buildCanvasHarvestFixturePrototypeDraftDocument>[0]['plan'];
    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:25:00.000Z',
    });

    expect(() =>
      promoteCanvasHarvestFixturePrototypeDrafts({
        drafts,
        registry,
        prototypes,
        promotions: [
          {
            family: 'classic',
            catalogName: 'Button',
          },
          {
            family: 'classic',
            catalogName: 'Button',
          },
        ],
      })
    ).toThrow('Duplicate prototype draft promotion specified for Classic/Button.');
  });

  it('promotes drafts and refreshes the validation backlog plus next fixture selection in one pass', () => {
    const batchPlan = {
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:26:00.000Z',
      controls: [
        {
          family: 'classic',
          catalogName: 'Button',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
        },
        {
          family: 'classic',
          catalogName: 'Container',
          status: 'prototype-missing',
          reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
          notes: [],
        },
        {
          family: 'modern',
          catalogName: 'Text',
          status: 'resolved',
          reason: 'Fixture prototype ModernText resolves to modernText@1.0.0.',
          fixtureConstructor: 'ModernText',
          templateName: 'modernText',
          templateVersion: '1.0.0',
          notes: [],
        },
      ],
    } as unknown as Parameters<typeof buildCanvasHarvestFixturePrototypeDraftDocument>[0]['plan'];
    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan: batchPlan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:27:00.000Z',
    });

    const promoted = promoteCanvasHarvestFixturePrototypeDrafts({
      drafts,
      registry,
      prototypes,
      promotions: [
        {
          family: 'classic',
          catalogName: 'Button',
        },
        {
          family: 'classic',
          catalogName: 'Container',
        },
      ],
      generatedAt: '2026-03-10T00:28:00.000Z',
      refresh: {
        plan: batchPlan,
        registry,
        family: 'classic',
        statuses: ['pending'],
        limit: 2,
        columns: 2,
        cellWidth: 240,
        cellHeight: 40,
        gutterX: 16,
        gutterY: 12,
        paddingX: 24,
        paddingY: 24,
        paths: {
          backlog: resolve('fixtures/canvas-harvest/generated/prototype-validation-backlog.json'),
          registry: resolve('registries/canvas-controls.json'),
          prototypes: resolve('fixtures/canvas-harvest/prototypes.json'),
          yaml: resolve('fixtures/canvas-harvest/generated/prototype-validation/HarvestFixtureContainer.pa.yaml'),
        },
      },
    });

    expect(promoted.refresh).toEqual({
      backlog: expect.objectContaining({
        counts: expect.objectContaining({
          prototypeControls: 6,
          pendingValidationControls: 2,
          failedValidationControls: 0,
          validatedControls: 1,
          unknownValidationControls: 3,
        }),
      }),
      rendered: expect.objectContaining({
        renderedControlCount: 2,
        pendingMarkerCount: 0,
      }),
      selection: expect.objectContaining({
        schemaVersion: 1,
        generatedAt: '2026-03-10T00:28:00.000Z',
        counts: {
          selectedControls: 2,
          skippedControls: 0,
          renderedControls: 2,
          pendingMarkers: 0,
        },
        filters: {
          statuses: ['pending'],
          family: 'classic',
          limit: 2,
        },
        selectedControls: [
          expect.objectContaining({
            family: 'classic',
            catalogName: 'Button',
            constructor: 'Classic/Button',
            validationStatus: 'pending',
            planAlignment: 'stale',
          }),
          expect.objectContaining({
            family: 'classic',
            catalogName: 'Container',
            constructor: 'GroupContainer',
            validationStatus: 'pending',
            planAlignment: 'stale',
          }),
        ],
      }),
    });
  });

  it('records structured live validation metadata for an existing pinned prototype', () => {
    const recorded = recordCanvasHarvestFixturePrototypeValidation({
      prototypes,
      family: 'classic',
      catalogName: 'Label',
      status: 'failed',
      recordedAt: '2026-03-10T00:15:00.000Z',
      method: 'container-paste',
      notes: ['Studio paste succeeded, but the exported artifact was missing the control.'],
      generatedAt: '2026-03-10T00:16:00.000Z',
    });

    expect(recorded.prototype).toEqual({
      family: 'classic',
      catalogName: 'Label',
      constructor: 'Label',
      properties: {
        Text: '="Classic label fixture"',
      },
      liveValidation: {
        status: 'failed',
        recordedAt: '2026-03-10T00:15:00.000Z',
        method: 'container-paste',
        notes: ['Studio paste succeeded, but the exported artifact was missing the control.'],
      },
      notes: ['Harvested alias from the TEST export.'],
    });
    expect(recorded.prototypes).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:16:00.000Z',
      prototypes: [prototypes.prototypes[0], recorded.prototype, prototypes.prototypes[2], prototypes.prototypes[3]],
    });
  });

  it('records multiple prototype validation updates in one pass', () => {
    const recorded = recordCanvasHarvestFixturePrototypeValidations({
      prototypes,
      updates: [
        {
          family: 'classic',
          catalogName: 'Label',
          status: 'failed',
          recordedAt: '2026-03-10T00:15:00.000Z',
          method: 'container-paste',
          notes: ['Studio paste succeeded, but the exported artifact was missing the control.'],
        },
        {
          family: 'modern',
          catalogName: 'Text',
          status: 'validated',
          recordedAt: '2026-03-10T00:19:00.000Z',
          method: 'top-level-paste',
          notes: ['Validated via the backlog-driven fixture tranche.'],
        },
      ],
      generatedAt: '2026-03-10T00:20:00.000Z',
    });

    expect(recorded.updates).toEqual([
      {
        update: {
          family: 'classic',
          catalogName: 'Label',
          status: 'failed',
          recordedAt: '2026-03-10T00:15:00.000Z',
          method: 'container-paste',
          notes: ['Studio paste succeeded, but the exported artifact was missing the control.'],
        },
        prototype: {
          family: 'classic',
          catalogName: 'Label',
          constructor: 'Label',
          properties: {
            Text: '="Classic label fixture"',
          },
          liveValidation: {
            status: 'failed',
            recordedAt: '2026-03-10T00:15:00.000Z',
            method: 'container-paste',
            notes: ['Studio paste succeeded, but the exported artifact was missing the control.'],
          },
          notes: ['Harvested alias from the TEST export.'],
        },
      },
      {
        update: {
          family: 'modern',
          catalogName: 'Text',
          status: 'validated',
          recordedAt: '2026-03-10T00:19:00.000Z',
          method: 'top-level-paste',
          notes: ['Validated via the backlog-driven fixture tranche.'],
        },
        prototype: {
          family: 'modern',
          catalogName: 'Text',
          constructor: 'ModernText',
          properties: {
            Text: '="Modern text fixture"',
          },
          liveValidation: {
            status: 'validated',
            recordedAt: '2026-03-10T00:19:00.000Z',
            method: 'top-level-paste',
            notes: ['Validated via the backlog-driven fixture tranche.'],
          },
          notes: ['Validated as a top-level pasted control.'],
        },
      },
    ]);
    expect(recorded.prototypes).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:20:00.000Z',
      prototypes: [
        prototypes.prototypes[0],
        recorded.updates[0]!.prototype,
        prototypes.prototypes[2],
        recorded.updates[1]!.prototype,
      ],
    });
  });

  it('rejects duplicate prototype validation updates inside one batch', () => {
    expect(() =>
      recordCanvasHarvestFixturePrototypeValidations({
        prototypes,
        updates: [
          {
            family: 'classic',
            catalogName: 'Label',
            status: 'failed',
          },
          {
            family: 'classic',
            catalogName: 'Label',
            status: 'validated',
          },
        ],
      })
    ).toThrow('Duplicate prototype validation update specified for Classic/Label.');
  });

  it('records validation and refreshes the backlog plus next fixture selection in one pass', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });

    const recorded = recordCanvasHarvestFixturePrototypeValidation({
      prototypes,
      family: 'classic',
      catalogName: 'Label',
      status: 'failed',
      recordedAt: '2026-03-10T00:15:00.000Z',
      method: 'container-paste',
      notes: ['Studio paste succeeded, but the exported artifact was missing the control.'],
      generatedAt: '2026-03-10T00:16:00.000Z',
      refresh: {
        plan,
        registry,
        family: 'classic',
        statuses: ['failed'],
        limit: 1,
        columns: 2,
        cellWidth: 240,
        cellHeight: 40,
        gutterX: 16,
        gutterY: 12,
        paddingX: 24,
        paddingY: 24,
        paths: {
          backlog: resolve('fixtures/canvas-harvest/generated/prototype-validation-backlog.json'),
          registry: resolve('registries/canvas-controls.json'),
          prototypes: resolve('fixtures/canvas-harvest/prototypes.json'),
          yaml: resolve('fixtures/canvas-harvest/generated/prototype-validation/HarvestFixtureContainer.pa.yaml'),
        },
      },
    });

    expect(recorded.refresh).toEqual({
      backlog: expect.objectContaining({
        counts: expect.objectContaining({
          prototypeControls: 4,
          failedValidationControls: 1,
          pendingValidationControls: 0,
          unknownValidationControls: 2,
          validatedControls: 1,
        }),
      }),
      rendered: expect.objectContaining({
        renderedControlCount: 1,
        pendingMarkerCount: 0,
      }),
      selection: {
        schemaVersion: 1,
        generatedAt: '2026-03-10T00:16:00.000Z',
        sourceBacklogGeneratedAt: '2026-03-10T00:16:00.000Z',
        sourcePrototypeGeneratedAt: '2026-03-10T00:16:00.000Z',
        sourceRegistryGeneratedAt: '2026-03-09T08:30:00.000Z',
        filters: {
          statuses: ['failed'],
          family: 'classic',
          limit: 1,
        },
        counts: {
          selectedControls: 1,
          skippedControls: 0,
          renderedControls: 1,
          pendingMarkers: 0,
        },
        paths: {
          backlog: resolve('fixtures/canvas-harvest/generated/prototype-validation-backlog.json'),
          registry: resolve('registries/canvas-controls.json'),
          prototypes: resolve('fixtures/canvas-harvest/prototypes.json'),
          yaml: resolve('fixtures/canvas-harvest/generated/prototype-validation/HarvestFixtureContainer.pa.yaml'),
        },
        selectedControls: [
          {
            family: 'classic',
            catalogName: 'Label',
            constructor: 'Label',
            validationStatus: 'failed',
            planAlignment: 'aligned',
            templateName: 'label',
            templateVersion: '2.5.1',
          },
        ],
        skippedControls: [],
      },
    });
    expect(recorded.refresh?.rendered.yaml).toContain('- HarvestClassicLabel:');
    expect(recorded.refresh?.rendered.yaml).toContain('Control: Label@2.5.1');
  });

  it('records a batch of validations and refreshes downstream artifacts once', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });

    const recorded = recordCanvasHarvestFixturePrototypeValidations({
      prototypes,
      updates: [
        {
          family: 'classic',
          catalogName: 'Label',
          status: 'failed',
          recordedAt: '2026-03-10T00:15:00.000Z',
          method: 'container-paste',
          notes: ['Studio paste succeeded, but the exported artifact was missing the control.'],
        },
        {
          family: 'modern',
          catalogName: 'Text',
          status: 'validated',
          recordedAt: '2026-03-10T00:19:00.000Z',
          method: 'top-level-paste',
          notes: ['Validated via the backlog-driven fixture tranche.'],
        },
      ],
      generatedAt: '2026-03-10T00:20:00.000Z',
      refresh: {
        plan,
        registry,
        statuses: ['failed', 'validated'],
        limit: 2,
        columns: 2,
        cellWidth: 240,
        cellHeight: 40,
        gutterX: 16,
        gutterY: 12,
        paddingX: 24,
        paddingY: 24,
        paths: {
          backlog: resolve('fixtures/canvas-harvest/generated/prototype-validation-backlog.json'),
          registry: resolve('registries/canvas-controls.json'),
          prototypes: resolve('fixtures/canvas-harvest/prototypes.json'),
          yaml: resolve('fixtures/canvas-harvest/generated/prototype-validation/HarvestFixtureContainer.pa.yaml'),
        },
      },
    });

    expect(recorded.refresh).toEqual({
      backlog: expect.objectContaining({
        counts: expect.objectContaining({
          prototypeControls: 4,
          failedValidationControls: 1,
          pendingValidationControls: 0,
          unknownValidationControls: 2,
          validatedControls: 1,
        }),
      }),
      rendered: expect.objectContaining({
        renderedControlCount: 2,
        pendingMarkerCount: 0,
      }),
      selection: {
        schemaVersion: 1,
        generatedAt: '2026-03-10T00:20:00.000Z',
        sourceBacklogGeneratedAt: '2026-03-10T00:20:00.000Z',
        sourcePrototypeGeneratedAt: '2026-03-10T00:20:00.000Z',
        sourceRegistryGeneratedAt: '2026-03-09T08:30:00.000Z',
        filters: {
          statuses: ['failed', 'validated'],
          limit: 2,
        },
        counts: {
          selectedControls: 2,
          skippedControls: 0,
          renderedControls: 2,
          pendingMarkers: 0,
        },
        paths: {
          backlog: resolve('fixtures/canvas-harvest/generated/prototype-validation-backlog.json'),
          registry: resolve('registries/canvas-controls.json'),
          prototypes: resolve('fixtures/canvas-harvest/prototypes.json'),
          yaml: resolve('fixtures/canvas-harvest/generated/prototype-validation/HarvestFixtureContainer.pa.yaml'),
        },
        selectedControls: [
          {
            family: 'classic',
            catalogName: 'Label',
            constructor: 'Label',
            validationStatus: 'failed',
            planAlignment: 'aligned',
            templateName: 'label',
            templateVersion: '2.5.1',
          },
          {
            family: 'modern',
            catalogName: 'Text',
            constructor: 'ModernText',
            validationStatus: 'validated',
            planAlignment: 'aligned',
            templateName: 'modernText',
            templateVersion: '1.0.0',
          },
        ],
        skippedControls: [],
      },
    });
    expect(recorded.refresh?.rendered.yaml).toContain('- HarvestClassicLabel:');
    expect(recorded.refresh?.rendered.yaml).toContain('Control: Label@2.5.1');
    expect(recorded.refresh?.rendered.yaml).toContain('- HarvestModernText:');
    expect(recorded.refresh?.rendered.yaml).toContain('Control: ModernText@1.0.0');
  });

  it('allows a refreshed validation fixture to render an empty next tranche when requested', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });

    const recorded = recordCanvasHarvestFixturePrototypeValidation({
      prototypes,
      family: 'modern',
      catalogName: 'Text',
      status: 'validated',
      recordedAt: '2026-03-10T00:19:00.000Z',
      method: 'top-level-paste',
      generatedAt: '2026-03-10T00:20:00.000Z',
      refresh: {
        plan,
        registry,
        family: 'modern',
        statuses: ['pending'],
        allowEmpty: true,
        columns: 2,
        cellWidth: 240,
        cellHeight: 40,
        gutterX: 16,
        gutterY: 12,
        paddingX: 24,
        paddingY: 24,
      },
    });

    expect(recorded.refresh?.selection).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:20:00.000Z',
      sourceBacklogGeneratedAt: '2026-03-10T00:20:00.000Z',
      sourcePrototypeGeneratedAt: '2026-03-10T00:20:00.000Z',
      sourceRegistryGeneratedAt: '2026-03-09T08:30:00.000Z',
      filters: {
        statuses: ['pending'],
        family: 'modern',
      },
      counts: {
        selectedControls: 0,
        skippedControls: 0,
        renderedControls: 0,
        pendingMarkers: 0,
      },
      selectedControls: [],
      skippedControls: [],
    });
    expect(recorded.refresh?.rendered.renderedControlCount).toBe(0);
    expect(recorded.refresh?.rendered.pendingMarkerCount).toBe(0);
    expect(recorded.refresh?.rendered.yaml).toContain('- HarvestFixtureContainer:');
    expect(recorded.refresh?.rendered.yaml).toContain('Children:');
  });

  it('refuses to promote a draft when a pinned prototype already exists for that control', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });
    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:00:00.000Z',
    });
    const prototypesWithButton: CanvasHarvestFixturePrototypeDocument = {
      ...prototypes,
      prototypes: [
        ...prototypes.prototypes,
        {
          family: 'classic',
          catalogName: 'Button',
          constructor: 'Classic/Button',
          notes: ['Already pinned.'],
        },
      ],
    };

    expect(() =>
      promoteCanvasHarvestFixturePrototypeDraft({
        drafts,
        registry,
        prototypes: prototypesWithButton,
        family: 'classic',
        catalogName: 'Button',
      })
    ).toThrow(/A pinned fixture prototype already exists for Classic\/Button/);
  });

  it('builds a prototype validation backlog from pinned prototypes, the preserved plan, and the current registry', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });
    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:00:00.000Z',
    });
    const promoted = promoteCanvasHarvestFixturePrototypeDraft({
      drafts,
      registry,
      prototypes,
      family: 'classic',
      catalogName: 'Button',
      generatedAt: '2026-03-10T00:10:00.000Z',
      notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
    });
    const validationRegistry: CanvasTemplateRegistryDocument = {
      ...registry,
      templates: [
        ...registry.templates,
        {
          templateName: 'image',
          templateVersion: '2.2.3',
          aliases: {
            constructors: ['Image'],
          },
          contentHash: 'classic-image',
          provenance: {
            kind: 'harvested',
            source: 'test',
          },
        },
      ],
    };
    const validationPrototypes: CanvasHarvestFixturePrototypeDocument = {
      ...promoted.prototypes,
      prototypes: promoted.prototypes.prototypes
        .map((prototype) => {
          if (
            prototype.family === 'classic' &&
            (prototype.catalogName === 'Icon' || prototype.catalogName === 'Label')
          ) {
            return {
              ...prototype,
              liveValidation: {
                status: 'pending' as const,
                recordedAt: '2026-03-10T00:18:00.000Z',
                method: 'container-paste',
              },
              notes: ['Constructor alias harvested from the TEST export; live paste validation inside HarvestFixtureContainer is still pending.'],
            };
          }

          if (prototype.family === 'modern' && prototype.catalogName === 'Text') {
            return {
              ...prototype,
              liveValidation: {
                status: 'validated' as const,
                recordedAt: '2026-03-10T00:19:00.000Z',
                method: 'top-level-paste',
              },
            };
          }

          return prototype;
        })
        .concat({
          family: 'classic',
          catalogName: 'Image',
          constructor: 'Image',
          properties: {
            Height: '=40',
            Width: '=40',
            Image: '=SampleImage',
          },
          liveValidation: {
            status: 'pending' as const,
            recordedAt: '2026-03-10T00:18:00.000Z',
            method: 'container-paste',
          },
          notes: ['Constructor alias harvested from the TEST export; live paste validation inside HarvestFixtureContainer is still pending.'],
        }),
    };

    const backlog = buildCanvasHarvestFixturePrototypeValidationBacklogDocument({
      plan,
      registry: validationRegistry,
      prototypes: validationPrototypes,
      generatedAt: '2026-03-10T00:20:00.000Z',
    });

    expect(backlog.counts).toEqual({
      prototypeControls: 6,
      validatedControls: 1,
      pendingValidationControls: 4,
      failedValidationControls: 0,
      unknownValidationControls: 1,
      alignedPlanControls: 4,
      stalePlanControls: 1,
      prototypeOnlyControls: 1,
      registryMissingControls: 1,
    });
    expect(backlog.controls.find((control) => control.family === 'classic' && control.catalogName === 'Button')).toEqual(
      expect.objectContaining({
        constructor: 'Classic/Button',
        suggestedInsertQueries: ['Button'],
        validationStatus: 'pending',
        liveValidation: {
          status: 'pending',
          recordedAt: '2026-03-10T00:10:00.000Z',
        },
        planAlignment: 'stale',
        planStatus: 'prototype-missing',
        templateName: 'button',
        templateVersion: '2.2.0',
        notes: expect.arrayContaining([
          'The source fixture plan still marks this control as prototype missing; regenerate the plan to reflect the pinned prototype.',
          'Constructor Classic/Button resolves to button@2.2.0.',
          'Recorded live validation keeps this control pending as of 2026-03-10T00:10:00.000Z.',
        ]),
      })
    );
    expect(backlog.controls.find((control) => control.family === 'modern' && control.catalogName === 'Button')).toEqual(
      expect.objectContaining({
        constructor: 'ModernButton',
        suggestedInsertQueries: ['Button'],
        validationStatus: 'unknown',
        planAlignment: 'aligned',
        planStatus: 'registry-missing',
        notes: expect.arrayContaining([
          'The source fixture plan already tracks this prototype, but the harvested registry still lacks a matching constructor alias.',
          'The pinned harvested registry does not currently resolve constructor ModernButton; keep registry refresh work separate from live validation.',
          'Prototype notes do not yet say whether live paste validation has happened.',
        ]),
      })
    );
    expect(backlog.controls.find((control) => control.family === 'classic' && control.catalogName === 'Image')).toEqual(
      expect.objectContaining({
        constructor: 'Image',
        suggestedInsertQueries: ['Image'],
        validationStatus: 'pending',
        liveValidation: {
          status: 'pending',
          recordedAt: '2026-03-10T00:18:00.000Z',
          method: 'container-paste',
        },
        planAlignment: 'prototype-only',
        templateName: 'image',
        templateVersion: '2.2.3',
        notes: expect.arrayContaining([
          'No matching control exists in the source fixture plan; this pinned prototype sits outside the preserved plan snapshot.',
          'Recorded live validation keeps this control pending via container-paste as of 2026-03-10T00:18:00.000Z.',
        ]),
      })
    );
    expect(backlog.controls.find((control) => control.family === 'modern' && control.catalogName === 'Text')).toEqual(
      expect.objectContaining({
        constructor: 'ModernText',
        validationStatus: 'validated',
        liveValidation: {
          status: 'validated',
          recordedAt: '2026-03-10T00:19:00.000Z',
          method: 'top-level-paste',
        },
        planAlignment: 'aligned',
        planStatus: 'resolved',
        templateName: 'modernText',
        templateVersion: '1.0.0',
        notes: expect.arrayContaining([
          'The source fixture plan already resolves this pinned prototype.',
          'Recorded live validation marks this control validated via top-level-paste on 2026-03-10T00:19:00.000Z.',
        ]),
      })
    );
  });

  it('prefers structured live validation metadata over legacy note parsing', () => {
    const backlog = buildCanvasHarvestFixturePrototypeValidationBacklogDocument({
      plan: buildCanvasHarvestFixturePlan({
        catalog,
        registry,
        prototypes,
        generatedAt: '2026-03-09T09:30:00.000Z',
      }),
      registry,
      prototypes: {
        ...prototypes,
        prototypes: prototypes.prototypes.map((prototype) =>
          prototype.family === 'modern' && prototype.catalogName === 'Text'
            ? {
                ...prototype,
                liveValidation: {
                  status: 'failed' as const,
                  recordedAt: '2026-03-10T00:25:00.000Z',
                  method: 'container-paste',
                },
              }
            : prototype
        ),
      },
      generatedAt: '2026-03-10T00:26:00.000Z',
    });

    expect(backlog.counts.failedValidationControls).toBe(1);
    expect(backlog.controls.find((control) => control.family === 'modern' && control.catalogName === 'Text')).toEqual(
      expect.objectContaining({
        validationStatus: 'failed',
        liveValidation: {
          status: 'failed',
          recordedAt: '2026-03-10T00:25:00.000Z',
          method: 'container-paste',
        },
        notes: expect.arrayContaining([
          'Recorded live validation marks this control failed via container-paste on 2026-03-10T00:25:00.000Z.',
        ]),
      })
    );
  });

  it('renders a validation-only fixture from the pinned prototype backlog and skips unresolved entries', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });
    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:00:00.000Z',
    });
    const promoted = promoteCanvasHarvestFixturePrototypeDraft({
      drafts,
      registry,
      prototypes,
      family: 'classic',
      catalogName: 'Button',
      generatedAt: '2026-03-10T00:10:00.000Z',
      notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
    });
    const validationRegistry: CanvasTemplateRegistryDocument = {
      ...registry,
      templates: [
        ...registry.templates,
        {
          templateName: 'image',
          templateVersion: '2.2.3',
          aliases: {
            constructors: ['Image'],
          },
          contentHash: 'classic-image',
          provenance: {
            kind: 'harvested',
            source: 'test',
          },
        },
      ],
    };
    const validationPrototypes: CanvasHarvestFixturePrototypeDocument = {
      ...promoted.prototypes,
      prototypes: promoted.prototypes.prototypes
        .map((prototype) => {
          if (
            prototype.family === 'classic' &&
            (prototype.catalogName === 'Icon' || prototype.catalogName === 'Label')
          ) {
            return {
              ...prototype,
              liveValidation: {
                status: 'pending' as const,
                recordedAt: '2026-03-10T00:18:00.000Z',
                method: 'container-paste',
              },
              notes: ['Constructor alias harvested from the TEST export; live paste validation inside HarvestFixtureContainer is still pending.'],
            };
          }

          if (prototype.family === 'modern' && prototype.catalogName === 'Text') {
            return {
              ...prototype,
              liveValidation: {
                status: 'validated' as const,
                recordedAt: '2026-03-10T00:19:00.000Z',
                method: 'top-level-paste',
              },
            };
          }

          return prototype;
        })
        .concat({
          family: 'classic',
          catalogName: 'Image',
          constructor: 'Image',
          properties: {
            Height: '=40',
            Width: '=40',
            Image: '=SampleImage',
          },
          liveValidation: {
            status: 'pending' as const,
            recordedAt: '2026-03-10T00:18:00.000Z',
            method: 'container-paste',
          },
          notes: ['Constructor alias harvested from the TEST export; live paste validation inside HarvestFixtureContainer is still pending.'],
        }),
    };
    const backlog = buildCanvasHarvestFixturePrototypeValidationBacklogDocument({
      plan,
      registry: validationRegistry,
      prototypes: validationPrototypes,
      generatedAt: '2026-03-10T00:20:00.000Z',
    });

    const rendered = renderCanvasHarvestPrototypeValidationFixture({
      backlog,
      registry: validationRegistry,
      prototypes: validationPrototypes,
      columns: 2,
      cellWidth: 240,
      cellHeight: 40,
      gutterX: 16,
      gutterY: 12,
    });

    expect(rendered.renderedControlCount).toBe(4);
    expect(rendered.pendingMarkerCount).toBe(0);
    expect(rendered.selectedControls).toEqual([
      {
        family: 'classic',
        catalogName: 'Button',
        constructor: 'Classic/Button',
        validationStatus: 'pending',
        planAlignment: 'stale',
        templateName: 'button',
        templateVersion: '2.2.0',
      },
      {
        family: 'classic',
        catalogName: 'Image',
        constructor: 'Image',
        validationStatus: 'pending',
        planAlignment: 'prototype-only',
        templateName: 'image',
        templateVersion: '2.2.3',
      },
      {
        family: 'classic',
        catalogName: 'Icon',
        constructor: 'Classic/Icon',
        validationStatus: 'pending',
        planAlignment: 'aligned',
        templateName: 'icon',
        templateVersion: '2.5.0',
      },
      {
        family: 'classic',
        catalogName: 'Label',
        constructor: 'Label',
        validationStatus: 'pending',
        planAlignment: 'aligned',
        templateName: 'label',
        templateVersion: '2.5.1',
      },
    ]);
    expect(rendered.skippedControls).toEqual([
      {
        family: 'modern',
        catalogName: 'Button',
        constructor: 'ModernButton',
        validationStatus: 'unknown',
        planAlignment: 'aligned',
        reason: 'The pinned harvested registry does not currently resolve constructor ModernButton.',
      },
    ]);
    expect(rendered.yaml).toContain('- HarvestFixtureContainer:');
    expect(rendered.yaml).toContain('- HarvestClassicButton:');
    expect(rendered.yaml).toContain('Control: Classic/Button@2.2.0');
    expect(rendered.yaml).toContain('- HarvestClassicImage:');
    expect(rendered.yaml).toContain('Control: Image@2.2.3');
    expect(rendered.yaml).toContain('- HarvestClassicIcon:');
    expect(rendered.yaml).toContain('Control: Classic/Icon@2.5.0');
    expect(rendered.yaml).toContain('- HarvestClassicLabel:');
    expect(rendered.yaml).toContain('Control: Label@2.5.1');
    expect(rendered.yaml).not.toContain('Marker');
  });

  it('persists validation fixture selection state as a durable JSON document', () => {
    const plan = buildCanvasHarvestFixturePlan({
      catalog,
      registry,
      prototypes,
      generatedAt: '2026-03-09T09:30:00.000Z',
    });
    const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
      plan,
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:00:00.000Z',
    });
    const promoted = promoteCanvasHarvestFixturePrototypeDraft({
      drafts,
      registry,
      prototypes,
      family: 'classic',
      catalogName: 'Button',
      generatedAt: '2026-03-10T00:10:00.000Z',
      notes: ['Manual review completed on 2026-03-10; live paste validation still pending.'],
    });
    const validationRegistry: CanvasTemplateRegistryDocument = {
      ...registry,
      templates: [
        ...registry.templates,
        {
          templateName: 'image',
          templateVersion: '2.2.3',
          aliases: {
            constructors: ['Image'],
          },
          contentHash: 'classic-image',
          provenance: {
            kind: 'harvested',
            source: 'test',
          },
        },
      ],
    };
    const validationPrototypes: CanvasHarvestFixturePrototypeDocument = {
      ...promoted.prototypes,
      prototypes: promoted.prototypes.prototypes
        .map((prototype) => {
          if (
            prototype.family === 'classic' &&
            (prototype.catalogName === 'Icon' || prototype.catalogName === 'Label')
          ) {
            return {
              ...prototype,
              liveValidation: {
                status: 'pending' as const,
                recordedAt: '2026-03-10T00:18:00.000Z',
                method: 'container-paste',
              },
            };
          }

          if (prototype.family === 'modern' && prototype.catalogName === 'Text') {
            return {
              ...prototype,
              liveValidation: {
                status: 'validated' as const,
                recordedAt: '2026-03-10T00:19:00.000Z',
                method: 'top-level-paste',
              },
            };
          }

          return prototype;
        })
        .concat({
          family: 'classic',
          catalogName: 'Image',
          constructor: 'Image',
          properties: {
            Height: '=40',
            Width: '=40',
            Image: '=SampleImage',
          },
          liveValidation: {
            status: 'pending' as const,
            recordedAt: '2026-03-10T00:18:00.000Z',
            method: 'container-paste',
          },
          notes: ['Constructor alias harvested from the TEST export; live paste validation inside HarvestFixtureContainer is still pending.'],
        }),
    };
    const backlog = buildCanvasHarvestFixturePrototypeValidationBacklogDocument({
      plan,
      registry: validationRegistry,
      prototypes: validationPrototypes,
      generatedAt: '2026-03-10T00:20:00.000Z',
    });
    const rendered = renderCanvasHarvestPrototypeValidationFixture({
      backlog,
      registry: validationRegistry,
      prototypes: validationPrototypes,
      family: 'classic',
      statuses: ['pending'],
      limit: 3,
      columns: 2,
      cellWidth: 240,
      cellHeight: 40,
      gutterX: 16,
      gutterY: 12,
    });

    const document = buildCanvasHarvestPrototypeValidationFixtureDocument({
      backlog,
      rendered,
      family: 'classic',
      statuses: ['pending'],
      limit: 3,
      generatedAt: '2026-03-10T00:30:00.000Z',
      paths: {
        backlog: resolve('fixtures/canvas-harvest/generated/prototype-validation-backlog.json'),
        registry: resolve('registries/canvas-controls.json'),
        prototypes: resolve('fixtures/canvas-harvest/prototypes.json'),
        yaml: resolve('fixtures/canvas-harvest/generated/prototype-validation/HarvestFixtureContainer.pa.yaml'),
      },
    });

    expect(document).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:30:00.000Z',
      sourceBacklogGeneratedAt: '2026-03-10T00:20:00.000Z',
      sourcePrototypeGeneratedAt: '2026-03-10T00:10:00.000Z',
      sourceRegistryGeneratedAt: '2026-03-09T08:30:00.000Z',
      filters: {
        statuses: ['pending'],
        family: 'classic',
        limit: 3,
      },
      counts: {
        selectedControls: 3,
        skippedControls: 0,
        renderedControls: 3,
        pendingMarkers: 0,
      },
      paths: {
        backlog: resolve('fixtures/canvas-harvest/generated/prototype-validation-backlog.json'),
        registry: resolve('registries/canvas-controls.json'),
        prototypes: resolve('fixtures/canvas-harvest/prototypes.json'),
        yaml: resolve('fixtures/canvas-harvest/generated/prototype-validation/HarvestFixtureContainer.pa.yaml'),
      },
      selectedControls: [
        {
          family: 'classic',
          catalogName: 'Button',
          constructor: 'Classic/Button',
          validationStatus: 'pending',
          planAlignment: 'stale',
          templateName: 'button',
          templateVersion: '2.2.0',
        },
        {
          family: 'classic',
          catalogName: 'Image',
          constructor: 'Image',
          validationStatus: 'pending',
          planAlignment: 'prototype-only',
          templateName: 'image',
          templateVersion: '2.2.3',
        },
        {
          family: 'classic',
          catalogName: 'Icon',
          constructor: 'Classic/Icon',
          validationStatus: 'pending',
          planAlignment: 'aligned',
          templateName: 'icon',
          templateVersion: '2.5.0',
        },
      ],
      skippedControls: [],
    });
  });

  it('fails when the requested validation slice has no renderable controls', () => {
    const backlog = buildCanvasHarvestFixturePrototypeValidationBacklogDocument({
      plan: buildCanvasHarvestFixturePlan({
        catalog,
        registry,
        prototypes,
        generatedAt: '2026-03-09T09:30:00.000Z',
      }),
      registry,
      prototypes,
      generatedAt: '2026-03-10T00:26:00.000Z',
    });

    expect(() =>
      renderCanvasHarvestPrototypeValidationFixture({
        backlog,
        registry,
        prototypes,
        family: 'modern',
        statuses: ['unknown'],
      })
    ).toThrow(
      'No prototype validation controls matched the requested family Modern filters for statuses unknown. 1 matching controls were skipped because they no longer resolve in the pinned registry.'
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
