import { stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadProjectConfig } from '@pp/config';
import type { OperationResult } from '@pp/diagnostics';
import {
  buildCanvasSemanticModel,
  lintCanvasApp,
  loadCanvasSource,
  loadCanvasTemplateRegistryBundle,
  resolveCanvasTemplateRequirements,
  resolveCanvasTemplateRegistryPaths,
  type CanvasBuildMode,
  type CanvasLintDiagnostic,
  type CanvasSemanticControl,
  type CanvasSemanticModel,
  type CanvasSourceLoadOptions,
  type CanvasSourceSpan,
} from './index';

const LSP_ERROR_INVALID_REQUEST = -32600;
const LSP_ERROR_METHOD_NOT_FOUND = -32601;
const LSP_ERROR_SERVER_NOT_INITIALIZED = -32002;

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspHover {
  contents: {
    kind: 'markdown';
    value: string;
  };
  range?: LspRange;
}

export interface LspPublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: LspDiagnostic[];
}

export interface CanvasLspSessionOptions {
  mode?: CanvasBuildMode;
  projectPath?: string;
  registries?: string[];
  cacheDir?: string;
  publishDiagnostics?: (params: LspPublishDiagnosticsParams) => void | Promise<void>;
}

interface TextDocumentState {
  uri: string;
  path: string;
  version?: number;
  text: string;
}

interface AnalysisContext {
  appRoot: string;
  source: Awaited<ReturnType<typeof loadCanvasSource>> extends OperationResult<infer T> ? T : never;
  semanticModel: CanvasSemanticModel;
  lintDiagnostics: CanvasLintDiagnostic[];
}

interface FormulaBindingHit {
  formula: CanvasSemanticModel['formulas'][number];
  binding: CanvasSemanticModel['formulas'][number]['bindings'][number];
  range: LspRange;
}

interface ControlContext {
  control?: CanvasSemanticControl;
  propertyName?: string;
  propertyNameRange?: LspRange;
  propertyValueRange?: LspRange;
  controlNameRange?: LspRange;
  controlTypeRange?: LspRange;
}

interface JsonRpcError {
  code: number;
  message: string;
}

export class CanvasLspSession {
  private readonly documents = new Map<string, TextDocumentState>();
  private initialized = false;
  private shutdownRequested = false;

  constructor(private readonly options: CanvasLspSessionOptions = {}) {}

  async handleRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== 'initialize' && !this.initialized) {
      throw this.createError(LSP_ERROR_SERVER_NOT_INITIALIZED, 'Server not initialized.');
    }

    if (this.shutdownRequested && method !== 'shutdown') {
      throw this.createError(LSP_ERROR_INVALID_REQUEST, 'Server has already been shut down.');
    }

    switch (method) {
      case 'initialize':
        this.initialized = true;
        return {
          capabilities: {
            textDocumentSync: {
              openClose: true,
              change: 1,
            },
            diagnosticProvider: {
              interFileDependencies: false,
              workspaceDiagnostics: false,
            },
            hoverProvider: true,
            definitionProvider: true,
            completionProvider: {
              triggerCharacters: ['=', '.', ':'],
            },
          },
          serverInfo: {
            name: 'pp-canvas-lsp',
            version: '0.1.0',
          },
        };
      case 'shutdown':
        this.shutdownRequested = true;
        return null;
      case 'textDocument/diagnostic':
        return this.handleDocumentDiagnostic(params);
      case 'textDocument/hover':
        return this.handleHover(params);
      case 'textDocument/completion':
        return this.handleCompletion(params);
      case 'textDocument/definition':
        return this.handleDefinition(params);
      default:
        throw this.createError(LSP_ERROR_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  async handleNotification(method: string, params: unknown): Promise<void> {
    if (!this.initialized && method !== 'exit') {
      return;
    }

    switch (method) {
      case 'textDocument/didOpen':
        await this.didOpen(params);
        break;
      case 'textDocument/didChange':
        await this.didChange(params);
        break;
      case 'textDocument/didClose':
        await this.didClose(params);
        break;
      case 'initialized':
      case 'exit':
        break;
      default:
        break;
    }
  }

  private async didOpen(params: unknown): Promise<void> {
    const textDocument = asRecord(params)?.textDocument;
    const uri = readString(asRecord(textDocument)?.uri);
    const text = readString(asRecord(textDocument)?.text);

    if (!uri || text === undefined) {
      return;
    }

    const path = uriToPath(uri);

    if (!path) {
      return;
    }

    const documentState: TextDocumentState = {
      uri,
      path,
      text,
      version: readNumber(asRecord(textDocument)?.version),
    };
    this.documents.set(uri, documentState);
    await this.publishDocumentDiagnostics(documentState.uri);
  }

  private async didChange(params: unknown): Promise<void> {
    const record = asRecord(params);
    const textDocument = asRecord(record?.textDocument);
    const uri = readString(textDocument?.uri);
    const document = uri ? this.documents.get(uri) : undefined;
    const changes = Array.isArray(record?.contentChanges) ? record?.contentChanges : [];
    const nextText = readString(asRecord(changes[0])?.text);

    if (!document || nextText === undefined) {
      return;
    }

    document.text = nextText;
    document.version = readNumber(textDocument?.version) ?? document.version;
    await this.publishDocumentDiagnostics(document.uri);
  }

  private async didClose(params: unknown): Promise<void> {
    const uri = readString(asRecord(asRecord(params)?.textDocument)?.uri);

    if (!uri) {
      return;
    }

    this.documents.delete(uri);
    await this.options.publishDiagnostics?.({
      uri,
      diagnostics: [],
    });
  }

  private async handleDocumentDiagnostic(params: unknown): Promise<{ kind: 'full'; items: LspDiagnostic[] }> {
    const uri = readString(asRecord(asRecord(params)?.textDocument)?.uri);

    if (!uri) {
      throw this.createError(LSP_ERROR_INVALID_REQUEST, 'textDocument/diagnostic requires a text document URI.');
    }

    const diagnostics = await this.collectDiagnostics(uri);
    return {
      kind: 'full',
      items: diagnostics,
    };
  }

  private async handleHover(params: unknown): Promise<LspHover | null> {
    const query = await this.resolvePositionQuery(params);

    if (!query) {
      return null;
    }

    const { analysis, filePath, position, relativeFile } = query;
    const formulaHit = this.findFormulaBindingAtPosition(analysis, relativeFile, position);

    if (formulaHit) {
      return {
        contents: {
          kind: 'markdown',
          value: buildBindingHover(formulaHit),
        },
        range: formulaHit.range,
      };
    }

    const controlContext = this.findControlContextAtPosition(analysis, relativeFile, position);

    if (controlContext?.control && controlContext.controlTypeRange && rangeContains(controlContext.controlTypeRange, position)) {
      const templateSurface = controlContext.control.templateSurface;
      const lines = [
        `**${controlContext.control.templateName}@${controlContext.control.templateVersion}**`,
        `Control path: \`${controlContext.control.path}\``,
      ];

      if (templateSurface) {
        lines.push(`Allowed properties: ${templateSurface.allowedProperties.length}`);
        if (templateSurface.sources.length > 0) {
          lines.push(`Metadata sources: ${templateSurface.sources.join(', ')}`);
        }
      } else {
        lines.push('Template metadata is not available for hover details in this region.');
      }

      return {
        contents: {
          kind: 'markdown',
          value: lines.join('\n\n'),
        },
        range: controlContext.controlTypeRange,
      };
    }

    if (controlContext?.control && controlContext.propertyName && controlContext.propertyNameRange && rangeContains(controlContext.propertyNameRange, position)) {
      const templateSurface = controlContext.control.templateSurface;
      const defaultValue = templateSurface?.defaultProperties[controlContext.propertyName];
      const category = templateSurface?.propertyCategories[controlContext.propertyName];
      const lines = [
        `**${controlContext.propertyName}**`,
        `Control path: \`${controlContext.control.path}\``,
      ];

      if (category) {
        lines.push(`Category: ${category}`);
      }

      if (defaultValue) {
        lines.push(`Default: \`${defaultValue}\``);
      }

      if (!category && !defaultValue) {
        lines.push('No harvested property metadata is available for this property.');
      }

      return {
        contents: {
          kind: 'markdown',
          value: lines.join('\n\n'),
        },
        range: controlContext.propertyNameRange,
      };
    }

    if (controlContext?.control && controlContext.controlNameRange && rangeContains(controlContext.controlNameRange, position)) {
      return {
        contents: {
          kind: 'markdown',
          value: `**${controlContext.control.name}**\n\nTemplate: \`${controlContext.control.templateName}@${controlContext.control.templateVersion}\`\n\nPath: \`${controlContext.control.path}\``,
        },
        range: controlContext.controlNameRange,
      };
    }

    return null;
  }

  private async handleCompletion(params: unknown): Promise<LspCompletionItem[]> {
    const query = await this.resolvePositionQuery(params);

    if (!query) {
      return [];
    }

    const { analysis, relativeFile, position } = query;
    const uri = readString(asRecord(asRecord(params)?.textDocument)?.uri);
    const documentText = uri ? this.documents.get(uri)?.text : undefined;
    const formulaHit = this.findFormulaBindingAtPosition(analysis, relativeFile, position);
    const controlContext = this.findControlContextAtPosition(analysis, relativeFile, position);

    if (formulaHit || (controlContext?.propertyValueRange && rangeContains(controlContext.propertyValueRange, position))) {
      if (documentText) {
        const dotPrefix = findDotPrefix(documentText, position);
        if (dotPrefix) {
          const dotCompletions = resolveDotCompletions(dotPrefix, analysis);
          if (dotCompletions.length > 0) {
            return dotCompletions;
          }
        }
      }

      return analysis.semanticModel.symbols.map((symbol) => ({
        label: symbol.name,
        kind: completionKindForSymbol(symbol.kind),
        detail: symbol.qualifiedName,
        documentation: `Canvas ${symbol.kind}`,
      }));
    }

    if (controlContext?.control) {
      const templateSurface = controlContext.control.templateSurface;

      if (!templateSurface) {
        return [];
      }

      const existing = new Set(controlContext.control.propertyNames.map((name) => name.toLowerCase()));
      return templateSurface.allowedProperties
        .filter((property) => !existing.has(property.toLowerCase()))
        .map((property) => ({
          label: property,
          kind: 10,
          detail: templateSurface.propertyCategories[property],
          documentation: templateSurface.defaultProperties[property]
            ? `Default: \`${templateSurface.defaultProperties[property]}\``
            : undefined,
        }));
    }

    return [];
  }

  private async handleDefinition(params: unknown): Promise<LspLocation[] | null> {
    const query = await this.resolvePositionQuery(params);

    if (!query) {
      return null;
    }

    const formulaHit = this.findFormulaBindingAtPosition(query.analysis, query.relativeFile, query.position);

    if (!formulaHit?.binding.resolved || formulaHit.binding.kind !== 'control' || !formulaHit.binding.targetId) {
      return null;
    }

    const target = query.analysis.semanticModel.controls.find((control) => control.id === formulaHit.binding.targetId);
    const targetSpan = target?.source?.nameSpan ?? target?.source?.span;

    if (!target?.source?.file || !targetSpan) {
      return null;
    }

    return [
      {
        uri: pathToFileURL(join(query.analysis.appRoot, target.source.file)).toString(),
        range: toLspRange(targetSpan),
      },
    ];
  }

  private async resolvePositionQuery(params: unknown): Promise<{
    analysis: AnalysisContext;
    filePath: string;
    relativeFile: string;
    position: LspPosition;
  } | null> {
    const record = asRecord(params);
    const textDocument = asRecord(record?.textDocument);
    const uri = readString(textDocument?.uri);
    const positionRecord = asRecord(record?.position);
    const filePath = uri ? uriToPath(uri) : undefined;

    if (!uri || !filePath || !positionRecord) {
      return null;
    }

    const analysis = await this.analyzeFile(filePath);

    if (!analysis) {
      return null;
    }

    return {
      analysis,
      filePath,
      relativeFile: relative(analysis.appRoot, filePath).replaceAll('\\', '/'),
      position: {
        line: readNumber(positionRecord.line) ?? 0,
        character: readNumber(positionRecord.character) ?? 0,
      },
    };
  }

  private async collectDiagnostics(uri: string): Promise<LspDiagnostic[]> {
    const filePath = uriToPath(uri);

    if (!filePath) {
      return [];
    }

    const analysis = await this.analyzeFile(filePath);

    if (!analysis) {
      return [];
    }

    const document = this.documents.get(uri);
    return analysis.lintDiagnostics
      .filter((diagnostic) => matchesDocumentDiagnostic(analysis.appRoot, filePath, diagnostic))
      .map((diagnostic) => toLspDiagnostic(diagnostic, document?.text));
  }

  private async publishDocumentDiagnostics(uri: string): Promise<void> {
    const diagnostics = await this.collectDiagnostics(uri);
    const version = this.documents.get(uri)?.version;

    await this.options.publishDiagnostics?.({
      uri,
      version,
      diagnostics,
    });
  }

  private async analyzeFile(filePath: string): Promise<AnalysisContext | undefined> {
    const appRoot = await findCanvasAppRoot(filePath);

    if (!appRoot) {
      return undefined;
    }

    const sourceFiles = Object.fromEntries(
      Array.from(this.documents.values())
        .filter((document) => document.path === appRoot || document.path.startsWith(`${appRoot}/`) || document.path.startsWith(`${appRoot}\\`))
        .map((document) => [resolve(document.path), document.text] as const)
    );
    const registryPaths = await this.resolveRegistryPaths(appRoot);
    const loadOptions: CanvasSourceLoadOptions = {
      root: appRoot,
      registries: registryPaths,
      cacheDir: this.options.cacheDir,
      sourceFiles,
    };
    const [source, lint] = await Promise.all([
      loadCanvasSource(appRoot, loadOptions),
      lintCanvasApp(appRoot, {
        ...loadOptions,
        mode: this.options.mode ?? 'strict',
      }),
    ]);

    if (!source.success || !source.data) {
      return undefined;
    }

    const bundleRegistries = source.data.seedRegistryPath ? [source.data.seedRegistryPath, ...registryPaths] : registryPaths;
    const bundle = await loadCanvasTemplateRegistryBundle({
      root: appRoot,
      registries: bundleRegistries,
      cacheDir: this.options.cacheDir,
    });
    const templateRequirements =
      bundle.success && bundle.data
        ? resolveCanvasTemplateRequirements(source.data.templateRequirements, {
            mode: this.options.mode ?? 'strict',
            registry: bundle.data,
          })
        : undefined;
    const semanticModel = await buildCanvasSemanticModel(source.data, {
      templateResolutions: templateRequirements?.resolutions,
    });

    return {
      appRoot,
      source: source.data,
      semanticModel,
      lintDiagnostics: lint.success && lint.data ? lint.data.diagnostics : [],
    };
  }

  private async resolveRegistryPaths(appRoot: string): Promise<string[]> {
    const paths: string[] = [];
    const projectStart = this.options.projectPath ? resolve(this.options.projectPath) : appRoot;
    const project = await loadProjectConfig(projectStart);

    if (project.success && project.data?.config.templateRegistries && project.data.config.templateRegistries.length > 0) {
      const resolved = resolveCanvasTemplateRegistryPaths({
        root: dirname(project.data.path),
        registries: project.data.config.templateRegistries,
        cacheDir: this.options.cacheDir,
      });

      if (resolved.success && resolved.data) {
        paths.push(...resolved.data);
      }
    }

    if (this.options.registries && this.options.registries.length > 0) {
      const resolved = resolveCanvasTemplateRegistryPaths({
        root: appRoot,
        registries: this.options.registries,
        cacheDir: this.options.cacheDir,
      });

      if (resolved.success && resolved.data) {
        paths.push(...resolved.data);
      }
    }

    return Array.from(new Set(paths.map((path) => resolve(path))));
  }

  private findFormulaBindingAtPosition(analysis: AnalysisContext, relativeFile: string, position: LspPosition): FormulaBindingHit | undefined {
    for (const formula of analysis.semanticModel.formulas) {
      if (formula.sourceSpan?.file !== relativeFile) {
        continue;
      }

      const expressionOffset = formula.raw.indexOf(formula.expression);

      if (expressionOffset < 0 || !formula.sourceSpan) {
        continue;
      }

      for (const binding of formula.bindings) {
        const range = spanFromFormulaBinding(formula.sourceSpan, formula.raw, expressionOffset, binding.span.start, binding.span.end);

        if (rangeContains(range, position)) {
          return {
            formula,
            binding,
            range,
          };
        }
      }
    }

    return undefined;
  }

  private findControlContextAtPosition(analysis: AnalysisContext, relativeFile: string, position: LspPosition): ControlContext | undefined {
    const controls = analysis.semanticModel.controls
      .filter((control) => control.source?.file === relativeFile && control.source.span)
      .sort((left, right) => (right.source!.span!.start.offset - left.source!.span!.start.offset) || (left.source!.span!.end.offset - right.source!.span!.end.offset));

    for (const control of controls) {
      const source = control.source;

      if (!source?.span || !rangeContains(toLspRange(source.span), position)) {
        continue;
      }

      const context: ControlContext = {
        control,
        controlNameRange: source.nameSpan ? toLspRange(source.nameSpan) : undefined,
        controlTypeRange: source.controlTypeSpan ? toLspRange(source.controlTypeSpan) : undefined,
      };

      for (const propertyName of Object.keys(source.propertyNameSpans ?? {})) {
        const range = toLspRange(source.propertyNameSpans![propertyName]!);

        if (rangeContains(range, position)) {
          context.propertyName = propertyName;
          context.propertyNameRange = range;
          return context;
        }
      }

      for (const propertyName of Object.keys(source.propertySpans ?? {})) {
        const range = toLspRange(source.propertySpans![propertyName]!);

        if (rangeContains(range, position)) {
          context.propertyName = propertyName;
          context.propertyValueRange = range;
          return context;
        }
      }

      return context;
    }

    return undefined;
  }

  private createError(code: number, message: string): JsonRpcError {
    return {
      code,
      message,
    };
  }
}

export function isJsonRpcError(value: unknown): value is JsonRpcError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

async function findCanvasAppRoot(filePath: string): Promise<string | undefined> {
  let current = resolve(filePath);
  const fileStats = await safeStat(current);

  if (fileStats?.isFile()) {
    current = dirname(current);
  }

  while (true) {
    if (await exists(join(current, 'Src', 'App.pa.yaml'))) {
      return current;
    }

    if (await exists(join(current, 'canvas.json'))) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

function matchesDocumentDiagnostic(appRoot: string, filePath: string, diagnostic: CanvasLintDiagnostic): boolean {
  if (!diagnostic.location?.file) {
    return false;
  }

  return resolve(appRoot, diagnostic.location.file) === resolve(filePath);
}

function toLspDiagnostic(diagnostic: CanvasLintDiagnostic, documentText: string | undefined): LspDiagnostic {
  return {
    range: diagnostic.location ? toLspRange(diagnostic.location) : zeroRange(documentText),
    severity: diagnostic.severity === 'error' ? 1 : diagnostic.severity === 'warning' ? 2 : 3,
    code: diagnostic.code,
    source: diagnostic.source,
    message: diagnostic.message,
    data: {
      controlPath: diagnostic.controlPath,
      property: diagnostic.property,
      metadataBacked: diagnostic.metadataBacked,
      unsupported: diagnostic.unsupported,
    },
  };
}

function zeroRange(documentText: string | undefined): LspRange {
  if (!documentText || documentText.length === 0) {
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    };
  }

  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };
}

function buildBindingHover(hit: FormulaBindingHit): string {
  const lines = [
    `**${hit.binding.name}**`,
    `Kind: ${hit.binding.kind}`,
    `Formula: \`${hit.formula.controlPath}.${hit.formula.property}\``,
  ];

  if (hit.binding.metadataBacked) {
    lines.push('Backed by canvas metadata.');
  }

  if (!hit.binding.resolved) {
    lines.push('This reference is currently unresolved.');
  }

  return lines.join('\n\n');
}

function findDotPrefix(text: string, position: LspPosition): string | undefined {
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return undefined;

  const before = line.slice(0, position.character);
  let i = before.length - 1;

  // Skip any identifier chars typed after the dot (partial member name)
  while (i >= 0 && /[a-zA-Z0-9_]/.test(before[i])) {
    i--;
  }

  if (i < 0 || before[i] !== '.') {
    return undefined;
  }

  // Extract identifier before the dot
  i--;
  const end = i + 1;
  while (i >= 0 && /[a-zA-Z0-9_]/.test(before[i])) {
    i--;
  }

  const prefix = before.slice(i + 1, end);
  return prefix || undefined;
}

function resolveDotCompletions(prefix: string, analysis: AnalysisContext): LspCompletionItem[] {
  const lowerPrefix = prefix.toLowerCase();

  // 1. Controls
  const control = analysis.semanticModel.controls.find((c) => c.name.toLowerCase() === lowerPrefix);
  if (control?.templateSurface) {
    return control.templateSurface.allowedProperties.map((prop) => ({
      label: prop,
      kind: 10, // Property
      detail: control.templateSurface!.propertyCategories[prop],
    }));
  }

  // 2. Data sources
  const dataSources = analysis.source.dataSources ?? [];
  const dataSource = dataSources.find((ds) => ds.name.toLowerCase() === lowerPrefix);
  if (dataSource?.metadata) {
    const items: LspCompletionItem[] = [];
    for (const column of dataSource.metadata.columns) {
      items.push({
        label: column.name,
        kind: 5, // Field
        detail: column.type,
      });
    }
    for (const relationship of dataSource.metadata.relationships) {
      items.push({
        label: relationship.name,
        kind: 18, // Reference
        detail: relationship.target ? `→ ${relationship.target}` : undefined,
      });
    }
    return items;
  }

  // 3. Option sets
  const metadataCatalog = analysis.source.metadataCatalog;
  if (metadataCatalog) {
    const optionSet = metadataCatalog.optionSets.find((os) => os.name.toLowerCase() === lowerPrefix);
    if (optionSet) {
      return optionSet.values.map((v) => ({
        label: v.name,
        kind: 20, // EnumMember
        detail: v.value !== undefined ? String(v.value) : undefined,
      }));
    }
  }

  // 4. Built-in enums
  const enumKey = Object.keys(BUILTIN_ENUM_MEMBERS).find((k) => k.toLowerCase() === lowerPrefix);
  if (enumKey) {
    return BUILTIN_ENUM_MEMBERS[enumKey].map((member) => ({
      label: member,
      kind: 20, // EnumMember
    }));
  }

  return [];
}

const BUILTIN_ENUM_MEMBERS: Record<string, string[]> = {
  Align: ['Center', 'Justify', 'Left', 'Right'],
  BorderStyle: ['Dashed', 'Dotted', 'None', 'Solid'],
  Color: [
    'AliceBlue', 'AntiqueWhite', 'Aqua', 'Aquamarine', 'Azure',
    'Beige', 'Bisque', 'Black', 'BlanchedAlmond', 'Blue', 'BlueViolet', 'Brown', 'BurlyWood',
    'CadetBlue', 'Chartreuse', 'Chocolate', 'Coral', 'CornflowerBlue', 'Cornsilk', 'Crimson', 'Cyan',
    'DarkBlue', 'DarkCyan', 'DarkGoldenRod', 'DarkGray', 'DarkGreen', 'DarkKhaki', 'DarkMagenta',
    'DarkOliveGreen', 'DarkOrange', 'DarkOrchid', 'DarkRed', 'DarkSalmon', 'DarkSeaGreen',
    'DarkSlateBlue', 'DarkSlateGray', 'DarkTurquoise', 'DarkViolet',
    'DeepPink', 'DeepSkyBlue', 'DimGray', 'DodgerBlue',
    'FireBrick', 'FloralWhite', 'ForestGreen', 'Fuchsia',
    'Gainsboro', 'GhostWhite', 'Gold', 'GoldenRod', 'Gray', 'Green', 'GreenYellow',
    'HoneyDew', 'HotPink',
    'IndianRed', 'Indigo', 'Ivory',
    'Khaki',
    'Lavender', 'LavenderBlush', 'LawnGreen', 'LemonChiffon', 'LightBlue', 'LightCoral', 'LightCyan',
    'LightGoldenRodYellow', 'LightGray', 'LightGreen', 'LightPink', 'LightSalmon', 'LightSeaGreen',
    'LightSkyBlue', 'LightSlateGray', 'LightSteelBlue', 'LightYellow',
    'Lime', 'LimeGreen', 'Linen',
    'Magenta', 'Maroon', 'MediumAquaMarine', 'MediumBlue', 'MediumOrchid', 'MediumPurple',
    'MediumSeaGreen', 'MediumSlateBlue', 'MediumSpringGreen', 'MediumTurquoise', 'MediumVioletRed',
    'MidnightBlue', 'MintCream', 'MistyRose', 'Moccasin',
    'NavajoWhite', 'Navy',
    'OldLace', 'Olive', 'OliveDrab', 'Orange', 'OrangeRed', 'Orchid',
    'PaleGoldenRod', 'PaleGreen', 'PaleTurquoise', 'PaleVioletRed', 'PapayaWhip', 'PeachPuff',
    'Peru', 'Pink', 'Plum', 'PowderBlue', 'Purple',
    'Red', 'RosyBrown', 'RoyalBlue',
    'SaddleBrown', 'Salmon', 'SandyBrown', 'SeaGreen', 'SeaShell', 'Sienna', 'Silver', 'SkyBlue',
    'SlateBlue', 'SlateGray', 'Snow', 'SpringGreen', 'SteelBlue',
    'Tan', 'Teal', 'Thistle', 'Tomato', 'Transparent', 'Turquoise',
    'Violet',
    'Wheat', 'White', 'WhiteSmoke',
    'Yellow', 'YellowGreen',
  ],
  DisplayMode: ['Disabled', 'Edit', 'View'],
  Font: ['Arial', 'Courier New', 'Georgia', 'Segoe UI', 'Verdana'],
  FontWeight: ['Bold', 'Lighter', 'Normal', 'Semibold'],
  Icon: [
    'Add', 'Back', 'Cancel', 'Check', 'ChevronDown', 'ChevronLeft', 'ChevronRight', 'ChevronUp',
    'Edit', 'Emoji', 'Filter', 'HamburgerMenu', 'Help', 'Home', 'Information', 'Mail',
    'Message', 'People', 'Phone', 'Search', 'Settings', 'Trash',
  ],
  Layout: ['Horizontal', 'Vertical'],
  Overflow: ['Hidden', 'Scroll'],
  ScreenTransition: ['Cover', 'CoverRight', 'Fade', 'None', 'UnCover', 'UnCoverRight'],
  VerticalAlign: ['Bottom', 'Middle', 'Top'],
};

function completionKindForSymbol(kind: CanvasSemanticModel['symbols'][number]['kind']): number {
  switch (kind) {
    case 'function':
      return 3;
    case 'control':
    case 'screen':
      return 6;
    case 'dataSource':
    case 'entity':
    case 'optionSet':
      return 6;
    case 'column':
    case 'relationship':
    case 'optionValue':
      return 10;
    case 'variable':
      return 6;
    default:
      return 1;
  }
}

function spanFromFormulaBinding(sourceSpan: CanvasSourceSpan, raw: string, expressionOffset: number, start: number, end: number): LspRange {
  return {
    start: advancePosition(
      {
        line: sourceSpan.start.line - 1,
        character: sourceSpan.start.column - 1,
      },
      raw.slice(0, expressionOffset + start)
    ),
    end: advancePosition(
      {
        line: sourceSpan.start.line - 1,
        character: sourceSpan.start.column - 1,
      },
      raw.slice(0, expressionOffset + end)
    ),
  };
}

function advancePosition(start: LspPosition, text: string): LspPosition {
  let line = start.line;
  let character = start.character;

  for (const char of text) {
    if (char === '\n') {
      line += 1;
      character = 0;
      continue;
    }

    character += 1;
  }

  return { line, character };
}

function toLspRange(span: CanvasSourceSpan): LspRange {
  return {
    start: {
      line: span.start.line - 1,
      character: span.start.column - 1,
    },
    end: {
      line: span.end.line - 1,
      character: span.end.column - 1,
    },
  };
}

function rangeContains(range: LspRange, position: LspPosition): boolean {
  const startsBefore = position.line > range.start.line || (position.line === range.start.line && position.character >= range.start.character);
  const endsAfter = position.line < range.end.line || (position.line === range.end.line && position.character <= range.end.character);
  return startsBefore && endsAfter;
}

function uriToPath(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

async function exists(path: string): Promise<boolean> {
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
