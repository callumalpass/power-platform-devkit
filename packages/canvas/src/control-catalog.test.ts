import { describe, expect, it } from 'vitest';
import {
  assertCanvasControlCatalogLooksComplete,
  parseCanvasControlCatalogMarkdown,
  summarizeCanvasControlCatalogDocument,
  type CanvasControlCatalogSource,
} from './control-catalog';

describe('canvas control catalog parsing', () => {
  it('extracts control entries from the documented controls section', () => {
    const source: CanvasControlCatalogSource = {
      family: 'classic',
      learnUrl: 'https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/reference-properties',
      markdownUrl: 'https://raw.githubusercontent.com/MicrosoftDocs/powerapps-docs/live/powerapps-docs/maker/canvas-apps/reference-properties.md',
    };

    const entries = parseCanvasControlCatalogMarkdown(
      [
        '# Canvas controls',
        '',
        '## Controls',
        '',
        '**[Label](controls/control-text-box.md)** - Show text on the screen.',
        '**[Barcode scanner (retired)](controls/control-new-barcode-scanner.md)** - Legacy scanner.',
        '',
        '## More',
        '',
        'Other content.',
      ].join('\n'),
      source
    );

    expect(entries).toEqual([
      {
        family: 'classic',
        name: 'Label',
        description: 'Show text on the screen.',
        docPath: 'controls/control-text-box.md',
        learnUrl: 'https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/controls/control-text-box.md',
        markdownUrl: source.markdownUrl,
        status: [],
      },
      {
        family: 'classic',
        name: 'Barcode scanner',
        description: 'Legacy scanner.',
        docPath: 'controls/control-new-barcode-scanner.md',
        learnUrl: 'https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/controls/control-new-barcode-scanner.md',
        markdownUrl: source.markdownUrl,
        status: ['retired'],
      },
    ]);
  });

  it('extracts ordered-list entries with optional bold markers', () => {
    const source: CanvasControlCatalogSource = {
      family: 'modern',
      learnUrl: 'https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/controls/modern-controls/modern-controls-reference',
      markdownUrl:
        'https://raw.githubusercontent.com/MicrosoftDocs/powerapps-docs/live/powerapps-docs/maker/canvas-apps/controls/modern-controls/modern-controls-reference.md',
    };

    const entries = parseCanvasControlCatalogMarkdown(
      [
        '# Modern controls',
        '',
        '## Modern controls',
        '',
        '1. [Button](modern-control-button.md) – Interact with the app by clicking or tapping.',
        '2. **[Checkbox (preview)](modern-control-checkbox.md)** - Lets users choose true or false.',
        '',
        '## More',
      ].join('\n'),
      source
    );

    expect(entries).toEqual([
      {
        family: 'modern',
        name: 'Button',
        description: 'Interact with the app by clicking or tapping.',
        docPath: 'modern-control-button.md',
        learnUrl: 'https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/controls/modern-controls/modern-control-button.md',
        markdownUrl: source.markdownUrl,
        status: [],
      },
      {
        family: 'modern',
        name: 'Checkbox',
        description: 'Lets users choose true or false.',
        docPath: 'modern-control-checkbox.md',
        learnUrl: 'https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/controls/modern-controls/modern-control-checkbox.md',
        markdownUrl: source.markdownUrl,
        status: ['preview'],
      },
    ]);
  });

  it('flags suspiciously small docs-backed catalogs', () => {
    const summary = summarizeCanvasControlCatalogDocument({
      schemaVersion: 1,
      generatedAt: '2026-03-09T12:00:00.000Z',
      sources: [],
      controls: [
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
          name: 'Text',
          description: 'Modern text',
          docPath: 'modern-control-text.md',
          learnUrl: 'https://learn.microsoft.com/example/modern-text',
          markdownUrl: 'https://raw.example/modern-text.md',
          status: [],
        },
      ],
    });

    expect(summary).toEqual({
      total: 2,
      classic: 1,
      modern: 1,
    });

    expect(() =>
      assertCanvasControlCatalogLooksComplete(
        {
          schemaVersion: 1,
          generatedAt: '2026-03-09T12:00:00.000Z',
          sources: [],
          controls: [
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
              name: 'Text',
              description: 'Modern text',
              docPath: 'modern-control-text.md',
              learnUrl: 'https://learn.microsoft.com/example/modern-text',
              markdownUrl: 'https://raw.example/modern-text.md',
              status: [],
            },
          ],
        },
        {
          minimumClassic: 2,
          minimumModern: 2,
          minimumTotal: 4,
          context: 'Docs-backed catalog fetch',
        }
      )
    ).toThrowError('Docs-backed catalog fetch looks incomplete: got 2 controls (1 classic, 1 modern).');
  });
});
