import type { ReactNode } from 'react';

export function PanelHeader(props: { title: string; description?: ReactNode; actions?: ReactNode }) {
  const { title, description, actions } = props;
  return (
    <div className="panel-header">
      <div className="panel-header-copy">
        <h2>{title}</h2>
        {description ? <p className="desc">{description}</p> : null}
      </div>
      {actions ? <div className="panel-header-actions">{actions}</div> : null}
    </div>
  );
}
