import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { useEffect, useRef, useState } from 'react';
import { applyMonacoAppTheme, attachMonacoVim, MonacoVimToggle, type MonacoVimAttachment, useMonacoVimPreference } from '../monaco-support.js';

export function FlowDiffModal(props: { original: string; modified: string; onClose: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const originalVimStatusRef = useRef<HTMLSpanElement | null>(null);
  const modifiedVimStatusRef = useRef<HTMLSpanElement | null>(null);
  const vimAttachmentsRef = useRef<MonacoVimAttachment[]>([]);
  const [vimEnabled, setVimEnabled] = useMonacoVimPreference();
  const [vimMode, setVimMode] = useState('off');
  const vimEnabledRef = useRef(vimEnabled);

  useEffect(() => {
    vimEnabledRef.current = vimEnabled;
    for (const attachment of vimAttachmentsRef.current) attachment.setEnabled(vimEnabled);
  }, [vimEnabled]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    applyMonacoAppTheme();
    const originalModel = monaco.editor.createModel(props.original || '', 'json');
    const modifiedModel = monaco.editor.createModel(props.modified || '', 'json');
    const editor = monaco.editor.createDiffEditor(mount, {
      automaticLayout: true,
      originalEditable: false,
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      theme: 'pp-app'
    });
    editor.setModel({ original: originalModel, modified: modifiedModel });
    vimAttachmentsRef.current = [
      attachMonacoVim(editor.getOriginalEditor(), originalVimStatusRef.current, {
        enabled: vimEnabledRef.current,
        onModeChange: setVimMode
      }),
      attachMonacoVim(editor.getModifiedEditor(), modifiedVimStatusRef.current, {
        enabled: vimEnabledRef.current,
        onModeChange: setVimMode
      })
    ];
    return () => {
      for (const attachment of vimAttachmentsRef.current) attachment.dispose();
      vimAttachmentsRef.current = [];
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [props.original, props.modified]);

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal size-xl flow-diff-modal">
        <div className="rt-modal-header">
          <div>
            <h2>Unsaved Changes</h2>
            <p className="desc" style={{ marginBottom: 0 }}>
              Review the loaded definition beside the current editor content.
            </p>
          </div>
          <div className="rt-modal-actions">
            <MonacoVimToggle enabled={vimEnabled} mode={vimMode} onToggle={setVimEnabled} />
            <span ref={originalVimStatusRef} className="monaco-vim-status-node" />
            <span ref={modifiedVimStatusRef} className="monaco-vim-status-node" />
            <button className="btn btn-ghost" type="button" onClick={props.onClose}>
              Close
            </button>
          </div>
        </div>
        <div ref={mountRef} className="flow-diff-editor" />
      </div>
    </div>
  );
}
