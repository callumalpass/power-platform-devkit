import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { applyMonacoAppTheme, attachMonacoVim, MonacoVimToggle, type MonacoVimAttachment, useMonacoVimPreference } from './monaco-support.js';

type Props = {
  value: string;
  language?: string;
  readOnly?: boolean;
  height?: number | string;
  onChange?: (value: string) => void;
};

let modelCounter = 0;

export function JsonViewer({ value, language = 'json', readOnly = true, height = '100%', onChange }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const vimStatusRef = useRef<HTMLSpanElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const vimAttachmentRef = useRef<MonacoVimAttachment | null>(null);
  const onChangeRef = useRef(onChange);
  const [vimEnabled, setVimEnabled] = useMonacoVimPreference();
  const [vimMode, setVimMode] = useState('off');
  const vimEnabledRef = useRef(vimEnabled);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    vimEnabledRef.current = vimEnabled;
    vimAttachmentRef.current?.setEnabled(vimEnabled);
  }, [vimEnabled]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const id = ++modelCounter;
    applyMonacoAppTheme();
    const model = monaco.editor.createModel(value || '', language, monaco.Uri.parse(`inmemory://pp/json-viewer-${id}.${language}`));
    const editor = monaco.editor.create(mount, {
      model,
      automaticLayout: true,
      readOnly,
      folding: true,
      fontFamily: 'var(--mono)',
      fontSize: 12,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      renderWhitespace: 'none',
      scrollBeyondLastLine: false,
      tabSize: 2,
      wordWrap: 'on',
      theme: 'pp-app'
    });
    modelRef.current = model;
    editorRef.current = editor;
    vimAttachmentRef.current = attachMonacoVim(editor, vimStatusRef.current, {
      enabled: vimEnabledRef.current,
      onModeChange: setVimMode
    });

    const sub = model.onDidChangeContent(() => {
      onChangeRef.current?.(model.getValue());
    });

    const themeObserver = new MutationObserver(() => applyMonacoAppTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      sub.dispose();
      themeObserver.disconnect();
      vimAttachmentRef.current?.dispose();
      vimAttachmentRef.current = null;
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    if (model.getValue() !== value) {
      const editor = editorRef.current;
      if (readOnly) {
        model.setValue(value || '');
      } else if (editor) {
        editor.executeEdits('external-set', [{ range: model.getFullModelRange(), text: value || '' }]);
      } else {
        model.setValue(value || '');
      }
    }
  }, [value, readOnly]);

  return (
    <div className="json-viewer-shell" style={{ height, width: '100%' }}>
      <div className="json-viewer-toolbar">
        <MonacoVimToggle enabled={vimEnabled} mode={vimMode} onToggle={setVimEnabled} />
        <span ref={vimStatusRef} className="monaco-vim-status-node" />
      </div>
      <div ref={mountRef} className="json-viewer-mount" />
    </div>
  );
}
