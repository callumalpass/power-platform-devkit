import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

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
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const id = ++modelCounter;
    const isDark = document.documentElement.classList.contains('dark');
    const model = monaco.editor.createModel(value || '', language, monaco.Uri.parse(`inmemory://pp/json-viewer-${id}.${language}`));
    const editor = monaco.editor.create(mount, {
      model,
      automaticLayout: true,
      readOnly,
      folding: true,
      fontFamily: 'var(--mono)',
      fontSize: 12,
      lineNumbers: 'on',
      minimap: { enabled: false },
      renderWhitespace: 'none',
      scrollBeyondLastLine: false,
      tabSize: 2,
      wordWrap: 'on',
      theme: isDark ? 'vs-dark' : 'vs',
    });
    modelRef.current = model;
    editorRef.current = editor;

    const sub = model.onDidChangeContent(() => {
      onChangeRef.current?.(model.getValue());
    });

    const themeObserver = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains('dark');
      monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      sub.dispose();
      themeObserver.disconnect();
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

  return <div ref={mountRef} className="json-viewer-mount" style={{ height, width: '100%' }} />;
}
