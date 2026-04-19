export type TabName = 'setup' | 'console' | 'dataverse' | 'automate' | 'apps' | 'canvas' | 'platform';

const TAB_LABELS: Record<TabName, string> = {
  setup: 'setup',
  console: 'console',
  dataverse: 'dataverse',
  automate: 'automate',
  apps: 'apps',
  canvas: 'canvas',
  platform: 'platform',
};

const TAB_ORDER: TabName[] = ['setup', 'console', 'dataverse', 'automate', 'apps', 'canvas', 'platform'];

export function currentTabFromHash(): TabName {
  const hash = window.location.hash.slice(1);
  return isTabName(hash) ? hash : 'dataverse';
}

export function PrimaryTabs(props: { activeTab: TabName; setActiveTab: (tab: TabName) => void }) {
  return (
    <nav className="tabs">
      <div className="tabs-inner">
        {TAB_ORDER.map((tabName, index) => (
          <FragmentTab
            key={tabName}
            index={index}
            tabName={tabName}
            activeTab={props.activeTab}
            setActiveTab={props.setActiveTab}
          />
        ))}
      </div>
    </nav>
  );
}

function isTabName(value: string): value is TabName {
  return TAB_ORDER.includes(value as TabName);
}

function tabNumber(tabName: TabName): string {
  const n = TAB_ORDER.indexOf(tabName) + 1;
  return n.toString().padStart(2, '0');
}

function FragmentTab(props: { index: number; tabName: TabName; activeTab: TabName; setActiveTab: (tab: TabName) => void }) {
  const { index, tabName, activeTab, setActiveTab } = props;
  const needsSep = index === 2;
  const number = tabNumber(tabName);
  return (
    <>
      {needsSep ? <div className="tab-sep"></div> : null}
      <button
        className={`tab ${activeTab === tabName ? 'active' : ''}`}
        data-tab={tabName}
        onClick={() => setActiveTab(tabName)}
        title={`${TAB_LABELS[tabName]} (Alt+${TAB_ORDER.indexOf(tabName) + 1})`}
      >
        <span className="tab-num" aria-hidden="true">{number}</span>
        <span className="tab-label">{TAB_LABELS[tabName]}</span>
      </button>
    </>
  );
}

export { TAB_ORDER };
