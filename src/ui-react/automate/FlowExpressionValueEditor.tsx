import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { useEffect, useRef } from 'react';
import { findFlowExpressionCompletionContext } from '../../flow-expression-completions.js';
import { completeFlowExpression } from '../../flow-language.js';
import { applyMonacoAppTheme } from '../monaco-support.js';
import { EMPTY_FLOW_EDITOR_SCHEMA_INDEX, flowEditorExpressionSchemaCompletionItems, type FlowEditorSchemaIndex } from './flow-editor-schema-index.js';
import { FLOW_EXPRESSION_TOKEN_RULES } from './flow-monaco-tokens.js';

const FLOW_FIELD_LANGUAGE_ID = 'pp-flow-field-expression';
let flowFieldLanguageRegistered = false;
let flowFieldModelCounter = 0;

export function FlowExpressionValueEditor(props: { value: string; source: string; schemaIndex?: FlowEditorSchemaIndex; mode: 'text' | 'json'; onChange: (value: string) => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const valueRef = useRef(props.value);
  const sourceRef = useRef(props.source);
  const schemaIndexRef = useRef<FlowEditorSchemaIndex>(props.schemaIndex || EMPTY_FLOW_EDITOR_SCHEMA_INDEX);
  const onChangeRef = useRef(props.onChange);
  const suppressChangeRef = useRef(false);
  const modeRef = useRef(props.mode);

  useEffect(() => {
    sourceRef.current = props.source;
  }, [props.source]);
  useEffect(() => {
    schemaIndexRef.current = props.schemaIndex || EMPTY_FLOW_EDITOR_SCHEMA_INDEX;
  }, [props.schemaIndex]);
  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);
  useEffect(() => {
    modeRef.current = props.mode;
  }, [props.mode]);

  useEffect(() => {
    valueRef.current = props.value;
    const model = modelRef.current;
    if (!model || model.getValue() === props.value) return;
    suppressChangeRef.current = true;
    model.setValue(props.value || '');
    suppressChangeRef.current = false;
  }, [props.value]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    ensureFlowFieldLanguage();
    applyMonacoAppTheme();

    const id = ++flowFieldModelCounter;
    const model = monaco.editor.createModel(valueRef.current || '', FLOW_FIELD_LANGUAGE_ID, monaco.Uri.parse(`inmemory://pp/flow-action-field-${id}.wdl`));
    const editor = monaco.editor.create(mount, editorOptions(modeRef.current));
    editor.setModel(model);

    const completionProvider = monaco.languages.registerCompletionItemProvider(FLOW_FIELD_LANGUAGE_ID, {
      triggerCharacters: ['@', "'", '(', ',', '[', '?'],
      provideCompletionItems: (completionModel, position) => {
        try {
          if (completionModel.uri.toString() !== model.uri.toString()) return { suggestions: [] };
          const cursor = completionModel.getOffsetAt(position);
          const context = findFlowExpressionCompletionContext(completionModel.getValue(), cursor);
          if (!context) return { suggestions: [] };
          const range = rangeFromOffsets(completionModel, context.replaceFrom, cursor);
          const schemaSuggestions = flowEditorExpressionSchemaCompletionItems(completionModel.getValue(), cursor, schemaIndexRef.current);
          return {
            suggestions: [
              ...schemaSuggestions.map((item) => ({
                label: item.label,
                kind: monaco.languages.CompletionItemKind.Property,
                detail: item.detail,
                documentation: item.documentation,
                insertText: item.insertText,
                sortText: item.sortText,
                range
              })),
              ...completeFlowExpression(sourceRef.current, context.text, context.relativeCursor).map((item) => ({
                label: item.label,
                kind: completionKind(item.type),
                detail: item.detail || item.type,
                documentation: item.info,
                insertText: item.apply || item.label,
                insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                range
              }))
            ]
          };
        } catch (error) {
          console.error('Flow expression completions failed', error);
          return { suggestions: [] };
        }
      }
    });

    const contentSubscription = model.onDidChangeContent((event) => {
      const next = model.getValue();
      valueRef.current = next;
      if (!suppressChangeRef.current) onChangeRef.current(next);

      const inserted = event.changes.map((change) => change.text).join('');
      if (!/[A-Za-z_@'(),?[]/.test(inserted)) return;
      const position = editor.getPosition();
      if (!position) return;
      const offset = model.getOffsetAt(position);
      if (!findFlowExpressionCompletionContext(model.getValue(), offset)) return;
      window.setTimeout(() => {
        if (editor.getModel()?.uri.toString() === model.uri.toString()) {
          editor.trigger('pp-flow-field-expression', 'editor.action.triggerSuggest', {});
        }
      }, 0);
    });

    const themeObserver = new MutationObserver(() => applyMonacoAppTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    modelRef.current = model;
    editorRef.current = editor;

    return () => {
      themeObserver.disconnect();
      contentSubscription.dispose();
      completionProvider.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  return <div ref={mountRef} className={`flow-action-monaco-editor ${props.mode === 'json' ? 'json' : 'text'}`} />;
}

function ensureFlowFieldLanguage() {
  if (flowFieldLanguageRegistered) return;
  flowFieldLanguageRegistered = true;
  monaco.languages.register({ id: FLOW_FIELD_LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration(FLOW_FIELD_LANGUAGE_ID, {
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ]
  });
  monaco.languages.setMonarchTokensProvider(FLOW_FIELD_LANGUAGE_ID, {
    defaultToken: '',
    tokenizer: {
      root: FLOW_EXPRESSION_TOKEN_RULES
    }
  });
}

function editorOptions(mode: 'text' | 'json'): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    automaticLayout: true,
    fixedOverflowWidgets: true,
    folding: false,
    fontFamily: 'var(--mono)',
    fontSize: 12,
    glyphMargin: false,
    lineDecorationsWidth: 0,
    lineNumbers: 'off',
    lineNumbersMinChars: 0,
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    padding: { top: mode === 'json' ? 7 : 6, bottom: mode === 'json' ? 7 : 5 },
    quickSuggestions: { strings: true, comments: false, other: true },
    quickSuggestionsDelay: 80,
    renderLineHighlight: 'none',
    renderWhitespace: 'selection',
    roundedSelection: false,
    scrollbar: {
      vertical: mode === 'json' ? 'auto' : 'hidden',
      horizontal: 'hidden',
      alwaysConsumeMouseWheel: false
    },
    scrollBeyondLastLine: false,
    suggestOnTriggerCharacters: true,
    tabSize: 2,
    theme: 'pp-app',
    wordWrap: mode === 'json' ? 'on' : 'off'
  };
}

function rangeFromOffsets(model: monaco.editor.ITextModel, from: number, to: number): monaco.IRange {
  const start = model.getPositionAt(Math.max(0, from));
  const end = model.getPositionAt(Math.max(from, to));
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  };
}

function completionKind(type: string | undefined): monaco.languages.CompletionItemKind {
  if (type === 'function') return monaco.languages.CompletionItemKind.Function;
  if (type === 'action') return monaco.languages.CompletionItemKind.Reference;
  if (type === 'variable') return monaco.languages.CompletionItemKind.Variable;
  if (type === 'parameter') return monaco.languages.CompletionItemKind.Value;
  if (type === 'property') return monaco.languages.CompletionItemKind.Property;
  return monaco.languages.CompletionItemKind.Value;
}
