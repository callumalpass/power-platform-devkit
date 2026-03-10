import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeHarvestedCanvasApp, deriveCanvasStudioEditUrl } from './harvest';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createFixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pp-canvas-harvest-'));
  tempDirs.push(root);
  await mkdir(join(root, 'References'), { recursive: true });
  await mkdir(join(root, 'Controls'), { recursive: true });
  await mkdir(join(root, 'Src'), { recursive: true });
  return root;
}

describe('canvas harvest helpers', () => {
  it('derives a Studio edit URL from appopenuri', () => {
    const derived = deriveCanvasStudioEditUrl(
      'https://apps.powerapps.com/play/e/default-contoso/a/1550c4d1-459d-48fe-bab5-aea226d4480f?tenantId=tenant-123&hint=user-456'
    );

    expect(derived).toBe(
      'https://make.powerapps.com/e/default-contoso/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F1550c4d1-459d-48fe-bab5-aea226d4480f&tenantId=tenant-123&hint=user-456'
    );
  });

  it('builds a registry and runtime summary from an unpacked msapp slice', async () => {
    const root = await createFixtureRoot();

    await writeFile(
      join(root, 'References', 'Templates.json'),
      JSON.stringify(
        {
          UsedTemplates: [
            {
              Name: 'modernText',
              Version: '1.0.0',
              Template: '<widget id="http://microsoft.com/appmagic/modernText" name="modernText" version="1.0.0" />',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      join(root, 'Properties.json'),
      JSON.stringify(
        {
          OriginatingVersion: '1.349',
          AppPreviewFlagsMap: {
            fluentv9controlspreview: true,
          },
          ControlCount: {
            label: 1,
          },
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      join(root, 'Src', 'Screen1.pa.yaml'),
      [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Text1:',
        '          Control: ModernText@1.0.0',
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      join(root, 'Controls', '4.json'),
      JSON.stringify(
        {
          TopParent: {
            Type: 'ControlInfo',
            Name: 'Screen1',
            Template: {
              Name: 'screen',
              Version: '1.0',
            },
            Children: [
              {
                Type: 'ControlInfo',
                Name: 'Text1',
                HasDynamicProperties: false,
                Parent: 'Screen1',
                Template: {
                  Name: 'modernText',
                  Version: '1.0.0',
                },
                Rules: [
                  {
                    Property: 'Text',
                    Category: 'Data',
                    InvariantScript: '"Text"',
                    RuleProviderType: 'Unknown',
                  },
                  {
                    Property: 'Height',
                    Category: 'Design',
                    InvariantScript: '32',
                    RuleProviderType: 'Unknown',
                  },
                ],
                ControlPropertyState: ['Text', 'Height'],
              },
            ],
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const analyzed = await analyzeHarvestedCanvasApp(root, {
      generatedAt: '2026-03-09T07:00:00.000Z',
      source: 'test/TEST',
      sourceAppId: '1550c4d1-459d-48fe-bab5-aea226d4480f',
      sourceArtifact: 'CanvasApps/TEST.msapp',
      platformVersion: '3.26024.14.0',
      appVersion: '2026-03-09T06:52:54Z',
    });

    expect(analyzed.registry.templates.map((template) => `${template.templateName}@${template.templateVersion}`)).toEqual([
      'modernText@1.0.0',
      'screen@1.0',
    ]);
    expect(analyzed.registry.templates[0]).toMatchObject({
      templateName: 'modernText',
      templateVersion: '1.0.0',
      aliases: {
        constructors: ['ModernText'],
      },
      provenance: {
        kind: 'harvested',
        source: 'test/TEST',
        sourceArtifact: 'CanvasApps/TEST.msapp',
        sourceAppId: '1550c4d1-459d-48fe-bab5-aea226d4480f',
        platformVersion: '3.26024.14.0',
        appVersion: '2026-03-09T06:52:54Z',
      },
    });
    expect(analyzed.registry.templates[0]?.files?.['Harvest/Runtime.json']).toMatchObject({
      instanceCount: 1,
      constructorAliases: ['ModernText'],
      hasDynamicProperties: false,
      controlPropertyState: ['Height', 'Text'],
    });
    expect(analyzed.summary.previewFlags).toEqual({
      fluentv9controlspreview: true,
    });
    expect(analyzed.summary.templates).toEqual([
      {
        templateName: 'modernText',
        templateVersion: '1.0.0',
        instanceCount: 1,
        constructorAliases: ['ModernText'],
        hasDynamicProperties: false,
      },
      {
        templateName: 'screen',
        templateVersion: '1.0',
        instanceCount: 1,
        constructorAliases: [],
        hasDynamicProperties: false,
      },
    ]);
  });

  it('promotes templates that only exist in the exported control tree', async () => {
    const root = await createFixtureRoot();

    await writeFile(
      join(root, 'References', 'Templates.json'),
      JSON.stringify(
        {
          UsedTemplates: [],
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      join(root, 'Properties.json'),
      JSON.stringify(
        {
          OriginatingVersion: '1.349',
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      join(root, 'Src', 'Screen1.pa.yaml'),
      [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Table1:',
        '          Control: PowerAppsOneGrid@1.0.278',
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      join(root, 'Controls', '4.json'),
      JSON.stringify(
        {
          TopParent: {
            Type: 'ControlInfo',
            Name: 'Screen1',
            Template: {
              Name: 'screen',
              Version: '1.0',
            },
            Children: [
              {
                Type: 'ControlInfo',
                Name: 'Table1',
                HasDynamicProperties: true,
                Parent: 'Screen1',
                Template: {
                  Name: 'PowerAppsOneGrid',
                  Version: '1.0.278',
                  Manifest: {
                    ControlType: 'dataset',
                  },
                },
                Rules: [
                  {
                    Property: 'Items',
                    Category: 'Data',
                    InvariantScript: 'Table({ Name: "Row" })',
                    RuleProviderType: 'Unknown',
                  },
                ],
                ControlPropertyState: ['Items'],
              },
            ],
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const analyzed = await analyzeHarvestedCanvasApp(root, {
      generatedAt: '2026-03-10T00:00:00.000Z',
      source: 'test/TEST',
      sourceArtifact: 'CanvasApps/TEST.msapp',
    });

    expect(analyzed.registry.templates.map((template) => `${template.templateName}@${template.templateVersion}`)).toEqual([
      'PowerAppsOneGrid@1.0.278',
      'screen@1.0',
    ]);
    expect(analyzed.registry.templates[0]?.files?.['Controls/EmbeddedTemplate.json']).toMatchObject({
      Name: 'PowerAppsOneGrid',
      Version: '1.0.278',
      Manifest: {
        ControlType: 'dataset',
      },
    });
  });
});
