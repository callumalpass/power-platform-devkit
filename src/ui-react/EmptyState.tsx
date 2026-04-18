import type { ReactNode } from 'react';

type Props = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
};

export function EmptyState({ icon, title, description, action, compact }: Props) {
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}>
      {icon ? <div className="empty-state-icon" aria-hidden="true">{icon}</div> : null}
      <div className="empty-state-title">{title}</div>
      {description ? <div className="empty-state-desc">{description}</div> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
