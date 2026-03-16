import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { lintCanvasApp } from './index';
import { CanvasLspSession, type LspPublishDiagnosticsParams } from './lsp';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-canvas-lsp-'));
  tempDirs.push(path);
  return path;
}

async function writeCanvasProject(root: string): Promise<{ appRoot: string; screenPath: string }> {
  const projectRoot = join(root, 'project');
  const appRoot = join(projectRoot, 'CanvasApp');
  const screenPath = join(appRoot, 'Src', 'Screen1.pa.yaml');
  await mkdir(join(appRoot, 'Src'), { recursive: true });
  await mkdir(join(appRoot, 'Controls'), { recursive: true });
  await mkdir(join(appRoot, 'References'), { recursive: true });
  await mkdir(join(appRoot, 'Resources'), { recursive: true });

  await writeFile(join(projectRoot, 'pp.config.yaml'), ['templateRegistries:', '  - ./CanvasApp/controls.json', ''].join('\n'), 'utf8');
  await writeFile(
    join(appRoot, 'Src', 'App.pa.yaml'),
    ['App:', '  Properties:', '    Theme: =PowerAppsTheme', ''].join('\n'),
    'utf8'
  );
  await writeFile(
    screenPath,
    [
      'Screens:',
      '  Screen1:',
      '    Children:',
      '      - Button1:',
      '          Control: Classic/Button@2.2.0',
      '          Properties:',
      '            Text: ="Ready"',
      '            OnSelect: =Notify(Button2.Text)',
      '      - Button2:',
      '          Control: Classic/Button@2.2.0',
      '          Properties:',
      '            Text: ="Ship it"',
      '',
    ].join('\n'),
    'utf8'
  );
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
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(join(appRoot, 'Properties.json'), JSON.stringify({ AppVersion: '1.0.0' }, null, 2), 'utf8');
  await writeFile(join(appRoot, 'Controls', '1.json'), JSON.stringify({ TopParent: { Name: 'App' } }, null, 2), 'utf8');
  await writeFile(
    join(appRoot, 'References', 'DataSources.json'),
    JSON.stringify(
      {
        DataSources: [
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
  await writeFile(join(appRoot, 'controls.json'), JSON.stringify(createClassicButtonRegistry(), null, 2), 'utf8');

  return { appRoot, screenPath };
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
        modes: ['strict'],
      },
    ],
  };
}

function positionOf(text: string, snippet: string): { line: number; character: number } {
  const offset = text.indexOf(snippet);

  if (offset < 0) {
    throw new Error(`Snippet not found: ${snippet}`);
  }

  const before = text.slice(0, offset);
  const lines = before.split('\n');
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  };
}

describe('canvas lsp session', () => {
  it('keeps textDocument diagnostics aligned with batch lint for unsaved pa.yaml edits', async () => {
    const root = await createTempDir();
    const { appRoot, screenPath } = await writeCanvasProject(root);
    const screenText = [
      'Screens:',
      '  Screen1:',
      '    Children:',
      '      - Button1:',
      '          Control: Classic/Button@2.2.0',
      '          Properties:',
      '            Text: =Contacts.MissingField',
      '            OnSelect: =Notify(Button2.Text)',
      '            InvalidThing: =1',
      '      - Button2:',
      '          Control: Classic/Button@2.2.0',
      '          Properties:',
      '            Text: ="Ship it"',
      '',
    ].join('\n');
    const published: LspPublishDiagnosticsParams[] = [];
    const session = new CanvasLspSession({
      projectPath: join(root, 'project'),
      publishDiagnostics: async (params) => {
        published.push(params);
      },
    });
    const uri = pathToFileURL(screenPath).toString();

    await session.handleRequest('initialize', {});
    await session.handleNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'powerapps',
        version: 1,
        text: screenText,
      },
    });

    const batch = await lintCanvasApp(appRoot, {
      mode: 'strict',
      root: join(root, 'project'),
      registries: ['./CanvasApp/controls.json'],
      sourceFiles: {
        [screenPath]: screenText,
      },
    });
    const response = (await session.handleRequest('textDocument/diagnostic', {
      textDocument: { uri },
    })) as { kind: 'full'; items: Array<{ code: string; message: string }> };

    expect(batch.success).toBe(true);
    const expected = (batch.data?.diagnostics ?? []).filter((diagnostic) => diagnostic.location?.file === 'Src/Screen1.pa.yaml');
    expect(response.items.map((item) => item.code)).toEqual(expected.map((diagnostic) => diagnostic.code));
    expect(response.items.map((item) => item.message)).toEqual(expected.map((diagnostic) => diagnostic.message));
    expect(published.at(-1)?.diagnostics.map((item) => item.code)).toEqual(expected.map((diagnostic) => diagnostic.code));
  });

  it('serves hover, completion, and definition from the shared semantic model', async () => {
    const root = await createTempDir();
    const { screenPath } = await writeCanvasProject(root);
    const screenText = [
      'Screens:',
      '  Screen1:',
      '    Children:',
      '      - Button1:',
      '          Control: Classic/Button@2.2.0',
      '          Properties:',
      '            Text: =Contacts.Email',
      '            OnSelect: =Notify(Button2.Text)',
      '      - Button2:',
      '          Control: Classic/Button@2.2.0',
      '          Properties:',
      '            Text: ="Ship it"',
      '',
    ].join('\n');
    const session = new CanvasLspSession({
      projectPath: join(root, 'project'),
    });
    const uri = pathToFileURL(screenPath).toString();

    await session.handleRequest('initialize', {});
    await session.handleNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'powerapps',
        version: 1,
        text: screenText,
      },
    });

    const hover = (await session.handleRequest('textDocument/hover', {
      textDocument: { uri },
      position: positionOf(screenText, 'Button2.Text'),
    })) as { contents: { value: string } } | null;
    const definition = (await session.handleRequest('textDocument/definition', {
      textDocument: { uri },
      position: positionOf(screenText, 'Button2.Text'),
    })) as Array<{ uri: string; range: { start: { line: number; character: number } } }> | null;
    const formulaCompletion = (await session.handleRequest('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(screenText, 'Contacts.Email'),
    })) as Array<{ label: string }>;
    const controlHover = (await session.handleRequest('textDocument/hover', {
      textDocument: { uri },
      position: positionOf(screenText, 'Classic/Button@2.2.0'),
    })) as { contents: { value: string } } | null;

    expect(hover?.contents.value).toContain('Button2');
    expect(hover?.contents.value).toContain('Kind: control');
    expect(definition?.[0]?.uri).toBe(uri);
    expect(definition?.[0]?.range.start.line).toBe(positionOf(screenText, '      - Button2:').line);
    expect(formulaCompletion.map((item) => item.label)).toEqual(expect.arrayContaining(['Button1', 'Button2', 'Contacts']));
    expect(controlHover?.contents.value).toContain('Classic/Button@2.2.0');
  });

  it('returns contextual dot-completions for data sources and controls', async () => {
    const root = await createTempDir();
    const { screenPath } = await writeCanvasProject(root);
    const screenText = [
      'Screens:',
      '  Screen1:',
      '    Children:',
      '      - Button1:',
      '          Control: Classic/Button@2.2.0',
      '          Properties:',
      '            Text: =Contacts.Email',
      '            OnSelect: =Notify(Button1.Text)',
      '      - Button2:',
      '          Control: Classic/Button@2.2.0',
      '          Properties:',
      '            Text: ="Ship it"',
      '',
    ].join('\n');
    const session = new CanvasLspSession({
      projectPath: join(root, 'project'),
    });
    const uri = pathToFileURL(screenPath).toString();

    await session.handleRequest('initialize', {});
    await session.handleNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'powerapps',
        version: 1,
        text: screenText,
      },
    });

    // Completion right after "Contacts." should return column names
    const dataSourceCompletion = (await session.handleRequest('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(screenText, 'Email'),
    })) as Array<{ label: string; kind: number }>;

    expect(dataSourceCompletion.map((item) => item.label)).toEqual(['Email', 'Full Name']);
    expect(dataSourceCompletion.every((item) => item.kind === 5)).toBe(true);

    // Completion right after "Button1." should return template properties
    const controlCompletion = (await session.handleRequest('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(screenText, 'Text)'),
    })) as Array<{ label: string; kind: number }>;

    expect(controlCompletion.map((item) => item.label).sort()).toEqual(['Height', 'OnSelect', 'Text', 'Width', 'X', 'Y']);
    expect(controlCompletion.every((item) => item.kind === 10)).toBe(true);
  });
});
