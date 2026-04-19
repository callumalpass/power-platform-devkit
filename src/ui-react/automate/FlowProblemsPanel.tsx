import { formatDate, highlightJson } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import type { FlowValidationResult } from '../automate-data.js';
import type { DiagnosticItem, ToastFn } from '../ui-types.js';
import type { FlowConnectionIssue } from './flow-connections.js';
import type { FlowProblem } from './types.js';

export function buildFlowProblems(diagnostics: DiagnosticItem[], validation: FlowValidationResult | null, connectionIssues: FlowConnectionIssue[] = []): FlowProblem[] {
  const local = diagnostics.map((item): FlowProblem => ({
    source: 'local',
    level: normalizeProblemLevel(item.level),
    code: item.code,
    message: item.message,
    from: item.from,
    to: item.to,
  }));
  const service = (validation?.items || []).map((item): FlowProblem => ({
    source: 'service',
    level: normalizeProblemLevel(item.level),
    code: item.code || validation?.kind,
    message: item.message,
    from: item.from,
    to: item.to,
    path: item.path,
    actionName: item.actionName,
    validationItem: item,
  }));
  const connections = connectionIssues.map((item): FlowProblem => ({
    source: 'connections',
    level: normalizeProblemLevel(item.level),
    code: item.code,
    message: item.message,
    path: item.path,
    actionName: item.actionName,
    connectionIssue: item,
  }));
  return [...local, ...service, ...connections].sort((a, b) => problemRank(a.level) - problemRank(b.level));
}

function normalizeProblemLevel(level: string | undefined): FlowProblem['level'] {
  if (level === 'error' || level === 'warning') return level;
  return 'info';
}

function problemRank(level: FlowProblem['level']) {
  if (level === 'error') return 0;
  if (level === 'warning') return 1;
  return 2;
}

export function FlowProblemsPanel(props: { problems: FlowProblem[]; validation: FlowValidationResult | null; onJump: (problem: FlowProblem) => void; toast: ToastFn }) {
  const { problems, validation, onJump, toast } = props;
  const counts = {
    error: problems.filter((item) => item.level === 'error').length,
    warning: problems.filter((item) => item.level === 'warning').length,
    info: problems.filter((item) => item.level === 'info').length,
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>Problems</h3>
          <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
            {counts.error} errors · {counts.warning} warnings · {counts.info} info
            {validation ? ` · service ${validation.kind} checked ${formatDate(validation.checkedAt)}` : ''}
          </div>
        </div>
        {validation ? <CopyButton value={validation.raw} label="Copy raw" title="Copy raw validation response" toast={toast} /> : null}
      </div>
      <div className="fetchxml-diagnostics">
        {problems.length ? problems.slice(0, 80).map((item, index) => (
          <button
            key={index}
            type="button"
            className={`fetchxml-diagnostic ${item.level}`}
            style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onJump(item)}
          >
            <div className="fetchxml-diagnostic-code">
              {item.source}
              {' · '}
              {item.code || item.level.toUpperCase()}
              {item.actionName ? ` · ${item.actionName}` : ''}
              {item.path ? ` · ${item.path}` : ''}
              {item.from !== undefined ? ` @ ${item.from}` : ''}
            </div>
            <div className="fetchxml-diagnostic-message">{item.message}</div>
          </button>
        )) : <div className="empty">No problems.</div>}
      </div>
      {validation ? <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.75rem' }}>Raw response</summary>
        <pre className="viewer" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: highlightJson(validation.raw) }}></pre>
      </details> : null}
    </div>
  );
}
