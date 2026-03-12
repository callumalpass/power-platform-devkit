import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCanvasApp, buildCanvasSemanticModel, lintCanvasApp, loadCanvasSource, validateCanvasApp } from './index';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-canvas-pa-yaml-'));
  tempDirs.push(path);
  return path;
}

async function writeUnpackedCanvasFixture(
  root: string,
  options: {
    screenYaml: string;
    registry: Record<string, unknown>;
  }
): Promise<string> {
  const appRoot = join(root, 'YamlCanvas');
  await mkdir(join(appRoot, 'Src'), { recursive: true });
  await mkdir(join(appRoot, 'Controls'), { recursive: true });
  await mkdir(join(appRoot, 'References'), { recursive: true });
  await mkdir(join(appRoot, 'Resources'), { recursive: true });

  await writeFile(
    join(appRoot, 'Src', 'App.pa.yaml'),
    [
      '# header',
      'App:',
      '  Properties:',
      '    Theme: =PowerAppsTheme',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(join(appRoot, 'Src', 'Screen1.pa.yaml'), options.screenYaml, 'utf8');
  await writeFile(
    join(appRoot, 'Src', '_EditorState.pa.yaml'),
    ['EditorState:', '  ScreensOrder:', '    - Screen1', ''].join('\n'),
    'utf8'
  );
  await writeFile(
    join(appRoot, 'Header.json'),
    JSON.stringify(
      {
        DocVersion: '1.349',
        MinVersionToLoad: '1.349',
        MSAppStructureVersion: '2.4.0',
        LastSavedDateTimeUTC: '03/10/2026 00:00:00',
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(join(appRoot, 'Properties.json'), JSON.stringify({ AppVersion: '1.0.0' }, null, 2), 'utf8');
  await writeFile(
    join(appRoot, 'Controls', '1.json'),
    JSON.stringify(
      {
        TopParent: {
          Name: 'App',
        },
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    join(appRoot, 'References', 'DataSources.json'),
    JSON.stringify(
      {
        DataSources: [
          {
            Name: 'Accounts',
            Type: 'Table',
            DatasetName: 'default.cds',
            EntityName: 'account',
            Metadata: {
              Name: 'Accounts',
              LogicalName: 'account',
              Columns: [
                { Name: 'Account Name', Type: 'Text' },
                { Name: 'Category', Type: 'Choice' },
              ],
              Relationships: [{ Name: 'Primary Contact', Target: 'Contacts' }],
              OptionSets: [
                {
                  Name: 'Account Category',
                  Values: [{ Name: 'Preferred', Value: 1000 }],
                },
              ],
            },
          },
          {
            Name: 'Contacts',
            Type: 'Table',
            DatasetName: 'default.cds',
            EntityName: 'contact',
            Metadata: {
              Name: 'Contacts',
              LogicalName: 'contact',
              Columns: [
                { Name: 'Email', Type: 'Text' },
                { Name: 'Full Name', Type: 'Text' },
              ],
              Relationships: [],
              OptionSets: [],
            },
          },
        ],
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(join(appRoot, 'References', 'Themes.json'), JSON.stringify({ CurrentTheme: 'defaultTheme' }, null, 2), 'utf8');
  await writeFile(join(appRoot, 'Resources', 'PublishInfo.json'), JSON.stringify({ published: false }, null, 2), 'utf8');
  await writeFile(join(appRoot, 'controls.json'), JSON.stringify(options.registry, null, 2), 'utf8');

  return appRoot;
}

async function writeFxCompatibilityCanvasFixture(
  root: string,
  options: {
    screenYaml: string;
  }
): Promise<string> {
  const appRoot = join(root, 'FxCompatCanvas');
  await mkdir(join(appRoot, 'Other', 'Src'), { recursive: true });
  await mkdir(join(appRoot, 'Src'), { recursive: true });
  await mkdir(join(appRoot, 'pkgs'), { recursive: true });

  await writeFile(
    join(appRoot, 'Other', 'Src', 'App.pa.yaml'),
    [
      'App:',
      '  Properties:',
      '    Theme: =PowerAppsTheme',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(join(appRoot, 'Other', 'Src', 'Screen1.pa.yaml'), options.screenYaml, 'utf8');
  await writeFile(
    join(appRoot, 'Other', 'Src', '_EditorState.pa.yaml'),
    ['EditorState:', '  ScreensOrder:', '    - Screen1', ''].join('\n'),
    'utf8'
  );
  await writeFile(
    join(appRoot, 'Src', 'App.fx.yaml'),
    ['App As appinfo:', '    Theme: =PowerAppsTheme', ''].join('\n'),
    'utf8'
  );
  await writeFile(join(appRoot, 'Src', 'Screen1.fx.yaml'), 'Screen1 As screen:\n', 'utf8');
  await writeFile(
    join(appRoot, 'CanvasManifest.json'),
    JSON.stringify(
      {
        FormatVersion: '0.24',
        Header: {
          DocVersion: '1.349',
          MinVersionToLoad: '1.349',
          MSAppStructureVersion: '2.4.0',
        },
        Properties: {
          AppVersion: '1.0.0',
          Name: 'FxCompatCanvas',
          OriginatingVersion: '1.349',
        },
        ScreenOrder: ['Screen1'],
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    join(appRoot, 'ControlTemplates.json'),
    JSON.stringify(
      {
        button: {
          Name: 'button',
          Id: 'http://microsoft.com/appmagic/button',
          Version: '2.2.0',
          FirstParty: true,
          IsComponentTemplate: false,
          IsPremiumPcfControl: false,
          IsWidgetTemplate: true,
          OverridableProperties: {},
        },
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    join(appRoot, 'pkgs', 'button_2.2.0.xml'),
    [
      '<widget xmlns="http://openajax.org/metadata" xmlns:appMagic="http://schemas.microsoft.com/appMagic" id="http://microsoft.com/appmagic/button" name="button" version="2.2.0">',
      '  <properties>',
      '    <property name="Text" datatype="String" defaultValue="&quot;Button&quot;" isExpr="true">',
      '      <appMagic:category>data</appMagic:category>',
      '    </property>',
      '    <property name="OnSelect" datatype="Behavior" defaultValue="" isExpr="true">',
      '      <appMagic:category>behavior</appMagic:category>',
      '    </property>',
      '  </properties>',
      '  <appMagic:includeProperties>',
      '    <appMagic:includeProperty name="X" defaultValue="0" />',
      '    <appMagic:includeProperty name="Y" defaultValue="0" />',
      '  </appMagic:includeProperties>',
      '</widget>',
    ].join(''),
    'utf8'
  );

  return appRoot;
}

function createClassicButtonRegistry(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    templates: [
      {
        templateName: 'Button',
        templateVersion: '2.2.0',
        aliases: {
          constructors: ['Classic/Button'],
        },
        files: {
          'References/Templates.json': {
            name: 'Button',
            version: '2.2.0',
            templateXml: [
              '<widget xmlns="http://openajax.org/metadata" xmlns:appMagic="http://schemas.microsoft.com/appMagic" id="http://microsoft.com/appmagic/button" name="button" version="2.2.0">',
              '  <properties>',
              '    <property name="Text" datatype="String" defaultValue="&quot;Button&quot;" isExpr="true">',
              '      <appMagic:category>data</appMagic:category>',
              '    </property>',
              '    <property name="OnSelect" datatype="Behavior" defaultValue="" isExpr="true">',
              '      <appMagic:category>behavior</appMagic:category>',
              '    </property>',
              '  </properties>',
              '  <appMagic:includeProperties>',
              '    <appMagic:includeProperty name="X" defaultValue="0" />',
              '    <appMagic:includeProperty name="Y" defaultValue="0" />',
              '    <appMagic:includeProperty name="Width" defaultValue="120" />',
              '    <appMagic:includeProperty name="Height" defaultValue="40" />',
              '  </appMagic:includeProperties>',
              '</widget>',
            ].join(''),
          },
        },
        provenance: {
          source: 'test-registry',
        },
      },
    ],
    supportMatrix: [
      {
        templateName: 'Button',
        version: '2.2.0',
        status: 'supported',
        modes: ['strict', 'registry'],
      },
    ],
  };
}

describe('canvas pa.yaml source support', () => {
  it('loads unpacked pa.yaml sources and surfaces data sources', async () => {
    const dir = await createTempDir();
    const appRoot = await writeUnpackedCanvasFixture(dir, {
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Properties:',
        '      LoadingSpinnerColor: =RGBA(56, 96, 178, 1)',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Save"',
        '            X: =40',
        '            Y: =80',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });

    const source = await loadCanvasSource(appRoot);

    expect(source.success).toBe(true);
    expect(source.data?.kind).toBe('pa-yaml-unpacked');
    expect(source.data?.templateRequirements).toEqual([
      {
        name: 'Classic/Button',
        version: '2.2.0',
      },
    ]);
    expect(source.data?.dataSources).toHaveLength(2);
    expect(source.data?.dataSources?.[0]).toMatchObject({
      name: 'Accounts',
      type: 'Table',
      datasetName: 'default.cds',
      entityName: 'account',
    });
    expect(source.data?.screens[0]?.properties).toMatchObject({
      LoadingSpinnerColor: '=RGBA(56, 96, 178, 1)',
    });
  });

  it('validates control properties against harvested template metadata', async () => {
    const dir = await createTempDir();
    const appRoot = await writeUnpackedCanvasFixture(dir, {
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Save"',
        '            InvalidThing: =1',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });

    const validation = await validateCanvasApp(appRoot, {
      mode: 'strict',
      registries: ['./controls.json'],
      root: appRoot,
    });

    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(false);
    expect(validation.data?.propertyChecks).toContainEqual({
      controlPath: 'Screen1/Button1',
      property: 'InvalidThing',
      templateName: 'Button',
      templateVersion: '2.2.0',
      valid: false,
      source: 'templateXml',
    });
    expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'CANVAS_CONTROL_PROPERTY_INVALID')).toBe(true);
  });

  it('retains source spans and semantic bindings for pa.yaml formulas', async () => {
    const dir = await createTempDir();
    const appRoot = await writeUnpackedCanvasFixture(dir, {
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: =LookUp(Contacts, Email = User().Email, \'Full Name\')',
        '            OnSelect: =If(IsBlank(varSelectedAccount), "none", \'Account Category\'.Preferred)',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });

    const source = await loadCanvasSource(appRoot);

    expect(source.success).toBe(true);
    expect(source.data?.appPropertySpans?.Theme?.start.line).toBe(4);
    expect(source.data?.screens[0]?.source?.span?.start.line).toBe(3);
    expect(source.data?.screens[0]?.controls[0]?.source?.propertySpans?.Text?.start.line).toBe(7);
    expect(source.data?.metadataCatalog?.entities.map((entity) => entity.name)).toEqual(['Accounts', 'Contacts']);

    const semantic = buildCanvasSemanticModel(source.data!);
    const textFormula = semantic.formulas.find((formula) => formula.property === 'Text');
    const onSelectFormula = semantic.formulas.find((formula) => formula.property === 'OnSelect');

    expect(textFormula?.valid).toBe(true);
    expect(textFormula?.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'function', name: 'LookUp', resolved: true }),
        expect.objectContaining({ kind: 'dataSource', name: 'Contacts', resolved: true, metadataBacked: true }),
      ])
    );
    expect(onSelectFormula?.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'optionValue', name: 'Preferred', resolved: true, metadataBacked: true }),
        expect.objectContaining({ kind: 'variable', name: 'varSelectedAccount', resolved: true }),
      ])
    );
  });

  it('parses behavior formulas with chained Power Fx expressions', async () => {
    const dir = await createTempDir();
    const appRoot = await writeUnpackedCanvasFixture(dir, {
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            OnSelect: =Set(varX, 1); Notify("done")',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });

    const source = await loadCanvasSource(appRoot);
    const semantic = buildCanvasSemanticModel(source.data!);

    expect(semantic.formulas[0]).toMatchObject({
      property: 'OnSelect',
      valid: true,
      ast: {
        kind: 'ChainExpression',
      },
    });
    expect(semantic.formulas[0]?.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'function', name: 'Set', resolved: true }),
        expect.objectContaining({ kind: 'function', name: 'Notify', resolved: true }),
        expect.objectContaining({ kind: 'variable', name: 'varX', resolved: true }),
      ])
    );
  });

  it('emits source-aware lint diagnostics for metadata-backed formula regions', async () => {
    const dir = await createTempDir();
    const appRoot = await writeUnpackedCanvasFixture(dir, {
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: =Contacts.MissingField',
        '            OnSelect: =If(IsBlank(varSelectedAccount), "none", \'Account Category\'.MissingValue)',
        '            InvalidThing: =1',
        '      - Button2:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Ship it"',
        '            OnSelect: =Set(varX, 1); Notify("done")',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });

    const lint = await lintCanvasApp(appRoot, {
      mode: 'strict',
      registries: ['./controls.json'],
      root: appRoot,
    });

    expect(lint.success).toBe(true);
    expect(lint.data?.valid).toBe(false);
    const metadataDiagnostic = lint.data?.diagnostics.find((diagnostic) => diagnostic.code === 'CANVAS_METADATA_REFERENCE_UNRESOLVED');
    const propertyDiagnostic = lint.data?.diagnostics.find((diagnostic) => diagnostic.code === 'CANVAS_CONTROL_PROPERTY_INVALID');

    expect(metadataDiagnostic).toMatchObject({
      path: 'Src/Screen1.pa.yaml:7:19',
      location: {
        file: 'Src/Screen1.pa.yaml',
        start: {
          line: 7,
          column: 19,
        },
      },
    });
    expect(propertyDiagnostic).toMatchObject({
      path: 'Src/Screen1.pa.yaml:9:27',
    });
    expect(lint.data?.diagnostics.some((diagnostic) => diagnostic.code === 'CANVAS_POWERFX_UNSUPPORTED')).toBe(false);
  });

  it('builds a native msapp archive from unpacked pa.yaml sources', async () => {
    const dir = await createTempDir();
    const appRoot = await writeUnpackedCanvasFixture(dir, {
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Ship it"',
        '            OnSelect: =Notify("Done")',
        '            X: =90',
        '            Y: =120',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });
    const outPath = join(dir, 'dist', 'YamlCanvas.msapp');

    const build = await buildCanvasApp(appRoot, {
      mode: 'strict',
      registries: ['./controls.json'],
      root: appRoot,
      outPath,
    });

    expect(build.success).toBe(true);
    expect(build.data?.outPath).toBe(outPath);

    const unzipDir = join(dir, 'unzipped');
    await mkdir(unzipDir, { recursive: true });
    const unzipResult = spawnSync('unzip', ['-o', outPath, '-d', unzipDir], {
      encoding: 'utf8',
    });

    expect(unzipResult.status).toBe(0);

    const templates = JSON.parse(await readFile(join(unzipDir, 'References', 'Templates.json'), 'utf8')) as {
      UsedTemplates: Array<{ Name: string; Version: string }>;
    };
    const controls = JSON.parse(await readFile(join(unzipDir, 'Controls', '4.json'), 'utf8')) as {
      TopParent: {
        Children: Array<{
          Name: string;
          Rules: Array<{ Property: string; InvariantScript: string }>;
        }>;
      };
    };

    expect(templates.UsedTemplates).toMatchObject([
      {
        Name: 'Button',
        Version: '2.2.0',
      },
    ]);
    expect(controls.TopParent.Children[0]?.Name).toBe('Button1');
    expect(controls.TopParent.Children[0]?.Rules).toEqual(
      expect.arrayContaining([
        {
          Property: 'Text',
          Category: 'Data',
          InvariantScript: '"Ship it"',
          RuleProviderType: 'Unknown',
        },
        {
          Property: 'OnSelect',
          Category: 'Behavior',
          InvariantScript: 'Notify("Done")',
          RuleProviderType: 'Unknown',
        },
      ])
    );
  });

  it('loads App.fx.yaml unpacks through the embedded Other/Src compatibility slice', async () => {
    const dir = await createTempDir();
    const appRoot = await writeFxCompatibilityCanvasFixture(dir, {
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Compat"',
        '',
      ].join('\n'),
    });

    const source = await loadCanvasSource(appRoot);

    expect(source.success).toBe(true);
    expect(source.data?.kind).toBe('pa-yaml-unpacked');
    expect(source.data?.manifestPath.replaceAll('\\', '/')).toContain('/Other/Src/App.pa.yaml');
    expect(source.data?.embeddedRegistryPaths?.map((path) => path.replaceAll('\\', '/'))).toContain(
      `${appRoot.replaceAll('\\', '/')}/ControlTemplates.json`
    );
    expect(source.warnings.some((warning) => warning.code === 'CANVAS_PA_YAML_COMPATIBILITY_SLICE_USED')).toBe(true);
  });

  it('validates and builds App.fx.yaml unpacks with embedded control-template metadata', async () => {
    const dir = await createTempDir();
    const appRoot = await writeFxCompatibilityCanvasFixture(dir, {
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Compat"',
        '            OnSelect: =Notify("ok")',
        '            X: =10',
        '',
      ].join('\n'),
    });
    const outPath = join(dir, 'dist', 'FxCompatCanvas.msapp');

    const validation = await validateCanvasApp(appRoot, {
      mode: 'strict',
    });
    const build = await buildCanvasApp(appRoot, {
      mode: 'strict',
      outPath,
    });

    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(build.success).toBe(true);

    const unzipDir = join(dir, 'unzipped-fx');
    await mkdir(unzipDir, { recursive: true });
    const unzipResult = spawnSync('unzip', ['-o', outPath, '-d', unzipDir], {
      encoding: 'utf8',
    });

    expect(unzipResult.status).toBe(0);

    const appYaml = await readFile(join(unzipDir, 'Src', 'App.pa.yaml'), 'utf8');
    const templates = JSON.parse(await readFile(join(unzipDir, 'References', 'Templates.json'), 'utf8')) as {
      UsedTemplates: Array<{ Name: string; Version: string }>;
    };

    expect(appYaml).toContain('App:');
    expect(templates.UsedTemplates).toMatchObject([
      {
        Name: 'button',
        Version: '2.2.0',
      },
    ]);
  });
});
