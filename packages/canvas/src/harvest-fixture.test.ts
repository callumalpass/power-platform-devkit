import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CanvasTemplateRegistryDocument } from './index';
import {
  assertCanvasHarvestFixtureCatalogCanWriteOutputs,
  buildCanvasControlSearchTerms,
  buildCanvasHarvestFixturePlan,
  buildCanvasHarvestFixturePrototypeDraftDocument,
  buildCanvasHarvestFixturePrototypeValidationBacklogDocument,
  promoteCanvasHarvestFixturePrototypeDraft,
  recordCanvasHarvestFixturePrototypeValidation,
  renderCanvasHarvestFixture,
  renderCanvasHarvestPrototypeValidationFixture,
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
