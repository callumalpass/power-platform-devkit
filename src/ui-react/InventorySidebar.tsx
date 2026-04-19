import type { ReactNode } from 'react';

type Props<T> = {
  title: string;
  countLabel: string;
  items: T[];
  filter: string;
  onFilterChange: (next: string) => void;
  filterPlaceholder: string;
  matchItem: (item: T, query: string) => boolean;
  isSelected: (item: T) => boolean;
  itemKey: (item: T) => string;
  onSelect: (item: T) => void;
  renderItem: (item: T) => ReactNode;
  onRefresh: () => void;
  emptyHint: string;
};

export function InventorySidebar<T>(props: Props<T>) {
  const filtered = props.filter
    ? props.items.filter((item) => props.matchItem(item, props.filter.toLowerCase()))
    : props.items;

  return (
    <div className="inventory-sidebar">
      <div className="panel inventory-panel">
        <div className="inventory-header">
          <h2>{props.title}</h2>
          <button className="btn btn-ghost btn-sm" type="button" onClick={props.onRefresh}>Refresh</button>
        </div>
        <input
          type="text"
          className="entity-filter"
          placeholder={props.filterPlaceholder}
          value={props.filter}
          onChange={(event) => props.onFilterChange(event.target.value)}
        />
        <div className="entity-count">{props.items.length ? `${filtered.length} of ${props.items.length} ${props.countLabel}` : ''}</div>
        <div className="entity-list">
          {props.items.length ? filtered.length ? filtered.map((item) => (
            <button
              type="button"
              key={props.itemKey(item)}
              className={`entity-item ${props.isSelected(item) ? 'active' : ''}`}
              aria-pressed={props.isSelected(item)}
              onClick={() => props.onSelect(item)}
            >
              {props.renderItem(item)}
            </button>
          )) : <div className="entity-loading">No matches.</div> : (
            <div className="entity-loading">{props.emptyHint}</div>
          )}
        </div>
      </div>
    </div>
  );
}
