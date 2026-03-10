import { buildCanvasTemplateSurface, type CanvasTemplateSurface } from './template-surface';
import type {
  CanvasControlDefinition,
  CanvasEntityMetadata,
  CanvasMetadataCatalog,
  CanvasNodeSourceInfo,
  CanvasOptionSetMetadata,
  CanvasSourceModel,
  CanvasSourceSpan,
  CanvasTemplateRecord,
  CanvasTemplateRequirementResolution,
} from './index';

export type CanvasSemanticSymbolKind =
  | 'screen'
  | 'control'
  | 'dataSource'
  | 'entity'
  | 'column'
  | 'relationship'
  | 'optionSet'
  | 'optionValue'
  | 'variable'
  | 'function'
  | 'special'
  | 'unresolved';

export type PowerFxAstNode =
  | PowerFxIdentifierNode
  | PowerFxStringLiteralNode
  | PowerFxNumberLiteralNode
  | PowerFxBooleanLiteralNode
  | PowerFxCallNode
  | PowerFxMemberNode
  | PowerFxRecordNode
  | PowerFxBinaryNode
  | PowerFxUnaryNode
  | PowerFxUnsupportedNode;

export interface PowerFxSpan {
  start: number;
  end: number;
}

interface PowerFxBaseNode {
  kind: string;
  span: PowerFxSpan;
}

export interface PowerFxIdentifierNode extends PowerFxBaseNode {
  kind: 'Identifier';
  name: string;
  quoted: boolean;
}

export interface PowerFxStringLiteralNode extends PowerFxBaseNode {
  kind: 'StringLiteral';
  value: string;
}

export interface PowerFxNumberLiteralNode extends PowerFxBaseNode {
  kind: 'NumberLiteral';
  value: number;
}

export interface PowerFxBooleanLiteralNode extends PowerFxBaseNode {
  kind: 'BooleanLiteral';
  value: boolean;
}

export interface PowerFxCallNode extends PowerFxBaseNode {
  kind: 'CallExpression';
  callee: PowerFxAstNode;
  arguments: PowerFxAstNode[];
}

export interface PowerFxMemberNode extends PowerFxBaseNode {
  kind: 'MemberExpression';
  object: PowerFxAstNode;
  property: PowerFxIdentifierNode;
}

export interface PowerFxRecordField {
  name: PowerFxIdentifierNode;
  value: PowerFxAstNode;
}

export interface PowerFxRecordNode extends PowerFxBaseNode {
  kind: 'RecordExpression';
  fields: PowerFxRecordField[];
}

export interface PowerFxBinaryNode extends PowerFxBaseNode {
  kind: 'BinaryExpression';
  operator: '=';
  left: PowerFxAstNode;
  right: PowerFxAstNode;
}

export interface PowerFxUnaryNode extends PowerFxBaseNode {
  kind: 'UnaryExpression';
  operator: '+' | '-';
  argument: PowerFxAstNode;
}

export interface PowerFxUnsupportedNode extends PowerFxBaseNode {
  kind: 'UnsupportedExpression';
  reason: string;
}

export interface CanvasFormulaBinding {
  kind: CanvasSemanticSymbolKind;
  name: string;
  resolved: boolean;
  metadataBacked: boolean;
  targetId?: string;
  span: PowerFxSpan;
}

export interface CanvasFormulaSemantic {
  id: string;
  controlId: string;
  controlPath: string;
  property: string;
  raw: string;
  expression: string;
  sourceSpan?: CanvasSourceSpan;
  valid: boolean;
  ast?: PowerFxAstNode;
  bindings: CanvasFormulaBinding[];
  unsupportedReason?: string;
}

export interface CanvasSemanticControl {
  id: string;
  path: string;
  name: string;
  screen: string;
  templateName: string;
  templateVersion: string;
  properties: Record<string, unknown>;
  source?: CanvasNodeSourceInfo;
  parentId?: string;
  childIds: string[];
  propertyNames: string[];
  templateSurface?: CanvasTemplateSurface;
}

export interface CanvasSemanticSymbol {
  id: string;
  kind: CanvasSemanticSymbolKind;
  name: string;
  qualifiedName: string;
}

export interface CanvasSemanticModel {
  source: CanvasSourceModel;
  controls: CanvasSemanticControl[];
  formulas: CanvasFormulaSemantic[];
  symbols: CanvasSemanticSymbol[];
}

export interface BuildCanvasSemanticModelOptions {
  templateResolutions?: CanvasTemplateRequirementResolution['resolutions'];
  templates?: CanvasTemplateRecord[];
}

interface Token {
  kind: 'identifier' | 'string' | 'number' | 'punctuation' | 'operator' | 'eof';
  value: string;
  start: number;
  end: number;
  quoted?: boolean;
}

interface ParseResult {
  ast?: PowerFxAstNode;
  valid: boolean;
  unsupportedReason?: string;
}

export function buildCanvasSemanticModel(source: CanvasSourceModel, options: BuildCanvasSemanticModelOptions = {}): CanvasSemanticModel {
  const templateMap = buildTemplateMap(options);
  const controls: CanvasSemanticControl[] = [];
  const symbols = new Map<string, CanvasSemanticSymbol>();
  const controlById = new Map<string, CanvasSemanticControl>();
  const controlByPath = new Map<string, CanvasSemanticControl>();
  const controlNameToIds = new Map<string, string[]>();
  const dataSourceSymbols = buildDataSourceSymbols(source, symbols);
  const metadataCatalog = source.metadataCatalog;

  for (const screen of source.screens) {
    const screenId = `screen:${screen.name}`;
    symbols.set(screenId, {
      id: screenId,
      kind: 'screen',
      name: screen.name,
      qualifiedName: screen.name,
    });
    appendControlSemantics(screen.name, screen.controls, undefined, controls, controlById, controlByPath, controlNameToIds, templateMap);
  }

  for (const control of controls) {
    symbols.set(control.id, {
      id: control.id,
      kind: 'control',
      name: control.name,
      qualifiedName: control.path,
    });
  }

  const formulas = controls.flatMap((control) => buildFormulaSemantics(control, controlById, controlNameToIds, dataSourceSymbols, metadataCatalog));

  for (const formula of formulas) {
    for (const binding of formula.bindings) {
      const symbolId = binding.targetId ?? `synthetic:${binding.kind}:${binding.name.toLowerCase()}`;
      if (!symbols.has(symbolId)) {
        symbols.set(symbolId, {
          id: symbolId,
          kind: binding.kind,
          name: binding.name,
          qualifiedName: binding.name,
        });
      }
    }
  }

  return {
    source,
    controls,
    formulas: formulas.sort((left, right) => left.controlPath.localeCompare(right.controlPath) || left.property.localeCompare(right.property)),
    symbols: Array.from(symbols.values()).sort((left, right) => left.kind.localeCompare(right.kind) || left.qualifiedName.localeCompare(right.qualifiedName)),
  };
}

export function collectCanvasFormulaChecks(model: CanvasSemanticModel): Array<{
  controlPath: string;
  property: string;
  valid: boolean;
}> {
  return model.formulas.map((formula) => ({
    controlPath: formula.controlPath,
    property: formula.property,
    valid: formula.valid,
  }));
}

export function findCanvasSemanticControl(model: CanvasSemanticModel, path: string): CanvasSemanticControl | undefined {
  return model.controls.find((control) => control.path === path);
}

function appendControlSemantics(
  screenName: string,
  controls: CanvasControlDefinition[],
  parentId: string | undefined,
  destination: CanvasSemanticControl[],
  controlById: Map<string, CanvasSemanticControl>,
  controlByPath: Map<string, CanvasSemanticControl>,
  controlNameToIds: Map<string, string[]>,
  templateMap: Map<string, CanvasTemplateSurface>
): void {
  for (const control of controls) {
    const path = parentId ? `${controlById.get(parentId)?.path ?? screenName}/${control.name}` : `${screenName}/${control.name}`;
    const id = `control:${path}`;
    const semanticControl: CanvasSemanticControl = {
      id,
      path,
      name: control.name,
      screen: screenName,
      templateName: control.templateName,
      templateVersion: control.templateVersion,
      properties: control.properties,
      source: control.source,
      parentId,
      childIds: [],
      propertyNames: Object.keys(control.properties).sort((left, right) => left.localeCompare(right)),
      templateSurface: templateMap.get(makeTemplateKey(control.templateName, control.templateVersion)),
    };

    destination.push(semanticControl);
    controlById.set(id, semanticControl);
    controlByPath.set(path, semanticControl);
    const ids = controlNameToIds.get(control.name) ?? [];
    ids.push(id);
    controlNameToIds.set(control.name, ids);

    const beforeChildren = destination.length;
    appendControlSemantics(screenName, control.children, id, destination, controlById, controlByPath, controlNameToIds, templateMap);
    semanticControl.childIds = destination.slice(beforeChildren).filter((child) => child.parentId === id).map((child) => child.id);
  }
}

function buildFormulaSemantics(
  control: CanvasSemanticControl,
  controlById: Map<string, CanvasSemanticControl>,
  controlNameToIds: Map<string, string[]>,
  dataSourceSymbols: ReturnType<typeof buildDataSourceSymbols>,
  metadataCatalog: CanvasMetadataCatalog | undefined
): CanvasFormulaSemantic[] {
  const sourceControl = control.source;
  const formulas: CanvasFormulaSemantic[] = [];

  for (const [property, value] of Object.entries(control.properties)) {
    if (typeof value !== 'string') {
      if (property.endsWith('Formula')) {
        formulas.push({
          id: `${control.id}:formula:${property}`,
          controlId: control.id,
          controlPath: control.path,
          property,
          raw: String(value),
          expression: '',
          valid: false,
          bindings: [],
          sourceSpan: sourceControl?.propertySpans?.[property],
          unsupportedReason: 'Formula properties must be strings.',
        });
      }
      continue;
    }

    const isFormula = property.endsWith('Formula') || value.trim().startsWith('=');

    if (!isFormula) {
      continue;
    }

    const expression = value.trim().startsWith('=') ? value.trim().slice(1) : value;
    const parsed = parsePowerFxExpression(expression);
    const bindings = parsed.ast
      ? analyzeBindings(parsed.ast, control, controlById, controlNameToIds, dataSourceSymbols, metadataCatalog)
      : [];

    formulas.push({
      id: `${control.id}:formula:${property}`,
      controlId: control.id,
      controlPath: control.path,
      property,
      raw: value,
      expression,
      sourceSpan: sourceControl?.propertySpans?.[property],
      valid: parsed.valid,
      ast: parsed.ast,
      bindings,
      unsupportedReason: parsed.unsupportedReason,
    });
  }

  return formulas;
}

function analyzeBindings(
  node: PowerFxAstNode,
  control: CanvasSemanticControl,
  controlById: Map<string, CanvasSemanticControl>,
  controlNameToIds: Map<string, string[]>,
  dataSourceSymbols: ReturnType<typeof buildDataSourceSymbols>,
  metadataCatalog: CanvasMetadataCatalog | undefined
): CanvasFormulaBinding[] {
  const bindings: CanvasFormulaBinding[] = [];
  const seen = new Set<string>();

  visit(node, (current, parent) => {
    if (current.kind === 'CallExpression' && current.callee.kind === 'Identifier') {
      const key = `function:${current.callee.name}:${current.callee.span.start}`;
      if (!seen.has(key)) {
        seen.add(key);
        bindings.push({
          kind: 'function',
          name: current.callee.name,
          resolved: true,
          metadataBacked: false,
          span: current.callee.span,
          targetId: `synthetic:function:${current.callee.name.toLowerCase()}`,
        });
      }
      return;
    }

    if (current.kind === 'Identifier') {
      if (parent?.kind === 'MemberExpression' && parent.property === current) {
        return;
      }
      if (parent?.kind === 'CallExpression' && parent.callee === current) {
        return;
      }

      const binding = resolveIdentifierBinding(current, control, controlNameToIds, dataSourceSymbols, metadataCatalog);
      const key = `${binding.kind}:${binding.name}:${binding.span.start}`;
      if (!seen.has(key)) {
        seen.add(key);
        bindings.push(binding);
      }
      return;
    }

    if (current.kind === 'MemberExpression') {
      const binding = resolveMemberBinding(current, dataSourceSymbols, metadataCatalog);
      if (binding) {
        const key = `${binding.kind}:${binding.name}:${binding.span.start}`;
        if (!seen.has(key)) {
          seen.add(key);
          bindings.push(binding);
        }
      }
    }
  });

  return bindings;
}

function resolveIdentifierBinding(
  node: PowerFxIdentifierNode,
  control: CanvasSemanticControl,
  controlNameToIds: Map<string, string[]>,
  dataSourceSymbols: ReturnType<typeof buildDataSourceSymbols>,
  metadataCatalog: CanvasMetadataCatalog | undefined
): CanvasFormulaBinding {
  const specialNames = new Set(['App', 'Parent', 'Self', 'ThisItem']);

  if (specialNames.has(node.name)) {
    return {
      kind: 'special',
      name: node.name,
      resolved: true,
      metadataBacked: false,
      span: node.span,
      targetId: `synthetic:special:${node.name.toLowerCase()}`,
    };
  }

  const dataSource = dataSourceSymbols.byName.get(node.name.toLowerCase());
  if (dataSource) {
    return {
      kind: 'dataSource',
      name: dataSource.name,
      resolved: true,
      metadataBacked: Boolean(dataSource.metadata),
      span: node.span,
      targetId: dataSource.id,
    };
  }

  const controlIds = controlNameToIds.get(node.name) ?? [];
  if (controlIds.length === 1) {
    return {
      kind: 'control',
      name: node.name,
      resolved: true,
      metadataBacked: false,
      span: node.span,
      targetId: controlIds[0],
    };
  }

  if (/^(var|loc|gbl)/i.test(node.name)) {
    return {
      kind: 'variable',
      name: node.name,
      resolved: true,
      metadataBacked: false,
      span: node.span,
      targetId: `synthetic:variable:${node.name.toLowerCase()}`,
    };
  }

  const optionSet = metadataCatalog?.optionSets.find((item) => normalizeName(item.name) === normalizeName(node.name));
  if (optionSet) {
    return {
      kind: 'optionSet',
      name: optionSet.name,
      resolved: true,
      metadataBacked: true,
      span: node.span,
      targetId: `option-set:${normalizeName(optionSet.name)}`,
    };
  }

  return {
    kind: 'unresolved',
    name: node.name,
    resolved: false,
    metadataBacked: false,
    span: node.span,
  };
}

function resolveMemberBinding(
  node: PowerFxMemberNode,
  dataSourceSymbols: ReturnType<typeof buildDataSourceSymbols>,
  metadataCatalog: CanvasMetadataCatalog | undefined
): CanvasFormulaBinding | undefined {
  if (node.object.kind !== 'Identifier') {
    return undefined;
  }

  const dataSource = dataSourceSymbols.byName.get(node.object.name.toLowerCase());
  if (dataSource?.metadata) {
    const column = dataSource.metadata.columns.find((item) => normalizeName(item.name) === normalizeName(node.property.name));
    if (column) {
      return {
        kind: 'column',
        name: column.name,
        resolved: true,
        metadataBacked: true,
        span: node.property.span,
        targetId: `${dataSource.id}:column:${normalizeName(column.name)}`,
      };
    }

    const relationship = dataSource.metadata.relationships.find((item) => normalizeName(item.name) === normalizeName(node.property.name));
    if (relationship) {
      return {
        kind: 'relationship',
        name: relationship.name,
        resolved: true,
        metadataBacked: true,
        span: node.property.span,
        targetId: `${dataSource.id}:relationship:${normalizeName(relationship.name)}`,
      };
    }

    return {
      kind: 'unresolved',
      name: `${dataSource.name}.${node.property.name}`,
      resolved: false,
      metadataBacked: true,
      span: node.property.span,
    };
  }

  if (node.object.kind !== 'Identifier') {
    return undefined;
  }

  const optionSet = metadataCatalog?.optionSets.find((item) => normalizeName(item.name) === normalizeName(node.object.name));
  if (optionSet) {
    const optionValue = optionSet.values.find((item) => normalizeName(item.name) === normalizeName(node.property.name));
    return {
      kind: optionValue ? 'optionValue' : 'unresolved',
      name: node.property.name,
      resolved: Boolean(optionValue),
      metadataBacked: true,
      span: node.property.span,
      targetId: optionValue ? `option-set:${normalizeName(optionSet.name)}:value:${normalizeName(optionValue.name)}` : undefined,
    };
  }

  return undefined;
}

function buildTemplateMap(options: BuildCanvasSemanticModelOptions): Map<string, CanvasTemplateSurface> {
  const map = new Map<string, CanvasTemplateSurface>();
  const templates = options.templates ?? options.templateResolutions?.flatMap((resolution) => (resolution.template ? [resolution.template] : [])) ?? [];

  for (const template of templates) {
    map.set(makeTemplateKey(template.templateName, template.templateVersion), buildCanvasTemplateSurface(template));
  }

  return map;
}

function buildDataSourceSymbols(source: CanvasSourceModel, symbols: Map<string, CanvasSemanticSymbol>) {
  const byName = new Map<string, { id: string; name: string; metadata?: CanvasEntityMetadata }>();

  for (const dataSource of source.dataSources ?? []) {
    const id = `data-source:${normalizeName(dataSource.name)}`;
    byName.set(dataSource.name.toLowerCase(), {
      id,
      name: dataSource.name,
      metadata: dataSource.metadata,
    });
    symbols.set(id, {
      id,
      kind: 'dataSource',
      name: dataSource.name,
      qualifiedName: dataSource.name,
    });
  }

  return { byName };
}

function parsePowerFxExpression(expression: string): ParseResult {
  try {
    const parser = new PowerFxParser(expression);
    const ast = parser.parseExpression();
    parser.expect('eof');
    return { ast, valid: ast.kind !== 'UnsupportedExpression', unsupportedReason: ast.kind === 'UnsupportedExpression' ? ast.reason : undefined };
  } catch (error) {
    return {
      valid: false,
      unsupportedReason: error instanceof Error ? error.message : String(error),
    };
  }
}

class PowerFxParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(private readonly source: string) {
    this.tokens = tokenizePowerFx(source);
  }

  parseExpression(): PowerFxAstNode {
    return this.parseEquality();
  }

  expect(kind: Token['kind'], value?: string): Token {
    const token = this.peek();
    if (token.kind !== kind || (value !== undefined && token.value !== value)) {
      throw new Error(`Unexpected token ${token.value || token.kind}.`);
    }
    this.index += 1;
    return token;
  }

  private parseEquality(): PowerFxAstNode {
    let node = this.parseUnary();

    while (this.match('operator', '=')) {
      const operator = this.previous();
      const right = this.parseUnary();
      node = {
        kind: 'BinaryExpression',
        operator: '=',
        left: node,
        right,
        span: {
          start: node.span.start,
          end: right.span.end,
        },
      };
      void operator;
    }

    return node;
  }

  private parseUnary(): PowerFxAstNode {
    if (this.match('operator', '+') || this.match('operator', '-')) {
      const operator = this.previous();
      const argument = this.parseUnary();
      return {
        kind: 'UnaryExpression',
        operator: operator.value as '+' | '-',
        argument,
        span: {
          start: operator.start,
          end: argument.span.end,
        },
      };
    }

    return this.parsePostfix();
  }

  private parsePostfix(): PowerFxAstNode {
    let node = this.parsePrimary();

    while (true) {
      if (this.match('punctuation', '.')) {
        const property = this.expectIdentifier();
        node = {
          kind: 'MemberExpression',
          object: node,
          property,
          span: {
            start: node.span.start,
            end: property.span.end,
          },
        };
        continue;
      }

      if (this.match('punctuation', '(')) {
        const open = this.previous();
        const args: PowerFxAstNode[] = [];

        if (!this.check('punctuation', ')')) {
          do {
            args.push(this.parseExpression());
          } while (this.match('punctuation', ','));
        }

        const close = this.expect('punctuation', ')');
        node = {
          kind: 'CallExpression',
          callee: node,
          arguments: args,
          span: {
            start: node.span.start,
            end: close.end,
          },
        };
        void open;
        continue;
      }

      break;
    }

    return node;
  }

  private parsePrimary(): PowerFxAstNode {
    const token = this.peek();

    if (this.match('identifier')) {
      return {
        kind: 'Identifier',
        name: token.value,
        quoted: Boolean(token.quoted),
        span: { start: token.start, end: token.end },
      };
    }

    if (this.match('string')) {
      return {
        kind: 'StringLiteral',
        value: token.value,
        span: { start: token.start, end: token.end },
      };
    }

    if (this.match('number')) {
      return {
        kind: 'NumberLiteral',
        value: Number(token.value),
        span: { start: token.start, end: token.end },
      };
    }

    if (token.kind === 'identifier' && /^(true|false)$/i.test(token.value)) {
      this.index += 1;
      return {
        kind: 'BooleanLiteral',
        value: token.value.toLowerCase() === 'true',
        span: { start: token.start, end: token.end },
      };
    }

    if (this.match('punctuation', '{')) {
      const start = token.start;
      const fields: PowerFxRecordField[] = [];

      if (!this.check('punctuation', '}')) {
        do {
          const name = this.expectIdentifier();
          this.expect('punctuation', ':');
          const value = this.parseExpression();
          fields.push({ name, value });
        } while (this.match('punctuation', ','));
      }

      const close = this.expect('punctuation', '}');
      return {
        kind: 'RecordExpression',
        fields,
        span: {
          start,
          end: close.end,
        },
      };
    }

    if (this.match('punctuation', '(')) {
      const inner = this.parseExpression();
      this.expect('punctuation', ')');
      return inner;
    }

    throw new Error(`Unsupported Power Fx token ${token.value || token.kind}.`);
  }

  private expectIdentifier(): PowerFxIdentifierNode {
    const token = this.peek();
    if (token.kind !== 'identifier') {
      throw new Error(`Expected identifier but found ${token.value || token.kind}.`);
    }
    this.index += 1;
    return {
      kind: 'Identifier',
      name: token.value,
      quoted: Boolean(token.quoted),
      span: { start: token.start, end: token.end },
    };
  }

  private match(kind: Token['kind'], value?: string): boolean {
    if (!this.check(kind, value)) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private check(kind: Token['kind'], value?: string): boolean {
    const token = this.peek();
    return token.kind === kind && (value === undefined || token.value === value);
  }

  private peek(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[this.index - 1]!;
  }
}

function tokenizePowerFx(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '\'') {
      let cursor = index + 1;
      let value = '';
      while (cursor < source.length) {
        const current = source[cursor]!;
        const next = source[cursor + 1];
        if (current === '\'' && next === '\'') {
          value += '\'';
          cursor += 2;
          continue;
        }
        if (current === '\'') {
          cursor += 1;
          break;
        }
        value += current;
        cursor += 1;
      }
      tokens.push({ kind: 'identifier', value, start: index, end: cursor, quoted: true });
      index = cursor;
      continue;
    }

    if (char === '"') {
      let cursor = index + 1;
      let value = '';
      while (cursor < source.length) {
        const current = source[cursor]!;
        const next = source[cursor + 1];
        if (current === '"' && next === '"') {
          value += '"';
          cursor += 2;
          continue;
        }
        if (current === '"') {
          cursor += 1;
          break;
        }
        value += current;
        cursor += 1;
      }
      tokens.push({ kind: 'string', value, start: index, end: cursor });
      index = cursor;
      continue;
    }

    if (/[0-9]/.test(char)) {
      let cursor = index + 1;
      while (cursor < source.length && /[0-9.]/.test(source[cursor]!)) {
        cursor += 1;
      }
      tokens.push({ kind: 'number', value: source.slice(index, cursor), start: index, end: cursor });
      index = cursor;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let cursor = index + 1;
      while (cursor < source.length && /[A-Za-z0-9_]/.test(source[cursor]!)) {
        cursor += 1;
      }
      tokens.push({ kind: 'identifier', value: source.slice(index, cursor), start: index, end: cursor });
      index = cursor;
      continue;
    }

    if ('(),{}.:'.includes(char)) {
      tokens.push({ kind: 'punctuation', value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if ('=+-'.includes(char)) {
      tokens.push({ kind: 'operator', value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    throw new Error(`Unsupported Power Fx character ${char}.`);
  }

  tokens.push({ kind: 'eof', value: '', start: source.length, end: source.length });
  return tokens;
}

function visit(node: PowerFxAstNode, visitor: (node: PowerFxAstNode, parent?: PowerFxAstNode) => void, parent?: PowerFxAstNode): void {
  visitor(node, parent);

  switch (node.kind) {
    case 'CallExpression':
      visit(node.callee, visitor, node);
      node.arguments.forEach((argument) => visit(argument, visitor, node));
      break;
    case 'MemberExpression':
      visit(node.object, visitor, node);
      visit(node.property, visitor, node);
      break;
    case 'RecordExpression':
      node.fields.forEach((field) => {
        visit(field.name, visitor, node);
        visit(field.value, visitor, node);
      });
      break;
    case 'BinaryExpression':
      visit(node.left, visitor, node);
      visit(node.right, visitor, node);
      break;
    case 'UnaryExpression':
      visit(node.argument, visitor, node);
      break;
    default:
      break;
  }
}

function makeTemplateKey(templateName: string, templateVersion: string): string {
  return `${normalizeName(templateName)}@${templateVersion}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
