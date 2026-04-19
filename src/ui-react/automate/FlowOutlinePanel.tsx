import type { FlowAnalysis, FlowAnalysisOutlineItem } from '../ui-types.js';
import { FlowOutlineCanvas } from './FlowOutlineCanvas.js';
import type { FlowProblem } from './types.js';

export function FlowOutlinePanel(props: {
  active: boolean;
  analysis: FlowAnalysis | null;
  flowProblems: FlowProblem[];
  flowOutlineActiveKey: string;
  flowOutlineActivePath: string[];
  onAddAfter: (item: FlowAnalysisOutlineItem) => void;
  onAddInside: (item: FlowAnalysisOutlineItem) => void;
  onHighlightJson: (item: FlowAnalysisOutlineItem) => void;
  onRemoveAction: (item: FlowAnalysisOutlineItem) => void;
  onEditAction: (item: FlowAnalysisOutlineItem) => void;
  onReorderAction: (actionName: string, targetName: string, position: 'before' | 'after') => void;
  onSelectOutline: (item: FlowAnalysisOutlineItem) => void;
}) {
  return (
    <div className={`dv-subpanel ${props.active ? 'active' : ''}`}>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2>Outline</h2>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {props.analysis?.outline?.length ? `${props.analysis.outline.length} top-level items` : 'No outline yet'}
          </div>
        </div>
        {props.active ? (
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
        ) : null}
      </div>
    </div>
  );
}
