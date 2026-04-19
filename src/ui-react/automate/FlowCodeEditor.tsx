import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  formatFlowDocument,
  type FlowValidationItem,
  type FlowValidationResult,
} from '../automate-data.js';
import { analyzeFlow } from '../../flow-language.js';
import type { DiagnosticItem, FlowAnalysis, FlowAnalysisOutlineItem, ToastFn } from '../ui-types.js';
import { applyMonacoAppTheme, attachMonacoVim, type MonacoVimAttachment } from '../monaco-support.js';
import type { FlowEditorHandle } from './types.js';
import { findFlowExpressionCompletionContext } from '../../flow-expression-completions.js';
import { INPUT_LABELS, escapeMarkdown, shorten } from './outline-utils.js';
import {
  EMPTY_FLOW_EDITOR_SCHEMA_INDEX,
  flowEditorExpressionSchemaCompletionItems,
  flowEditorSchemaCompletionItems,
  type FlowEditorSchemaIndex,
} from './flow-editor-schema-index.js';
import { FLOW_SNIPPETS } from './flow-code-snippets.js';
import { JSON_LIKE_TOKEN_RULES } from './flow-monaco-tokens.js';
import {
  flowEditorConnectionCompletionItems,
  type FlowEditorConnectionCompletionItem,
} from './flow-editor-connection-completions.js';
import type { FlowConnectionModel } from './flow-connections.js';

const FLOW_JSON_LANGUAGE_ID = 'pp-flow-json';
let flowJsonLanguageRegistered = false;

export const FlowCodeEditor = forwardRef<FlowEditorHandle, {
  value: string;
  onChange: (value: string) => void;
  diagnostics: DiagnosticItem[];
  validation: FlowValidationResult | null;
  analysis: FlowAnalysis | null;
  schemaIndex?: FlowEditorSchemaIndex;
  connectionModel?: FlowConnectionModel;
  vimEnabled: boolean;
  onVimMode: (mode: string) => void;
  toast: ToastFn;
}>((props, ref) => {
  const { value, onChange, diagnostics, validation, analysis, schemaIndex, connectionModel, vimEnabled, onVimMode, toast } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const vimStatusRef = useRef<HTMLSpanElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const vimAttachmentRef = useRef<MonacoVimAttachment | null>(null);
  const valueRef = useRef(value);
  const vimEnabledRef = useRef(vimEnabled);
  const onChangeRef = useRef(onChange);
  const onVimModeRef = useRef(onVimMode);
  const diagnosticsRef = useRef(diagnostics);
  const validationRef = useRef(validation);
  const analysisRef = useRef(analysis);
  const schemaIndexRef = useRef<FlowEditorSchemaIndex>(schemaIndex || EMPTY_FLOW_EDITOR_SCHEMA_INDEX);
  const connectionModelRef = useRef<FlowConnectionModel | null>(connectionModel || null);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onVimModeRef.current = onVimMode; }, [onVimMode]);
  useEffect(() => { diagnosticsRef.current = diagnostics; }, [diagnostics]);
  useEffect(() => { validationRef.current = validation; }, [validation]);
  useEffect(() => { analysisRef.current = analysis; }, [analysis]);
  useEffect(() => { schemaIndexRef.current = schemaIndex || EMPTY_FLOW_EDITOR_SCHEMA_INDEX; }, [schemaIndex]);
  useEffect(() => { connectionModelRef.current = connectionModel || null; }, [connectionModel]);
  useEffect(() => {
    vimEnabledRef.current = vimEnabled;
    vimAttachmentRef.current?.setEnabled(vimEnabled);
  }, [vimEnabled]);

  useEffect(() => {
    valueRef.current = value;
    const model = modelRef.current;
    if (!model) return;
    if (model.getValue() !== value) model.setValue(value);
  }, [value]);

  useEffect(() => {
    updateFlowEditorMarkers(modelRef.current, diagnostics, validation);
  }, [diagnostics, validation, value]);

  useImperativeHandle(ref, () => ({
    format: () => {
      const editor = editorRef.current;
      const model = modelRef.current;
      if (!editor || !model) return null;
      const formatted = formatFlowDocument(model.getValue());
      editor.pushUndoStop();
      editor.executeEdits('format-json', [{ range: model.getFullModelRange(), text: formatted }]);
      editor.pushUndoStop();
      return formatted;
    },
    revealRange: (from, to) => {
      const editor = editorRef.current;
      const model = modelRef.current;
      if (!editor || !model) return;
      const startOffset = Math.max(0, from ?? 0);
      const endOffset = Math.max(startOffset + 1, Math.min(to ?? startOffset + 1, model.getValueLength()));
      const start = model.getPositionAt(startOffset);
      const end = model.getPositionAt(endOffset);
      const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
      editor.setSelection(range);
      editor.revealPositionNearTop(start, monaco.editor.ScrollType.Smooth);
      editor.focus();
    },
    revealText: (needle) => {
      const editor = editorRef.current;
      const model = modelRef.current;
      if (!editor || !model || !needle) return;
      const index = model.getValue().indexOf(needle);
      if (index < 0) return;
      const start = model.getPositionAt(index);
      const end = model.getPositionAt(index + needle.length);
      const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
      editor.setSelection(range);
      editor.revealPositionNearTop(start, monaco.editor.ScrollType.Smooth);
      editor.focus();
    },
  }), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    applyMonacoAppTheme();
    ensureFlowJsonLanguage();
    const model = monaco.editor.createModel(valueRef.current || '', FLOW_JSON_LANGUAGE_ID, monaco.Uri.parse('inmemory://pp/flow-definition.json'));
    const editor = monaco.editor.create(mount, {
      model,
      automaticLayout: true,
      folding: true,
      fontFamily: 'var(--mono)',
      fontSize: 13,
      glyphMargin: true,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'on',
      quickSuggestions: { strings: true, comments: false, other: true },
      quickSuggestionsDelay: 80,
      suggestOnTriggerCharacters: true,
      theme: 'pp-app',
    });
    const completionProvider = monaco.languages.registerCompletionItemProvider(FLOW_JSON_LANGUAGE_ID, {
      triggerCharacters: ['"', "'", '@', ':', '(', ',', '[', '?'],
      provideCompletionItems: (completionModel, position) => {
        if (completionModel.uri.toString() !== model.uri.toString()) return { suggestions: [] };
        const source = completionModel.getValue();
        const cursor = completionModel.getOffsetAt(position);
        try {
          const currentAnalysis = analyzeFlow(source, cursor);
          analysisRef.current = currentAnalysis;
          return {
            suggestions: [
              ...flowSchemaCompletions(completionModel, position, currentAnalysis, schemaIndexRef.current),
              ...flowConnectionCompletions(completionModel, position, currentAnalysis, connectionModelRef.current),
              ...flowExpressionSchemaCompletions(completionModel, position, schemaIndexRef.current),
              ...flowAnalysisCompletions(completionModel, position, currentAnalysis),
              ...flowSnippetCompletions(completionModel, position),
            ],
          };
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
          return { suggestions: flowSnippetCompletions(completionModel, position) };
        }
      },
    });
    const hoverProvider = monaco.languages.registerHoverProvider('json', {
      provideHover: (hoverModel, position) => {
        if (hoverModel.uri.toString() !== model.uri.toString()) return null;
        const offset = hoverModel.getOffsetAt(position);
        const hover = flowHoverAtOffset(analysisRef.current, offset);
        if (!hover) return null;
        return { contents: [{ value: hover }] };
      },
    });
    modelRef.current = model;
    editorRef.current = editor;
    vimAttachmentRef.current = attachMonacoVim(editor, vimStatusRef.current, {
      enabled: vimEnabledRef.current,
      onModeChange: (mode) => onVimModeRef.current(mode),
    });

    const themeObserver = new MutationObserver(() => applyMonacoAppTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const contentSubscription = editor.onDidChangeModelContent((event) => {
      const next = model.getValue();
      valueRef.current = next;
      onChangeRef.current(next);
      const text = event.changes.map((change) => change.text).join('');
      if (!/[A-Za-z_@'(),?\[]/.test(text)) return;
      const position = editor.getPosition();
      if (!position) return;
      const offset = model.getOffsetAt(position);
      if (!findFlowExpressionCompletionContext(model.getValue(), offset, { windowSize: 200, stopAtDoubleQuote: true })) return;
      window.setTimeout(() => {
        if (editor.getModel()?.uri.toString() === model.uri.toString()) {
          editor.trigger('pp-flow-expression', 'editor.action.triggerSuggest', {});
        }
      }, 0);
    });

    updateFlowEditorMarkers(model, diagnosticsRef.current, validationRef.current);
    return () => {
      themeObserver.disconnect();
      contentSubscription.dispose();
      completionProvider.dispose();
      hoverProvider.dispose();
      vimAttachmentRef.current?.dispose();
      vimAttachmentRef.current = null;
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  return (
    <>
      <div className={`monaco-vim-status-line ${vimEnabled ? 'active' : ''}`}>
        <span ref={vimStatusRef} className="monaco-vim-status-node" />
      </div>
      <div ref={mountRef} className="fetchxml-editor-mount" />
    </>
  );
});

FlowCodeEditor.displayName = 'FlowCodeEditor';

function ensureFlowJsonLanguage() {
  if (flowJsonLanguageRegistered) return;
  flowJsonLanguageRegistered = true;
  monaco.languages.register({ id: FLOW_JSON_LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration(FLOW_JSON_LANGUAGE_ID, {
    brackets: [['{', '}'], ['[', ']']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  });
  monaco.languages.setMonarchTokensProvider(FLOW_JSON_LANGUAGE_ID, {
    defaultToken: '',
    tokenizer: {
      root: JSON_LIKE_TOKEN_RULES,
    },
  });
}

function updateFlowEditorMarkers(model: monaco.editor.ITextModel | null, diagnostics: DiagnosticItem[], validation: FlowValidationResult | null) {
  if (!model) return;
  const markers: monaco.editor.IMarkerData[] = [];
  for (const item of diagnostics || []) {
    markers.push(markerFromOffsets(model, item.from ?? 0, item.to ?? item.from ?? 0, item.message, severityFromLevel(item.level), item.code));
  }
  if (validation) for (const item of validation.items) {
    const offsets = validationOffsets(model, item);
    markers.push(markerFromOffsets(model, offsets.from, offsets.to, item.message, severityFromLevel(item.level), item.code || validation.kind));
  }
  monaco.editor.setModelMarkers(model, 'pp-flow', markers);
}

function markerFromOffsets(model: monaco.editor.ITextModel, from: number, to: number, message: string, severity: monaco.MarkerSeverity, source?: string): monaco.editor.IMarkerData {
  const start = model.getPositionAt(Math.max(0, from));
  const end = model.getPositionAt(Math.max(from, to || from + 1));
  return {
    severity,
    message,
    source,
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: Math.max(end.column, start.column + 1),
  };
}

function validationOffsets(model: monaco.editor.ITextModel, item: FlowValidationItem) {
  if (item.from !== undefined || item.to !== undefined) return { from: item.from ?? 0, to: item.to ?? item.from ?? 1 };
  const text = model.getValue();
  const needle = item.operationMetadataId || item.actionName || item.path || item.code;
  if (needle) {
    const index = text.indexOf(needle);
    if (index >= 0) return { from: index, to: index + needle.length };
  }
  return { from: 0, to: 1 };
}

function severityFromLevel(level: string | undefined): monaco.MarkerSeverity {
  if (level === 'error') return monaco.MarkerSeverity.Error;
  if (level === 'warning') return monaco.MarkerSeverity.Warning;
  return monaco.MarkerSeverity.Info;
}

function flowAnalysisCompletions(model: monaco.editor.ITextModel, position: monaco.Position, analysis: FlowAnalysis): monaco.languages.CompletionItem[] {
  const range = flowCompletionRange(model, position);
  return (analysis.completions || []).map((item) => ({
    label: item.label,
    kind: completionKind(item.type),
    detail: item.detail || item.type,
    documentation: item.info,
    insertText: item.apply || item.label,
    insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range,
  }));
}

function flowSchemaCompletions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  analysis: FlowAnalysis,
  schemaIndex: FlowEditorSchemaIndex,
): monaco.languages.CompletionItem[] {
  const cursor = model.getOffsetAt(position);
  const range = wordCompletionRange(model, position);
  return flowEditorSchemaCompletionItems(cursor, analysis, schemaIndex).map((item) => ({
    label: item.label,
    kind: item.kind === 'property' ? monaco.languages.CompletionItemKind.Property : monaco.languages.CompletionItemKind.Value,
    detail: item.detail,
    documentation: item.documentation,
    insertText: item.insertText,
    sortText: item.sortText,
    range,
  }));
}

function flowExpressionSchemaCompletions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  schemaIndex: FlowEditorSchemaIndex,
): monaco.languages.CompletionItem[] {
  const cursor = model.getOffsetAt(position);
  const range = flowCompletionRange(model, position);
  return flowEditorExpressionSchemaCompletionItems(model.getValue(), cursor, schemaIndex).map((item) => ({
    label: item.label,
    kind: monaco.languages.CompletionItemKind.Property,
    detail: item.detail,
    documentation: item.documentation,
    insertText: item.insertText,
    sortText: item.sortText,
    range,
  }));
}

function flowConnectionCompletions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  analysis: FlowAnalysis,
  connectionModel: FlowConnectionModel | null,
): monaco.languages.CompletionItem[] {
  const range = wordCompletionRange(model, position);
  return flowEditorConnectionCompletionItems(analysis, connectionModel).map((item: FlowEditorConnectionCompletionItem) => ({
    label: item.label,
    kind: item.kind === 'property' ? monaco.languages.CompletionItemKind.Property : monaco.languages.CompletionItemKind.Value,
    detail: item.detail,
    documentation: item.documentation,
    insertText: item.insertText,
    sortText: item.sortText,
    range,
  }));
}

function flowSnippetCompletions(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.CompletionItem[] {
  const range = wordCompletionRange(model, position);
  return FLOW_SNIPPETS.map((snippet) => ({
    label: snippet.label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    detail: snippet.detail,
    documentation: snippet.documentation,
    insertText: snippet.insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
  }));
}

function flowCompletionRange(model: monaco.editor.ITextModel, position: monaco.Position): monaco.IRange {
  const offset = model.getOffsetAt(position);
  const expressionContext = findFlowExpressionCompletionContext(model.getValue(), offset, { windowSize: 200, stopAtDoubleQuote: true });
  if (expressionContext) {
    const start = model.getPositionAt(expressionContext.replaceFrom);
    if (start.lineNumber === position.lineNumber) {
      return {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: start.column,
        endColumn: position.column,
      };
    }
  }
  return wordCompletionRange(model, position);
}

function wordCompletionRange(model: monaco.editor.ITextModel, position: monaco.Position): monaco.IRange {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
}

function completionKind(type: string | undefined): monaco.languages.CompletionItemKind {
  if (type === 'property') return monaco.languages.CompletionItemKind.Property;
  if (type === 'function') return monaco.languages.CompletionItemKind.Function;
  if (type === 'action') return monaco.languages.CompletionItemKind.Reference;
  if (type === 'variable') return monaco.languages.CompletionItemKind.Variable;
  if (type === 'parameter') return monaco.languages.CompletionItemKind.Value;
  if (type === 'keyword') return monaco.languages.CompletionItemKind.Keyword;
  return monaco.languages.CompletionItemKind.Value;
}

function flowHoverAtOffset(analysis: FlowAnalysis | null, offset: number): string | null {
  const item = findOutlineAtOffsetLocal(analysis?.outline || [], offset);
  if (!item) return null;
  const lines = [
    `**${escapeMarkdown(item.name || 'Workflow')}**`,
    item.type ? `Type: \`${escapeMarkdown(item.type)}\`` : item.detail ? `Detail: \`${escapeMarkdown(item.detail)}\`` : '',
    item.connector ? `Connector: \`${escapeMarkdown(item.connector)}\`` : '',
    item.dependency ? `Dependency: \`${escapeMarkdown(item.dependency)}\`` : '',
    item.runAfter?.length ? `Runs after: ${item.runAfter.map((value) => `\`${escapeMarkdown(value)}\``).join(', ')}` : '',
  ].filter(Boolean);
  if (item.inputs) {
    for (const [key, value] of Object.entries(item.inputs).slice(0, 6)) {
      if (value === undefined || value === null) continue;
      const display = typeof value === 'string' ? value : JSON.stringify(value);
      lines.push(`${INPUT_LABELS[key] || key}: \`${escapeMarkdown(shorten(display, 140))}\``);
    }
  }
  return lines.join('\n\n');
}

function findOutlineAtOffsetLocal(items: FlowAnalysisOutlineItem[], offset: number): FlowAnalysisOutlineItem | null {
  for (const item of items) {
    if ((item.from ?? -1) <= offset && offset <= (item.to ?? -1)) {
      return findOutlineAtOffsetLocal(item.children || [], offset) || item;
    }
  }
  return null;
}
