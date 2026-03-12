import { buildCanvasTemplateSurface, type CanvasTemplateSurface } from './template-surface';
import { parsePowerFxExpression, visitPowerFxAst } from './power-fx';
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
} from './canvas-types';

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
  | PowerFxChainNode
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
  operator: 'Or' | 'And' | '&' | '+' | '*' | '/' | '^' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'in' | 'exactin';
  left: PowerFxAstNode;
  right: PowerFxAstNode;
}

export interface PowerFxUnaryNode extends PowerFxBaseNode {
  kind: 'UnaryExpression';
  operator: '+' | '-' | '!' | '%';
  argument: PowerFxAstNode;
}

export interface PowerFxChainNode extends PowerFxBaseNode {
  kind: 'ChainExpression';
  expressions: PowerFxAstNode[];
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

export async function buildCanvasSemanticModel(
  source: CanvasSourceModel,
  options: BuildCanvasSemanticModelOptions = {}
): Promise<CanvasSemanticModel> {
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

  const formulas = (
    await Promise.all(
      controls.map((control) => buildFormulaSemantics(control, controlById, controlNameToIds, dataSourceSymbols, metadataCatalog))
    )
  ).flat();

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

async function buildFormulaSemantics(
  control: CanvasSemanticControl,
  controlById: Map<string, CanvasSemanticControl>,
  controlNameToIds: Map<string, string[]>,
  dataSourceSymbols: ReturnType<typeof buildDataSourceSymbols>,
  metadataCatalog: CanvasMetadataCatalog | undefined
): Promise<CanvasFormulaSemantic[]> {
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
    const parsed = await parsePowerFxExpression(expression, {
      allowsSideEffects: property.startsWith('On') || expression.includes(';'),
    });
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

  visitPowerFxAst(node, (current, parent) => {
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

  if (/^(var|loc|gbl|col)/i.test(node.name)) {
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

  const optionSetTarget = node.object;
  const optionSet = metadataCatalog?.optionSets.find((item) => normalizeName(item.name) === normalizeName(optionSetTarget.name));
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

  for (const resolution of options.templateResolutions ?? []) {
    if (!resolution.template) {
      continue;
    }

    const surface = buildCanvasTemplateSurface(resolution.template);
    map.set(makeTemplateKey(resolution.requested.name, resolution.requested.version ?? resolution.template.templateVersion), surface);
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

function makeTemplateKey(templateName: string, templateVersion: string): string {
  return `${normalizeName(templateName)}@${templateVersion}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
