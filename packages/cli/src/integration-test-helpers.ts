import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, vi } from 'vitest';
import type { DataverseFixture } from '../../../test/dataverse-fixture';
import { mapSnapshotStrings, repoRoot } from '../../../test/golden';
import { createZipArchive, extractZipArchive } from '../../canvas/src/archive';
import { main } from './index';

export const tempDirs: string[] = [];

export async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-cli-integration-'));
  tempDirs.push(path);
  return path;
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
}

export async function createSolutionArchive(path: string, managed: boolean): Promise<void> {
  const root = await createTempDir();
  await writeFile(
    join(root, 'Solution.xml'),
    [
      '<ImportExportXml>',
      '  <SolutionManifest>',
      '    <UniqueName>Core</UniqueName>',
      '    <Version>1.2.3.4</Version>',
      `    <Managed>${managed ? '1' : '0'}</Managed>`,
      '  </SolutionManifest>',
      '</ImportExportXml>',
      '',
    ].join('\n'),
    'utf8'
  );
  const created = await createZipArchive(root, path);
  expect(created.success).toBe(true);
}

export async function writeUnpackedCanvasFixture(
  root: string,
  options: {
    name: string;
    screenYaml: string;
    registry: Record<string, unknown>;
  }
): Promise<string> {
  const appRoot = join(root, options.name);
  await mkdir(join(appRoot, 'Src'), { recursive: true });
  await mkdir(join(appRoot, 'Controls'), { recursive: true });
  await mkdir(join(appRoot, 'References'), { recursive: true });
  await mkdir(join(appRoot, 'Resources'), { recursive: true });

  await writeFile(
    join(appRoot, 'Src', 'App.pa.yaml'),
    ['App:', '  Properties:', '    Theme: =PowerAppsTheme', ''].join('\n'),
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

export function createClassicButtonRegistry(): Record<string, unknown> {
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

export function normalizeCliSnapshot<T>(value: T, ...tempPaths: string[]): T {
  return mapSnapshotStrings(value, (entry) => {
    let normalized = entry.replaceAll(repoRoot, '<REPO_ROOT>').replaceAll('\\', '/');

    for (const tempPath of tempPaths) {
      normalized = normalized.replaceAll(tempPath.replaceAll('\\', '/'), '<TMP_DIR>');
    }

    return normalized;
  });
}

export function normalizeCanvasTempRegistrySnapshot<T>(value: T, ...tempPaths: string[]): T {
  const normalized = normalizeCliSnapshot(value, ...tempPaths);

  if (typeof normalized !== 'object' || normalized === null) {
    return normalized;
  }

  return mapSnapshotStrings(normalized, (entry) => {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry)) {
      return '<GENERATED_AT>';
    }

    if (/^[a-f0-9]{64}$/.test(entry)) {
      return '<HASH>';
    }

    return entry;
  });
}

export function normalizeImportedRegistryRoundTrip<T>(value: T, ...tempPaths: string[]): T {
  const normalized = normalizeCliSnapshot(value, ...tempPaths) as T;

  if (typeof normalized !== 'object' || normalized === null) {
    return normalized;
  }

  return mapSnapshotStrings(normalized, (entry) =>
    entry === '<TMP_DIR>/normalized.json' ? '<REPO_ROOT>/fixtures/canvas/registries/import-source.json' : entry
  );
}

export async function unzipCanvasPackage(packagePath: string, root: string): Promise<string> {
  const unzipDir = join(root, 'unzipped');
  await mkdir(unzipDir, { recursive: true });
  const extracted = await extractZipArchive(packagePath, unzipDir);
  expect(extracted.success).toBe(true);
  return unzipDir;
}

export async function createZipPackage(sourceDir: string, outPath: string): Promise<void> {
  const created = await createZipArchive(sourceDir, outPath);
  expect(created.success).toBe(true);
}

export async function writeNodeCommandFixture(basePath: string, bodyLines: string[]): Promise<string> {
  const scriptPath = basePath.endsWith('.js') ? basePath : `${basePath}.js`;
  const scriptBody = ['#!/usr/bin/env node', ...bodyLines, ''].join('\n');
  await writeFile(scriptPath, scriptBody, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = scriptPath.replace(/\.js$/i, '.cmd');
    await writeFile(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0\\${basename(scriptPath)}" %*\r\n`, 'utf8');
    return commandPath;
  }

  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function writeSolutionExportMetadata(root: string, managed = false): Promise<void> {
  await writeFile(
    join(root, 'solution.xml'),
    `<ImportExportXml><SolutionManifest><UniqueName>Core</UniqueName><Version>1.0.0.0</Version><Managed>${managed ? '1' : '0'}</Managed></SolutionManifest></ImportExportXml>`,
    'utf8'
  );
}

export function normalizeNativeCanvasBuildSnapshot<T>(value: T, ...tempPaths: string[]): T {
  const normalized = normalizeCliSnapshot(value, ...tempPaths);

  if (typeof normalized !== 'object' || normalized === null) {
    return normalized;
  }

  const record = normalized as Record<string, unknown>;

  if ('outFileSha256' in record) {
    return { ...record, outFileSha256: '<OUT_FILE_SHA256>' } as T;
  }

  return normalized;
}

export function normalizeNativeHeaderSnapshot<T>(value: T): T {
  const normalized = normalizeCliSnapshot(value);

  if (typeof normalized !== 'object' || normalized === null || !('LastSavedDateTimeUTC' in normalized)) {
    return normalized;
  }

  return {
    ...(normalized as Record<string, unknown>),
    LastSavedDateTimeUTC: '<LAST_SAVED_DATE_TIME_UTC>',
  } as T;
}

export interface FlowRuntimeFixture {
  query?: DataverseFixture['query'];
  queryAll?: DataverseFixture['queryAll'];
}

export interface SolutionFixtureEnvironments {
  source: DataverseFixture;
  target: DataverseFixture;
}

export async function runCli(
  args: string[],
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
  } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stderr.write);
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  const originalEnv = new Map(Object.keys(options.env ?? {}).map((key) => [key, process.env[key]]));

  process.argv = ['node', 'pp', ...args];

  if (options.cwd) {
    process.chdir(options.cwd);
  }

  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    const code = await main(args);
    return {
      code,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  } finally {
    process.argv = originalArgv;
    process.chdir(originalCwd);

    for (const [key, value] of originalEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}
