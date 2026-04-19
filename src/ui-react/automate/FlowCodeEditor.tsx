import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  analyzeFlowDocument,
  formatFlowDocument,
  type FlowValidationItem,
  type FlowValidationResult,
} from '../automate-data.js';
import type { DiagnosticItem, FlowAnalysis, FlowAnalysisOutlineItem, ToastFn } from '../ui-types.js';
import { applyMonacoAppTheme, attachMonacoVim, type MonacoVimAttachment } from '../monaco-support.js';
import type { FlowEditorHandle } from './types.js';
import { INPUT_LABELS, escapeMarkdown, shorten } from './outline-utils.js';

export const FlowCodeEditor = forwardRef<FlowEditorHandle, {
  value: string;
  onChange: (value: string) => void;
  diagnostics: DiagnosticItem[];
  validation: FlowValidationResult | null;
  analysis: FlowAnalysis | null;
  vimEnabled: boolean;
  onVimMode: (mode: string) => void;
  toast: ToastFn;
}>((props, ref) => {
  const { value, onChange, diagnostics, validation, analysis, vimEnabled, onVimMode, toast } = props;
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

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onVimModeRef.current = onVimMode; }, [onVimMode]);
  useEffect(() => { diagnosticsRef.current = diagnostics; }, [diagnostics]);
  useEffect(() => { validationRef.current = validation; }, [validation]);
  useEffect(() => { analysisRef.current = analysis; }, [analysis]);
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
    const model = monaco.editor.createModel(valueRef.current || '', 'json', monaco.Uri.parse('inmemory://pp/flow-definition.json'));
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
      theme: 'pp-app',
    });
    const completionProvider = monaco.languages.registerCompletionItemProvider('json', {
      triggerCharacters: ['"', "'", '@', ':'],
      provideCompletionItems: async (completionModel, position) => {
        if (completionModel.uri.toString() !== model.uri.toString()) return { suggestions: [] };
        const source = completionModel.getValue();
        const cursor = completionModel.getOffsetAt(position);
        try {
          const currentAnalysis = await analyzeFlowDocument(source, cursor);
          analysisRef.current = currentAnalysis;
          return {
            suggestions: [
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

    const contentSubscription = editor.onDidChangeModelContent(() => {
      const next = model.getValue();
      valueRef.current = next;
      onChangeRef.current(next);
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
  const range = completionRange(model, position);
  return (analysis.completions || []).map((item) => ({
    label: item.label,
    kind: completionKind(item.type),
    detail: item.detail || item.type,
    documentation: item.info,
    insertText: item.apply || item.label,
    range,
  }));
}

function flowSnippetCompletions(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.CompletionItem[] {
  const range = completionRange(model, position);
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

function completionRange(model: monaco.editor.ITextModel, position: monaco.Position): monaco.IRange {
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

const FLOW_SNIPPETS = [
  {
    label: 'pa:compose action',
    detail: 'Compose action',
    documentation: 'Insert a Compose action body.',
    insertText: [
      '"${1:Compose}": {',
      '  "type": "Compose",',
      '  "inputs": ${2:"value"},',
      '  "runAfter": {${3}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:condition action',
    detail: 'Condition action',
    documentation: 'Insert an If action with true and false branches.',
    insertText: [
      '"${1:Condition}": {',
      '  "type": "If",',
      '  "expression": {',
      '    "equals": [',
      '      ${2:"left"},',
      '      ${3:"right"}',
      '    ]',
      '  },',
      '  "actions": {',
      '    ${4}',
      '  },',
      '  "else": {',
      '    "actions": {',
      '      ${5}',
      '    }',
      '  },',
      '  "runAfter": {${6}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:scope action',
    detail: 'Scope action',
    documentation: 'Insert a Scope action.',
    insertText: [
      '"${1:Scope}": {',
      '  "type": "Scope",',
      '  "actions": {',
      '    ${2}',
      '  },',
      '  "runAfter": {${3}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:foreach action',
    detail: 'Foreach action',
    documentation: 'Insert a Foreach loop.',
    insertText: [
      '"${1:Apply_to_each}": {',
      '  "type": "Foreach",',
      "  \"foreach\": \"${2:@outputs('Compose')}\",",
      '  "actions": {',
      '    ${3}',
      '  },',
      '  "runAfter": {${4}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:http action',
    detail: 'HTTP action',
    documentation: 'Insert an HTTP action.',
    insertText: [
      '"${1:HTTP}": {',
      '  "type": "Http",',
      '  "inputs": {',
      '    "method": "${2:GET}",',
      '    "uri": "${3:https://example.com}"',
      '  },',
      '  "runAfter": {${4}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:initialize variable',
    detail: 'Initialize variable action',
    documentation: 'Insert an InitializeVariable action.',
    insertText: [
      '"${1:Initialize_variable}": {',
      '  "type": "InitializeVariable",',
      '  "inputs": {',
      '    "variables": [',
      '      {',
      '        "name": "${2:name}",',
      '        "type": "${3:string}",',
      '        "value": ${4:""}',
      '      }',
      '    ]',
      '  },',
      '  "runAfter": {${5}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:set variable',
    detail: 'Set variable action',
    documentation: 'Insert a SetVariable action.',
    insertText: [
      '"${1:Set_variable}": {',
      '  "type": "SetVariable",',
      '  "inputs": {',
      '    "name": "${2:name}",',
      '    "value": ${3:"value"}',
      '  },',
      '  "runAfter": {${4}}',
      '}',
    ].join('\n'),
  },
] as const;

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
