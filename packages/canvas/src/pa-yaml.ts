import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify } from '@pp/artifacts';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import YAML, { isMap, isScalar, isSeq, type Document, type Pair, type YAMLMap } from 'yaml';
import type {
  CanvasControlDefinition,
  CanvasEntityMetadata,
  CanvasJsonValue,
  CanvasManifest,
  CanvasMetadataCatalog,
  CanvasNodeSourceInfo,
  CanvasScreenDefinition,
  CanvasSourceModel,
  CanvasSourcePosition,
  CanvasSourceSpan,
} from './canvas-types';

export interface CanvasSourceReadOptions {
  sourceFiles?: Record<string, string>;
}

export interface CanvasDataSourceSummary {
  name: string;
  type?: string;
  serviceKind?: string;
  datasetName?: string;
  entityName?: string;
  apiName?: string;
  metadata?: CanvasEntityMetadata;
}

interface LoadedYamlFile {
  data: unknown;
  document: Document.Parsed;
  contents: string;
}

interface CanvasPaYamlLayout {
  root: string;
  srcDir: string;
  compatibilitySource?: 'fx-unpack-other-src';
}

async function resolveCanvasPaYamlLayout(path: string): Promise<CanvasPaYamlLayout | undefined> {
  const absolutePath = resolve(path);
  const directStats = await safeStat(absolutePath);

  if (directStats?.isFile() && basename(absolutePath).toLowerCase() === 'app.pa.yaml' && basename(dirname(absolutePath)) === 'Src' && basename(dirname(dirname(absolutePath))) === 'Other') {
    const root = dirname(dirname(dirname(absolutePath)));
    return {
      root,
      srcDir: dirname(absolutePath),
      compatibilitySource: 'fx-unpack-other-src',
    };
  }

  if (directStats?.isFile() && basename(absolutePath).toLowerCase() === 'app.pa.yaml' && basename(dirname(absolutePath)) === 'Src') {
    const srcDir = dirname(absolutePath);
    return {
      root: dirname(srcDir),
      srcDir,
    };
  }

  if (directStats?.isDirectory() && basename(absolutePath) === 'Src' && (await fileExists(join(absolutePath, 'App.pa.yaml')))) {
    return {
      root: dirname(absolutePath),
      srcDir: absolutePath,
    };
  }

  if (directStats?.isDirectory() && (await fileExists(join(absolutePath, 'Src', 'App.pa.yaml')))) {
    return {
      root: absolutePath,
      srcDir: join(absolutePath, 'Src'),
    };
  }

  if (directStats?.isDirectory() && (await fileExists(join(absolutePath, 'Other', 'Src', 'App.pa.yaml')))) {
    return {
      root: absolutePath,
      srcDir: join(absolutePath, 'Other', 'Src'),
      compatibilitySource: 'fx-unpack-other-src',
    };
  }

  return undefined;
}

export async function resolveCanvasPaYamlRoot(path: string): Promise<string | undefined> {
  return (await resolveCanvasPaYamlLayout(path))?.root;
}

export async function loadCanvasPaYamlSource(path: string, options: CanvasSourceReadOptions = {}): Promise<OperationResult<CanvasSourceModel>> {
  const layout = await resolveCanvasPaYamlLayout(path);

  if (!layout) {
    return fail(
      createDiagnostic('error', 'CANVAS_PA_YAML_SOURCE_NOT_FOUND', `No unpacked canvas app source was found at ${path}.`, {
        source: '@pp/canvas',
        hint: 'Point to an unpacked app root containing Src/App.pa.yaml.',
      })
    );
  }

  const { root, srcDir } = layout;
  const appPath = join(srcDir, 'App.pa.yaml');
  const editorStatePath = join(srcDir, '_EditorState.pa.yaml');
  const appDocument = await loadYamlFile(appPath, options);

  if (!appDocument.success || appDocument.data === undefined) {
    return appDocument as unknown as OperationResult<CanvasSourceModel>;
  }

  const appRoot = asRecord(appDocument.data.data);
  const appNode = asRecord(appRoot?.App);
  const appYamlMap = getTopLevelMapping(appDocument.data.document, 'App');

  if (!appNode || !appYamlMap) {
    return fail(
      createDiagnostic('error', 'CANVAS_PA_YAML_APP_INVALID', `Canvas app source ${appPath} must contain a top-level App mapping.`, {
        source: '@pp/canvas',
      })
    );
  }

  const appFile = relative(root, appPath).replaceAll('\\', '/');
  const appProperties = normalizePropertyRecord(appNode.Properties);
  const appSource = createNodeSourceInfo(`app:${basename(root)}`, appFile, appDocument.data.contents, appYamlMap);
  const appPropertySpans = collectPropertySpans(appYamlMap.get('Properties', true), appFile, appDocument.data.contents);
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
    const screenDocument = await loadYamlFile(screenPath, options);

    if (!screenDocument.success || screenDocument.data === undefined) {
      return screenDocument as unknown as OperationResult<CanvasSourceModel>;
    }

    const screenRoot = asRecord(screenDocument.data.data);
    const screensNode = asRecord(screenRoot?.Screens);
    const screensYaml = getTopLevelMapping(screenDocument.data.document, 'Screens');

    if (!screensNode || !screensYaml || Object.keys(screensNode).length === 0) {
      return fail(
        createDiagnostic('error', 'CANVAS_PA_YAML_SCREEN_INVALID', `Canvas screen source ${screenPath} must contain a top-level Screens mapping.`, {
          source: '@pp/canvas',
        })
      );
    }

    const screenFile = relative(root, screenPath).replaceAll('\\', '/');

    for (const [screenName, screenValue] of Object.entries(screensNode)) {
      const screenNode = asRecord(screenValue);
      const screenPair = findPairByStringKey(screensYaml, screenName);
      const screenYamlMap = screenPair?.value;

      if (!screenNode || !isMap(screenYamlMap)) {
        return fail(
          createDiagnostic('error', 'CANVAS_PA_YAML_SCREEN_MAPPING_INVALID', `Screen ${screenName} in ${screenPath} must be a mapping.`, {
            source: '@pp/canvas',
          })
        );
      }

      const controls = normalizeChildren(
        screenNode.Children,
        screenName,
        screenPath,
        screenFile,
        screenDocument.data.contents,
        screenYamlMap.get('Children', true)
      );

      if (!controls.success || !controls.data) {
        return controls as unknown as OperationResult<CanvasSourceModel>;
      }

      screens.push({
        name: screenName,
        file: screenFile,
        properties: normalizePropertyRecord(screenNode.Properties),
        controls: controls.data,
        source: {
          ...createNodeSourceInfo(`screen:${screenName}`, screenFile, screenDocument.data.contents, screenYamlMap),
          nameSpan: createSpanFromNode(screenFile, screenDocument.data.contents, screenPair?.key),
          propertyNameSpans: collectPropertyNameSpans(screenYamlMap.get('Properties', true), screenFile, screenDocument.data.contents),
          propertySpans: collectPropertySpans(screenYamlMap.get('Properties', true), screenFile, screenDocument.data.contents),
          childrenSpan: createSpanFromNode(screenFile, screenDocument.data.contents, screenYamlMap.get('Children', true)),
        },
      });
    }
  }

  const screenOrder = await loadScreenOrder(editorStatePath, options);
  const orderedScreens = orderScreensByEditorState(screens, screenOrder);
  const propertiesDocument = await readOptionalJson<Record<string, unknown>>(join(root, 'Properties.json'), options);
  const dataSources = await loadCanvasDataSources(join(root, 'References', 'DataSources.json'), options);
  const metadataCatalog = buildMetadataCatalog(dataSources);
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
      embeddedRegistryPaths: (
        await Promise.all(
          [join(root, 'controls.json'), join(root, 'References', 'Templates.json'), join(root, 'ControlTemplates.json')].map(async (path) =>
            (await fileExists(path)) ? path : undefined
          )
        )
      ).filter((path): path is string => Boolean(path)),
      dataSources,
      metadataCatalog,
      editorStatePath: (await fileExists(editorStatePath)) ? editorStatePath : undefined,
      appSource,
      appPropertySpans,
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
      warnings:
        layout.compatibilitySource === 'fx-unpack-other-src'
          ? [
              createDiagnostic(
                'warning',
                'CANVAS_PA_YAML_COMPATIBILITY_SLICE_USED',
                `Canvas source ${root} was loaded from the embedded Other/Src .pa.yaml compatibility slice.`,
                {
                  source: '@pp/canvas',
                  hint: 'pp automatically reused the embedded legacy slice from this App.fx.yaml unpack so local inspect, validate, build, and diff can proceed.',
                }
              ),
            ]
          : [],
    }
  );
}

async function loadYamlFile(path: string, options: CanvasSourceReadOptions = {}): Promise<OperationResult<LoadedYamlFile>> {
  try {
    const contents = await readTextFile(path, options);
    const document = YAML.parseDocument(contents);
    return ok(
      {
        data: document.toJS(),
        document,
        contents,
      },
      {
        supportTier: 'preview',
      }
    );
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
  screenPath: string,
  file: string,
  contents: string,
  yamlNode?: unknown
): OperationResult<CanvasControlDefinition[]> {
  if (value === undefined) {
    return ok([], {
      supportTier: 'preview',
    });
  }

  if (!Array.isArray(value) || (yamlNode !== undefined && yamlNode !== null && !isSeq(yamlNode))) {
    return fail(
      createDiagnostic('error', 'CANVAS_PA_YAML_CHILDREN_INVALID', `Children in ${screenPath} must be a sequence.`, {
        source: '@pp/canvas',
      })
    );
  }

  const controls: CanvasControlDefinition[] = [];
  const childEntries = isSeq(yamlNode) ? yamlNode.items : [];

  for (const [index, item] of value.entries()) {
    const controlEntry = asRecord(item);
    const childNode = childEntries[index];

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
    const controlPair = isMap(childNode) ? childNode.items[0] : undefined;
    const controlYamlMap = controlPair?.value;

    if (!name || !controlNode || !controlPair || !isMap(controlYamlMap)) {
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

    const children = normalizeChildren(controlNode.Children, screenName, screenPath, file, contents, controlYamlMap.get('Children', true));

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
      source: {
        ...createNodeSourceInfo(`control:${screenName}/${name}`, file, contents, controlYamlMap),
        nameSpan: createSpanFromNode(file, contents, controlPair.key),
        propertyNameSpans: collectPropertyNameSpans(controlYamlMap.get('Properties', true), file, contents),
        propertySpans: collectPropertySpans(controlYamlMap.get('Properties', true), file, contents),
        controlTypeSpan: createSpanFromNode(file, contents, getMapValue(controlYamlMap, 'Control')),
        childrenSpan: createSpanFromNode(file, contents, controlYamlMap.get('Children', true)),
      },
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

async function loadScreenOrder(path: string, options: CanvasSourceReadOptions = {}): Promise<string[]> {
  if (!(await fileExists(path))) {
    return [];
  }

  try {
    const contents = YAML.parse(await readTextFile(path, options)) as Record<string, unknown>;
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

async function loadCanvasDataSources(path: string, options: CanvasSourceReadOptions = {}): Promise<CanvasDataSourceSummary[]> {
  const document = await readOptionalJson<Record<string, unknown>>(path, options);
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
      metadata: normalizeEntityMetadata(entry.Metadata),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getTopLevelMapping(document: Document.Parsed, key: string): YAMLMap<unknown, unknown> | undefined {
  const root = document.contents;

  if (!root || !isMap(root)) {
    return undefined;
  }

  const pair = findPairByStringKey(root, key);
  return pair && isMap(pair.value) ? pair.value : undefined;
}

function findPairByStringKey(map: YAMLMap<unknown, unknown>, key: string): Pair<unknown, unknown> | undefined {
  return map.items.find((entry) => readScalarString(entry.key) === key);
}

function getMapValue(map: YAMLMap<unknown, unknown>, key: string): unknown {
  return findPairByStringKey(map, key)?.value ?? undefined;
}

function collectPropertySpans(node: unknown, file: string, contents: string): Record<string, CanvasSourceSpan> | undefined {
  if (!node || !isMap(node)) {
    return undefined;
  }

  const spans = Object.fromEntries(
    node.items
      .map((entry) => {
        const key = readScalarString(entry.key);
        const span = createSpanFromNode(file, contents, entry.value);
        return key && span ? ([key, span] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, CanvasSourceSpan] => Boolean(entry))
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return Object.keys(spans).length > 0 ? spans : undefined;
}

function collectPropertyNameSpans(node: unknown, file: string, contents: string): Record<string, CanvasSourceSpan> | undefined {
  if (!node || !isMap(node)) {
    return undefined;
  }

  const spans = Object.fromEntries(
    node.items
      .map((entry) => {
        const key = readScalarString(entry.key);
        const span = createSpanFromNode(file, contents, entry.key);
        return key && span ? ([key, span] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, CanvasSourceSpan] => Boolean(entry))
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return Object.keys(spans).length > 0 ? spans : undefined;
}

function createNodeSourceInfo(id: string, file: string, contents: string, node: unknown): CanvasNodeSourceInfo {
  return {
    id,
    file,
    span: createSpanFromNode(file, contents, node),
    propertiesSpan: isMap(node) ? createSpanFromNode(file, contents, node.get('Properties', true)) : undefined,
  };
}

function createSpanFromNode(file: string, contents: string, node: unknown): CanvasSourceSpan | undefined {
  return createSpanFromRange(file, contents, getNodeRange(node));
}

function createSpanFromRange(file: string, contents: string, range: readonly [number, number, number] | undefined): CanvasSourceSpan | undefined {
  if (!range) {
    return undefined;
  }

  return {
    file,
    start: offsetToPosition(contents, range[0]),
    end: offsetToPosition(contents, range[1]),
  };
}

function getNodeRange(node: unknown): readonly [number, number, number] | undefined {
  const range = typeof node === 'object' && node !== null && 'range' in node ? (node as { range?: readonly [number, number, number] | null }).range : undefined;
  return range ?? undefined;
}

function offsetToPosition(contents: string, offset: number): CanvasSourcePosition {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset && index < contents.length; index += 1) {
    if (contents[index] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return {
    offset,
    line,
    column,
  };
}

function readScalarString(node: unknown): string | undefined {
  if (!node) {
    return undefined;
  }

  if (isScalar(node) && typeof node.value === 'string') {
    return node.value;
  }

  return typeof node === 'string' ? node : undefined;
}

function normalizeEntityMetadata(value: unknown): CanvasEntityMetadata | undefined {
  const metadata = asRecord(value);

  if (!metadata) {
    return undefined;
  }

  return {
    name: readString(metadata.Name) ?? readString(metadata.name) ?? '<unknown>',
    logicalName: readString(metadata.LogicalName) ?? readString(metadata.logicalName),
    displayName: readString(metadata.DisplayName) ?? readString(metadata.displayName),
    columns: normalizeColumns(metadata.Columns ?? metadata.columns),
    relationships: normalizeRelationships(metadata.Relationships ?? metadata.relationships),
    optionSets: normalizeOptionSets(metadata.OptionSets ?? metadata.optionSets),
  };
}

function normalizeColumns(value: unknown): CanvasEntityMetadata['columns'] {
  return normalizeObjectArray(value)
    .map((entry) => ({
      name: readString(entry.Name) ?? readString(entry.name) ?? '<unknown>',
      logicalName: readString(entry.LogicalName) ?? readString(entry.logicalName),
      displayName: readString(entry.DisplayName) ?? readString(entry.displayName),
      type: readString(entry.Type) ?? readString(entry.type),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeRelationships(value: unknown): CanvasEntityMetadata['relationships'] {
  return normalizeObjectArray(value)
    .map((entry) => ({
      name: readString(entry.Name) ?? readString(entry.name) ?? '<unknown>',
      target: readString(entry.Target) ?? readString(entry.target),
      columnName: readString(entry.ColumnName) ?? readString(entry.columnName),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeOptionSets(value: unknown): CanvasEntityMetadata['optionSets'] {
  return normalizeObjectArray(value)
    .map((entry) => ({
      name: readString(entry.Name) ?? readString(entry.name) ?? '<unknown>',
      values: normalizeObjectArray(entry.Values ?? entry.values)
        .map((option) => ({
          name: readString(option.Name) ?? readString(option.name) ?? '<unknown>',
          value:
            typeof option.Value === 'string' || typeof option.Value === 'number'
              ? option.Value
              : typeof option.value === 'string' || typeof option.value === 'number'
                ? option.value
                : undefined,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry)) : [];
}

function buildMetadataCatalog(dataSources: CanvasDataSourceSummary[]): CanvasMetadataCatalog | undefined {
  const entities = dataSources
    .map((source) => source.metadata)
    .filter((metadata): metadata is CanvasEntityMetadata => Boolean(metadata))
    .sort((left, right) => left.name.localeCompare(right.name));
  const optionSets = Array.from(
    new Map(entities.flatMap((entity) => entity.optionSets).map((optionSet) => [optionSet.name.toLowerCase(), optionSet] as const)).values()
  ).sort((left, right) => left.name.localeCompare(right.name));

  return entities.length > 0 || optionSets.length > 0
    ? {
        entities,
        optionSets,
      }
    : undefined;
}

async function readOptionalJson<T>(path: string, options: CanvasSourceReadOptions = {}): Promise<T | undefined> {
  if (!(await fileExists(path))) {
    return undefined;
  }

  try {
    return JSON.parse(await readTextFile(path, options)) as T;
  } catch {
    return undefined;
  }
}

async function readTextFile(path: string, options: CanvasSourceReadOptions): Promise<string> {
  const override = options.sourceFiles?.[resolve(path)];

  if (override !== undefined) {
    return override;
  }

  return readFile(path, 'utf8');
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
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
