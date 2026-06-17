import type { EnvironmentStatusSummary } from './desktop-status.js';

export function EnvironmentStatusButton(props: { summary: EnvironmentStatusSummary; onOpen: () => void; onRecheck: () => void }) {
  const { summary, onOpen, onRecheck } = props;
  const dotClass = summary.level === 'warning' ? 'pending' : summary.level;
  return (
    <div className={`env-status ${summary.level}`}>
      <button type="button" className="env-status-main" onClick={onOpen} title={summary.detail}>
        <span className={`health-dot ${dotClass}`} />
        <span className="env-status-copy">
          <span className="env-status-label">{summary.label}</span>
          <span className="env-status-detail">{summary.detail}</span>
        </span>
      </button>
      <button type="button" className="env-status-recheck" onClick={onRecheck} title="Re-check active environment">
        Re-check
      </button>
    </div>
  );
}
