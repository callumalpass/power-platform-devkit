import type { RefObject } from 'react';
import { MonacoVimToggle } from '../monaco-support.js';
import type { FlowAnalysis, FlowAnalysisOutlineItem, ToastFn } from '../ui-types.js';
import type { FlowValidationResult } from '../automate-data.js';
import { FlowCodeEditor } from './FlowCodeEditor.js';
import { FlowOutlineCanvas } from './FlowOutlineCanvas.js';
import { FlowProblemsPanel } from './FlowProblemsPanel.js';
import type { FlowEditorHandle, FlowOperation, FlowProblem } from './types.js';
import { useResizableWidth } from '../setup/use-resizable-width.js';

export function FlowDefinitionPanel(props: {
  active: boolean;
  analysis: FlowAnalysis | null;
  analyzing: boolean;
  flowBusy: boolean;
  flowDocument: string;
  flowEditorRef: RefObject<FlowEditorHandle | null>;
  flowFullscreen: boolean;
  flowOperation: FlowOperation;
  flowOutlineActiveKey: string;
  flowOutlineActivePath: string[];
  flowProblems: FlowProblem[];
  flowValidation: FlowValidationResult | null;
  hasBlockingServiceErrors: boolean;
  isFlowDirty: boolean;
  isFlowEditable: boolean;
  toast: ToastFn;
  vimEnabled: boolean;
  flowVimMode: string;
  onAddAction: () => void;
  onAddAfter: (item: FlowAnalysisOutlineItem) => void;
  onAddInside: (item: FlowAnalysisOutlineItem) => void;
  onHighlightJson: (item: FlowAnalysisOutlineItem) => void;
  onRemoveAction: (item: FlowAnalysisOutlineItem) => void;
  onCheckErrors: () => void;
  onCheckWarnings: () => void;
  onDocumentChange: (value: string) => void;
  onEditAction: (item: FlowAnalysisOutlineItem) => void;
  onFormat: () => void;
  onJumpProblem: (problem: FlowProblem) => void;
  onReload: () => void;
  onReorderAction: (actionName: string, targetName: string, position: 'before' | 'after') => void;
  onSave: () => void;
  onSaveAnyway: () => void;
  onSelectOutline: (item: FlowAnalysisOutlineItem) => void;
  onShowDiff: () => void;
  onToggleFullscreen: () => void;
  onVimMode: (mode: string) => void;
  onVimToggle: (enabled: boolean) => void;
}) {
  const { active } = props;
  const { width: outlineWidth, startDrag: startOutlineResize } = useResizableWidth(
    'pp-automate-outline-width',
    { min: 220, max: 640, initial: 320, edge: 'right' },
  );

  return (
    <div className={`dv-subpanel ${active ? 'active' : ''}`}>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2>Definition</h2>
            {props.isFlowDirty ? <span className="entity-item-flag" style={{ color: '#d97706', borderColor: '#d97706' }}>unsaved</span> : null}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{props.flowOperation ? 'Working…' : props.analyzing ? 'Analyzing…' : props.analysis ? 'Analysis updated' : 'Definition not loaded'}</div>
        </div>
        <div className={`fetchxml-editor-shell ${props.flowFullscreen ? 'flow-editor-shell-fullscreen' : ''}`}>
          <div className="fetchxml-editor-toolbar">
            <div className="fetchxml-editor-toolbar-left">
              <button className="btn btn-ghost" type="button" disabled={props.flowBusy} onClick={props.onReload}>{props.flowOperation === 'reload' ? 'Reloading…' : 'Reload'}</button>
              <button className="btn btn-ghost" type="button" disabled={!props.flowDocument.trim()} onClick={props.onFormat}>Format JSON</button>
              <button className="btn btn-ghost" type="button" disabled={!props.flowDocument.trim()} onClick={props.onAddAction}>Add Action</button>
              <button className="btn btn-ghost" type="button" disabled={!props.isFlowDirty} onClick={props.onShowDiff}>View Changes</button>
              <button className="btn btn-ghost" type="button" onClick={props.onToggleFullscreen}>{props.flowFullscreen ? 'Exit Full Screen' : 'Full Screen'}</button>
            </div>
            <div className="fetchxml-editor-toolbar-right">
              <MonacoVimToggle enabled={props.vimEnabled} mode={props.flowVimMode} onToggle={props.onVimToggle} />
              <button className="btn btn-ghost" type="button" disabled={!props.isFlowEditable || props.flowBusy} onClick={props.onCheckErrors}>{props.flowOperation === 'check-errors' ? 'Checking…' : 'Check Errors'}</button>
              <button className="btn btn-ghost" type="button" disabled={!props.isFlowEditable || props.flowBusy} onClick={props.onCheckWarnings}>{props.flowOperation === 'check-warnings' ? 'Checking…' : 'Check Warnings'}</button>
              {props.hasBlockingServiceErrors ? (
                <button className="btn btn-ghost" type="button" disabled={!props.isFlowEditable || props.flowBusy || !props.isFlowDirty} onClick={props.onSaveAnyway}>Save Anyway</button>
              ) : null}
              <button className="btn btn-primary" type="button" disabled={!props.isFlowEditable || props.flowBusy || !props.isFlowDirty} onClick={props.onSave}>{props.flowOperation === 'save' ? 'Checking…' : 'Check & Save'}</button>
            </div>
          </div>
          <div
            className="flow-editor-layout"
            style={{ ['--outline-width' as any]: `${outlineWidth}px` }}
          >
            <aside className="flow-outline-rail">
              <FlowOutlineCanvas
                items={props.analysis?.outline || []}
                problems={props.flowProblems}
                activeKey={props.flowOutlineActiveKey}
                activePath={props.flowOutlineActivePath}
                onSelect={props.onSelectOutline}
                onEditAction={props.onEditAction}
                onAddAfter={props.onAddAfter}
                onAddInside={props.onAddInside}
                onHighlightJson={props.onHighlightJson}
                onRemove={props.onRemoveAction}
                onReorder={props.onReorderAction}
              />
              <div
                className="flow-outline-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize outline"
                onMouseDown={startOutlineResize}
              />
            </aside>
            <div className="flow-editor-main">
              <FlowCodeEditor
                ref={props.flowEditorRef}
                value={props.flowDocument}
                onChange={props.onDocumentChange}
                diagnostics={props.analysis?.diagnostics || []}
                validation={props.flowValidation}
                analysis={props.analysis}
                vimEnabled={props.vimEnabled}
                onVimMode={props.onVimMode}
                toast={props.toast}
              />
            </div>
          </div>
        </div>
        <div className="flow-summary-grid" style={{ marginTop: 12 }}>
          {[
            ['Wrapper', props.analysis?.summary?.wrapperKind || 'unknown'],
            ['Triggers', String(props.analysis?.summary?.triggerCount || 0)],
            ['Actions', String(props.analysis?.summary?.actionCount || 0)],
            ['Variables', String(props.analysis?.summary?.variableCount || 0)],
            ['Parameters', String(props.analysis?.summary?.parameterCount || 0)],
            ['Service check', props.flowValidation ? `${props.flowValidation.items.length} ${props.flowValidation.kind}` : 'not run'],
          ].map(([label, value]) => (
            <div key={label} className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>
          ))}
        </div>
        <FlowProblemsPanel problems={props.flowProblems} validation={props.flowValidation} onJump={props.onJumpProblem} toast={props.toast} />
      </div>
    </div>
  );
}
