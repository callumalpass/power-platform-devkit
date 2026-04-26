import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

type Rule = monaco.languages.IMonarchLanguageRule;

export const JSON_LIKE_TOKEN_RULES: Rule[] = [
  [/"([^"\\]|\\.)*"(?=\s*:)/, 'string.key.json'],
  [/"([^"\\]|\\.)*"/, 'string.value.json'],
  [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number.json'],
  [/\b(?:true|false|null)\b/, 'keyword.json'],
  [/[{}]/, 'delimiter.bracket.json'],
  [/[[\]]/, 'delimiter.array.json'],
  [/:/, 'delimiter.colon.json'],
  [/,/, 'delimiter.comma.json']
];

export const FLOW_EXPRESSION_TOKEN_RULES: Rule[] = [
  [/'([^'\\]|\\.)*'/, 'string.value.json'],
  [/@[A-Za-z_][A-Za-z0-9_]*/, 'keyword.json'],
  [/[()]/, 'delimiter.parenthesis.json'],
  ...JSON_LIKE_TOKEN_RULES
];
