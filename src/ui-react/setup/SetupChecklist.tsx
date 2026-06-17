import { buildSetupChecklist } from '../desktop-status.js';
import type { HealthMap, SetupAccount, SetupEnvironment, SetupSubTab, TokenStatusMap } from './types.js';

export function SetupChecklist(props: {
  accounts: SetupAccount[];
  environments: SetupEnvironment[];
  tokenStatus: TokenStatusMap;
  health: HealthMap;
  onJump: (tab: SetupSubTab) => void;
  onRecheck: () => void;
}) {
  const { accounts, environments, tokenStatus, health, onJump, onRecheck } = props;
  const items = buildSetupChecklist(accounts, environments, tokenStatus, health);
  return (
    <section className="setup-checklist" aria-label="Setup checklist">
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          className={`setup-checklist-item ${item.level}`}
          aria-label={`Task ${index + 1}: ${item.detail}`}
          onClick={() => {
            if (item.action === 'recheck') onRecheck();
            else if (item.action) onJump(item.action);
          }}
        >
          <span className={`health-dot ${item.level === 'warning' ? 'pending' : item.level}`} />
          <span className="setup-checklist-copy">
            <span className="setup-checklist-title">{item.title}</span>
            <span className="setup-checklist-detail">{item.detail}</span>
          </span>
        </button>
      ))}
    </section>
  );
}
