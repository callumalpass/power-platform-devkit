import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify } from '@pp/artifacts';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import YAML from 'yaml';
import type {
  CanvasControlDefinition,
  CanvasJsonValue,
  CanvasManifest,
  CanvasScreenDefinition,
  CanvasSourceModel,
} from './index';

export interface CanvasDataSourceSummary {
  name: string;
  type?: string;
  serviceKind?: string;
  datasetName?: string;
  entityName?: string;
  apiName?: string;
}

export async function resolveCanvasPaYamlRoot(path: string): Promise<string | undefined> {
  const absolutePath = resolve(path);
  const directStats = await safeStat(absolutePath);

  if (directStats?.isFile() && basename(absolutePath).toLowerCase() === 'app.pa.yaml' && basename(dirname(absolutePath)) === 'Src') {
    return dirname(dirname(absolutePath));
  }

  if (directStats?.isDirectory() && basename(absolutePath) === 'Src' && (await fileExists(join(absolutePath, 'App.pa.yaml')))) {
    return dirname(absolutePath);
  }

  if (directStats?.isDirectory() && (await fileExists(join(absolutePath, 'Src', 'App.pa.yaml')))) {
    return absolutePath;
  }

  return undefined;
}

export async function loadCanvasPaYamlSource(path: string): Promise<OperationResult<CanvasSourceModel>> {
  const root = await resolveCanvasPaYamlRoot(path);

  if (!root) {
    return fail(
      createDiagnostic('error', 'CANVAS_PA_YAML_SOURCE_NOT_FOUND', `No unpacked canvas app source was found at ${path}.`, {
        source: '@pp/canvas',
        hint: 'Point to an unpacked app root containing Src/App.pa.yaml.',
      })
    );
  }

  const srcDir = join(root, 'Src');
  const appPath = join(srcDir, 'App.pa.yaml');
  const editorStatePath = join(srcDir, '_EditorState.pa.yaml');
  const appDocument = await loadYamlFile(appPath);

  if (!appDocument.success || appDocument.data === undefined) {
    return appDocument as unknown as OperationResult<CanvasSourceModel>;
  }

  const appRoot = asRecord(appDocument.data);
  const appNode = asRecord(appRoot?.App);

  if (!appNode) {
    return fail(
      createDiagnostic('error', 'CANVAS_PA_YAML_APP_INVALID', `Canvas app source ${appPath} must contain a top-level App mapping.`, {
        source: '@pp/canvas',
      })
    );
  }

  const appProperties = normalizePropertyRecord(appNode.Properties);
  const screenFiles = (await readdir(srcDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.pa.yaml') && !entry.name.startsWith('_') && entry.name !== 'App.pa.yaml')
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (screenFiles.length === 0) {
    return fail(
      createDiagnostic('error', 'CANVAS_PA_YAML_SCREENS_REQUIRED', `Canvas app source ${root} does not contain any screen YAML files.`, {
        source: '@pp/canvas',
      })
    );
  }

  const screens: CanvasScreenDefinition[] = [];

  for (const fileName of screenFiles) {
    const screenPath = join(srcDir, fileName);
    const screenDocument = await loadYamlFile(screenPath);

    if (!screenDocument.success || screenDocument.data === undefined) {
      return screenDocument as unknown as OperationResult<CanvasSourceModel>;
    }

    const screenRoot = asRecord(screenDocument.data);
    const screensNode = asRecord(screenRoot?.Screens);

    if (!screensNode || Object.keys(screensNode).length === 0) {
      return fail(
        createDiagnostic('error', 'CANVAS_PA_YAML_SCREEN_INVALID', `Canvas screen source ${screenPath} must contain a top-level Screens mapping.`, {
          source: '@pp/canvas',
        })
      );
    }

    for (const [screenName, screenValue] of Object.entries(screensNode)) {
      const screenNode = asRecord(screenValue);

      if (!screenNode) {
        return fail(
          createDiagnostic('error', 'CANVAS_PA_YAML_SCREEN_MAPPING_INVALID', `Screen ${screenName} in ${screenPath} must be a mapping.`, {
            source: '@pp/canvas',
          })
        );
      }

      const properties = normalizePropertyRecord(screenNode.Properties);
      const controls = normalizeChildren(screenNode.Children, screenName, screenPath);

      if (!controls.success || !controls.data) {
        return controls as unknown as OperationResult<CanvasSourceModel>;
      }

      screens.push({
        name: screenName,
        file: relative(root, screenPath).replaceAll('\\', '/'),
        properties,
        controls: controls.data,
      });
    }
  }

  const screenOrder = await loadScreenOrder(editorStatePath);
  const orderedScreens = orderScreensByEditorState(screens, screenOrder);
  const propertiesDocument = await readOptionalJson<Record<string, unknown>>(join(root, 'Properties.json'));
  const dataSources = await loadCanvasDataSources(join(root, 'References', 'DataSources.json'));
  const version =
    readString(propertiesDocument?.AppVersion) ??
    readString(propertiesDocument?.appVersion) ??
    readString(propertiesDocument?.OriginatingVersion);
  const manifest: CanvasManifest = {
    name: basename(root),
    displayName: basename(root),
    version,
    screens: orderedScreens.map((screen) => ({
      name: screen.name,
      file: screen.file,
    })),
  };
  const controls = summarizeCanvasControls(orderedScreens);
  const templateRequirements = Array.from(
    new Map(
      controls.map((control) => [
        `${control.templateName}@${control.templateVersion}`,
        {
          name: control.templateName,
          version: control.templateVersion,
        },
      ])
    ).values()
  ).sort((left, right) => left.name.localeCompare(right.name) || (left.version ?? '').localeCompare(right.version ?? ''));
  const sourceHash = sha256Hex(
    stableStringify({
      kind: 'pa-yaml-unpacked',
      appProperties,
      screens: orderedScreens,
      dataSources,
    } as unknown as Parameters<typeof stableStringify>[0])
  );

  return ok(
    {
      kind: 'pa-yaml-unpacked',
      root,
      manifestPath: appPath,
      manifest,
      appProperties,
      screens: orderedScreens,
      controls,
      templateRequirements,
      sourceHash,
      seedRegistryPath: (await fileExists(join(root, 'seed.templates.json'))) ? join(root, 'seed.templates.json') : undefined,
      dataSources,
      editorStatePath: (await fileExists(editorStatePath)) ? editorStatePath : undefined,
      unpackedArtifacts: {
        headerPath: (await fileExists(join(root, 'Header.json'))) ? join(root, 'Header.json') : undefined,
        propertiesPath: (await fileExists(join(root, 'Properties.json'))) ? join(root, 'Properties.json') : undefined,
        appCheckerPath: (await fileExists(join(root, 'AppCheckerResult.sarif'))) ? join(root, 'AppCheckerResult.sarif') : undefined,
        appControlPath: (await fileExists(join(root, 'Controls', '1.json'))) ? join(root, 'Controls', '1.json') : undefined,
        controlsDir: (await fileExists(join(root, 'Controls'))) ? join(root, 'Controls') : undefined,
        referencesDir: (await fileExists(join(root, 'References'))) ? join(root, 'References') : undefined,
        resourcesDir: (await fileExists(join(root, 'Resources'))) ? join(root, 'Resources') : undefined,
      },
    },
    {
      supportTier: 'preview',
    }
  );
}

async function loadYamlFile(path: string): Promise<OperationResult<unknown>> {
  try {
    const contents = await readFile(path, 'utf8');
    return ok(YAML.parse(contents), {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CANVAS_PA_YAML_READ_FAILED', `Failed to read YAML content from ${path}.`, {
        source: '@pp/canvas',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function normalizeChildren(
  value: unknown,
  screenName: string,
  screenPath: string
): OperationResult<CanvasControlDefinition[]> {
  if (value === undefined) {
    return ok([], {
      supportTier: 'preview',
    });
  }

  if (!Array.isArray(value)) {
    return fail(
      createDiagnostic('error', 'CANVAS_PA_YAML_CHILDREN_INVALID', `Children in ${screenPath} must be a sequence.`, {
        source: '@pp/canvas',
      })
    );
  }

  const controls: CanvasControlDefinition[] = [];

  for (const [index, item] of value.entries()) {
    const controlEntry = asRecord(item);

    if (!controlEntry || Object.keys(controlEntry).length !== 1) {
      return fail(
        createDiagnostic(
          'error',
          'CANVAS_PA_YAML_CONTROL_ENTRY_INVALID',
          `Control entry #${index + 1} in ${screenPath} must contain exactly one named control mapping.`,
          {
            source: '@pp/canvas',
          }
        )
      );
    }

    const [name, controlValue] = Object.entries(controlEntry)[0] ?? [];
    const controlNode = asRecord(controlValue);

    if (!name || !controlNode) {
      return fail(
        createDiagnostic('error', 'CANVAS_PA_YAML_CONTROL_INVALID', `Control entry #${index + 1} in ${screenPath} is invalid.`, {
          source: '@pp/canvas',
        })
      );
    }

    const controlType = readString(controlNode.Control);

    if (!controlType) {
      return fail(
        createDiagnostic('error', 'CANVAS_PA_YAML_CONTROL_TYPE_REQUIRED', `Control ${name} in ${screenPath} must define Control.`, {
          source: '@pp/canvas',
        })
      );
    }

    const split = splitControlType(controlType);

    if (!split) {
      return fail(
        createDiagnostic(
          'error',
          'CANVAS_PA_YAML_CONTROL_TYPE_INVALID',
          `Control ${name} in ${screenPath} must use the form Constructor@Version.`,
          {
            source: '@pp/canvas',
          }
        )
      );
    }

    const children = normalizeChildren(controlNode.Children, screenName, screenPath);

    if (!children.success || !children.data) {
      return children as unknown as OperationResult<CanvasControlDefinition[]>;
    }

    controls.push({
      name,
      templateName: split.constructorName,
      templateVersion: split.templateVersion,
      properties: normalizePropertyRecord(controlNode.Properties),
      children: children.data,
      variantName: readString(controlNode.Variant),
      layoutName: readString(controlNode.Layout),
    });
  }

  return ok(controls, {
    supportTier: 'preview',
  });
}

function splitControlType(value: string): { constructorName: string; templateVersion: string } | undefined {
  const atIndex = value.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === value.length - 1) {
    return undefined;
  }

  const constructorName = value.slice(0, atIndex).trim();
  const templateVersion = value.slice(atIndex + 1).trim();

  if (constructorName.length === 0 || templateVersion.length === 0) {
    return undefined;
  }

  return {
    constructorName,
    templateVersion,
  };
}

function normalizePropertyRecord(value: unknown): Record<string, CanvasJsonValue> {
  const properties = asRecord(value);

  if (!properties) {
    return {};
  }

  return Object.fromEntries(Object.entries(properties).map(([key, nested]) => [key, normalizeJsonValue(nested)]));
}

function normalizeJsonValue(value: unknown): CanvasJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value as CanvasJsonValue;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeJsonValue(nested)])
    );
  }

  return String(value);
}

function summarizeCanvasControls(screens: CanvasScreenDefinition[]) {
  const controls: CanvasSourceModel['controls'] = [];

  for (const screen of screens) {
    appendControlSummaries(screen.name, screen.controls, `${screen.name}`, controls);
  }

  return controls.sort((left, right) => left.path.localeCompare(right.path));
}

function appendControlSummaries(
  screenName: string,
  controls: CanvasControlDefinition[],
  prefix: string,
  destination: CanvasSourceModel['controls']
): void {
  for (const control of controls) {
    const path = `${prefix}/${control.name}`;

    destination.push({
      path,
      screen: screenName,
      templateName: control.templateName,
      templateVersion: control.templateVersion,
      propertyCount: Object.keys(control.properties).length,
      childCount: control.children.length,
    });

    appendControlSummaries(screenName, control.children, path, destination);
  }
}

async function loadScreenOrder(path: string): Promise<string[]> {
  if (!(await fileExists(path))) {
    return [];
  }

  try {
    const contents = YAML.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const editorState = asRecord(contents.EditorState);
    const order = Array.isArray(editorState?.ScreensOrder) ? editorState.ScreensOrder : [];
    return order.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

function orderScreensByEditorState(screens: CanvasScreenDefinition[], screenOrder: string[]): CanvasScreenDefinition[] {
  if (screenOrder.length === 0) {
    return screens;
  }

  const byName = new Map(screens.map((screen) => [screen.name, screen]));
  const ordered = screenOrder.map((name) => byName.get(name)).filter((screen): screen is CanvasScreenDefinition => Boolean(screen));
  const included = new Set(ordered.map((screen) => screen.name));
  const remainder = screens.filter((screen) => !included.has(screen.name));
  return [...ordered, ...remainder];
}

async function loadCanvasDataSources(path: string): Promise<CanvasDataSourceSummary[]> {
  const document = await readOptionalJson<Record<string, unknown>>(path);
  const entries = Array.isArray(document?.DataSources) ? document.DataSources : [];

  return entries
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      name: readString(entry.Name) ?? '<unknown>',
      type: readString(entry.Type),
      serviceKind: readString(entry.ServiceKind),
      datasetName: readString(entry.DatasetName),
      entityName: readString(entry.EntityName),
      apiName: readString(entry.ApiName),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  if (!(await fileExists(path))) {
    return undefined;
  }

  try {
    return await readJsonFile<T>(path);
  } catch {
    return undefined;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
