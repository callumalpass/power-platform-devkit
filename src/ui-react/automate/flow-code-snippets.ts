import { BUILT_IN_ACTION_TEMPLATES } from './flow-built-in-templates.js';

export type FlowCodeSnippet = {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
};

type JsonPathSegment = string | number;

type SnippetPlaceholder = {
  path: JsonPathSegment[];
  index: number;
  defaultText?: string;
  kind?: 'value' | 'object-content';
};

type BuiltInActionSnippetSpec = {
  label: string;
  detail: string;
  documentation: string;
  templateKey: string;
  defaultName: string;
  placeholders: SnippetPlaceholder[];
};

const ACTION_SNIPPET_SPECS: BuiltInActionSnippetSpec[] = [
  {
    label: 'pa:compose action',
    detail: 'Compose action',
    documentation: 'Insert a Compose action body.',
    templateKey: 'compose',
    defaultName: 'Compose',
    placeholders: [
      { path: ['inputs'], index: 2 },
      { path: ['runAfter'], index: 3, kind: 'object-content' }
    ]
  },
  {
    label: 'pa:condition action',
    detail: 'Condition action',
    documentation: 'Insert an If action with true and false branches.',
    templateKey: 'condition',
    defaultName: 'Condition',
    placeholders: [
      { path: ['expression', 'equals', 0], index: 2 },
      { path: ['expression', 'equals', 1], index: 3 },
      { path: ['actions'], index: 4, kind: 'object-content' },
      { path: ['else', 'actions'], index: 5, kind: 'object-content' },
      { path: ['runAfter'], index: 6, kind: 'object-content' }
    ]
  },
  {
    label: 'pa:scope action',
    detail: 'Scope action',
    documentation: 'Insert a Scope action.',
    templateKey: 'scope',
    defaultName: 'Scope',
    placeholders: [
      { path: ['actions'], index: 2, kind: 'object-content' },
      { path: ['runAfter'], index: 3, kind: 'object-content' }
    ]
  },
  {
    label: 'pa:foreach action',
    detail: 'Foreach action',
    documentation: 'Insert a Foreach loop.',
    templateKey: 'apply-to-each',
    defaultName: 'Apply_to_each',
    placeholders: [
      { path: ['foreach'], index: 2, defaultText: "@triggerBody()?['value']" },
      { path: ['actions'], index: 3, kind: 'object-content' },
      { path: ['runAfter'], index: 4, kind: 'object-content' }
    ]
  },
  {
    label: 'pa:http action',
    detail: 'HTTP action',
    documentation: 'Insert an HTTP action.',
    templateKey: 'http',
    defaultName: 'HTTP',
    placeholders: [
      { path: ['inputs', 'method'], index: 2, defaultText: 'GET' },
      { path: ['inputs', 'uri'], index: 3 },
      { path: ['runAfter'], index: 4, kind: 'object-content' }
    ]
  },
  {
    label: 'pa:initialize variable',
    detail: 'Initialize variable action',
    documentation: 'Insert an InitializeVariable action.',
    templateKey: 'init-variable',
    defaultName: 'Initialize_variable',
    placeholders: [
      { path: ['inputs', 'variables', 0, 'name'], index: 2 },
      { path: ['inputs', 'variables', 0, 'type'], index: 3, defaultText: 'string' },
      { path: ['inputs', 'variables', 0, 'value'], index: 4 },
      { path: ['runAfter'], index: 5, kind: 'object-content' }
    ]
  },
  {
    label: 'pa:set variable',
    detail: 'Set variable action',
    documentation: 'Insert a SetVariable action.',
    templateKey: 'set-variable',
    defaultName: 'Set_variable',
    placeholders: [
      { path: ['inputs', 'name'], index: 2 },
      { path: ['inputs', 'value'], index: 3 },
      { path: ['runAfter'], index: 4, kind: 'object-content' }
    ]
  }
];

export const FLOW_SNIPPETS = ACTION_SNIPPET_SPECS.map(buildBuiltInActionSnippet) as readonly FlowCodeSnippet[];

function buildBuiltInActionSnippet(spec: BuiltInActionSnippetSpec): FlowCodeSnippet {
  const template = BUILT_IN_ACTION_TEMPLATES.find((item) => item.key === spec.templateKey);
  if (!template) throw new Error(`Missing built-in action template ${spec.templateKey}`);
  const action = { ...template.action(), runAfter: {} };
  return {
    label: spec.label,
    detail: spec.detail,
    documentation: spec.documentation,
    insertText: [`"${snippetPlaceholder({ index: 1, defaultText: spec.defaultName })}": ${snippetJson(action, [], 0, placeholderMap(spec.placeholders))}`].join('\n')
  };
}

function placeholderMap(placeholders: SnippetPlaceholder[]): Map<string, SnippetPlaceholder> {
  return new Map(placeholders.map((placeholder) => [pathKey(placeholder.path), placeholder]));
}

function snippetJson(value: unknown, path: JsonPathSegment[], indent: number, placeholders: Map<string, SnippetPlaceholder>): string {
  const placeholder = placeholders.get(pathKey(path));
  if (placeholder?.kind === 'object-content' && isPlainObject(value) && !Object.keys(value).length) {
    return `{${snippetPlaceholder(placeholder)}}`;
  }
  if (placeholder?.kind !== 'object-content' && placeholder) {
    return JSON.stringify(
      snippetPlaceholder({
        ...placeholder,
        defaultText: placeholder.defaultText ?? defaultPlaceholderText(value)
      })
    );
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const nextIndent = indent + 2;
    const lines = value.map((item, index) => `${spaces(nextIndent)}${snippetJson(item, [...path, index], nextIndent, placeholders)}`);
    return `[\n${lines.join(',\n')}\n${spaces(indent)}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const nextIndent = indent + 2;
    const lines = entries.map(([key, item]) => {
      return `${spaces(nextIndent)}${JSON.stringify(key)}: ${snippetJson(item, [...path, key], nextIndent, placeholders)}`;
    });
    return `{\n${lines.join(',\n')}\n${spaces(indent)}}`;
  }
  return JSON.stringify(value);
}

function snippetPlaceholder(placeholder: Pick<SnippetPlaceholder, 'index' | 'defaultText'>): string {
  if (!placeholder.defaultText) return `\${${placeholder.index}}`;
  return `\${${placeholder.index}:${placeholder.defaultText}}`;
}

function defaultPlaceholderText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function pathKey(path: JsonPathSegment[]): string {
  return path.map(String).join('\u0000');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function spaces(count: number): string {
  return ' '.repeat(count);
}
