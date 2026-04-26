export type TabName = 'setup' | 'console' | 'dataverse' | 'automate' | 'apps' | 'canvas' | 'platform';

const TAB_LABELS: Record<TabName, string> = {
  setup: 'setup',
  console: 'console',
  dataverse: 'dataverse',
  automate: 'automate',
  apps: 'apps',
  canvas: 'canvas',
  platform: 'platform'
};

const TAB_ORDER: TabName[] = ['setup', 'console', 'dataverse', 'automate', 'apps', 'canvas', 'platform'];
const SETUP_TAB_ORDER: TabName[] = ['setup'];

export function currentTabFromHash(tabs: readonly TabName[] = TAB_ORDER, fallback: TabName = 'dataverse'): TabName {
  const hash = window.location.hash.slice(1);
  return isTabName(hash, tabs) ? hash : fallback;
}

export function PrimaryTabs(props: { activeTab: TabName; setActiveTab: (tab: TabName) => void; tabs?: readonly TabName[] }) {
  const tabs = props.tabs ?? TAB_ORDER;
  return (
    <nav className="tabs">
      <div className="tabs-inner">
        {tabs.map((tabName, index) => (
          <FragmentTab key={tabName} index={index} tabs={tabs} tabName={tabName} activeTab={props.activeTab} setActiveTab={props.setActiveTab} />
        ))}
      </div>
    </nav>
  );
}

function isTabName(value: string, tabs: readonly TabName[] = TAB_ORDER): value is TabName {
  return tabs.includes(value as TabName);
}

function tabNumber(tabName: TabName, tabs: readonly TabName[]): string {
  const n = tabs.indexOf(tabName) + 1;
  return n.toString().padStart(2, '0');
}

function FragmentTab(props: { index: number; tabs: readonly TabName[]; tabName: TabName; activeTab: TabName; setActiveTab: (tab: TabName) => void }) {
  const { index, tabs, tabName, activeTab, setActiveTab } = props;
  const needsSep = tabs.length > 2 && index === 2;
  const number = tabNumber(tabName, tabs);
  return (
    <>
      {needsSep ? <div className="tab-sep"></div> : null}
      <button className={`tab ${activeTab === tabName ? 'active' : ''}`} data-tab={tabName} onClick={() => setActiveTab(tabName)} title={`${TAB_LABELS[tabName]} (Alt+${tabs.indexOf(tabName) + 1})`}>
        <span className="tab-num" aria-hidden="true">
          {number}
        </span>
        <span className="tab-label">{TAB_LABELS[tabName]}</span>
      </button>
    </>
  );
}

export { SETUP_TAB_ORDER, TAB_ORDER };
