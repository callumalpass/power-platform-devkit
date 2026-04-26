import { useEffect, useState } from 'react';
import { api } from '../utils.js';
import { RecordDetailModal, useRecordDetail } from '../RecordDetailModal.js';
import type { ToastFn } from '../ui-types.js';

type AccessData = {
  userId?: string;
  businessUnitId?: string;
  user?: {
    fullname?: string;
    domainname?: string;
    internalemailaddress?: string;
    azureactivedirectoryobjectid?: string;
    businessunitid?: string;
  };
  roles?: Array<{ name: string; roleid: string }>;
  teams?: Array<{ name: string; teamid: string; roles?: Array<{ name: string; roleid: string }> }>;
  graph?: {
    displayName?: string;
    jobTitle?: string;
    department?: string;
    officeLocation?: string;
    mail?: string;
    manager?: string;
    licenses?: string[];
  };
};

export function AccessPanel(props: { active: boolean; environment: string; toast: ToastFn }) {
  const { active, environment, toast } = props;
  const [data, setData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = useRecordDetail();

  async function dvGet(path: string) {
    const result = await api<any>('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment, api: 'dv', method: 'GET', path, headers: { Prefer: 'odata.include-annotations="*"' }, allowInteractive: false, softFail: true })
    });
    return result.data?.response;
  }

  async function graphGet(path: string) {
    const result = await api<any>('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment, api: 'graph', method: 'GET', path, allowInteractive: false, softFail: true })
    });
    return result.data?.response;
  }

  async function graphGetOptional(path: string) {
    const result = await api<any>('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment, api: 'graph', method: 'GET', path, allowInteractive: false, softFail: true }),
      allowFailure: true
    });
    return result.success === false ? null : result.data?.response;
  }

  async function loadAccess() {
    if (!environment) {
      toast('Select an environment first.', true);
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const whoami = await dvGet('/WhoAmI');
      const userId = whoami?.UserId;
      const businessUnitId = whoami?.BusinessUnitId;
      if (!userId) throw new Error('Could not determine current user.');

      const [user, rolesResult, teamsResult] = await Promise.all([
        dvGet(`/systemusers(${userId})?$select=fullname,domainname,internalemailaddress,azureactivedirectoryobjectid`),
        dvGet(`/systemusers(${userId})/systemuserroles_association?$select=name,roleid`),
        dvGet(`/systemusers(${userId})/teammembership_association?$select=name,teamid`)
      ]);

      const roles: NonNullable<AccessData['roles']> = Array.isArray(rolesResult?.value) ? rolesResult.value.map((r: any) => ({ name: r.name, roleid: r.roleid })) : [];
      const teams: NonNullable<AccessData['teams']> = Array.isArray(teamsResult?.value) ? teamsResult.value.map((t: any) => ({ name: t.name, teamid: t.teamid })) : [];

      await Promise.all(
        teams.map(async (team) => {
          try {
            const teamRolesResult = await dvGet(`/teams(${team.teamid})/teamroles_association?$select=name,roleid`);
            team.roles = Array.isArray(teamRolesResult?.value) ? teamRolesResult.value.map((r: any) => ({ name: r.name, roleid: r.roleid })) : [];
          } catch {
            team.roles = [];
          }
        })
      );

      let graph: AccessData['graph'] | undefined;
      try {
        const [me, managerResult, licensesResult] = await Promise.all([
          graphGet('/me?$select=displayName,jobTitle,department,officeLocation,mail'),
          graphGetOptional('/me/manager?$select=displayName'),
          graphGetOptional('/me/licenseDetails')
        ]);
        graph = {
          displayName: me?.displayName,
          jobTitle: me?.jobTitle,
          department: me?.department,
          officeLocation: me?.officeLocation,
          mail: me?.mail,
          manager: managerResult?.displayName,
          licenses: Array.isArray(licensesResult?.value) ? licensesResult.value.map((l: any) => l.skuPartNumber).filter(Boolean) : []
        };
      } catch {
        // Graph not available — that's fine
      }

      setData({ userId, businessUnitId, user, roles, teams, graph });
      toast('Access data loaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active && environment) void loadAccess();
  }, [active, environment]);

  if (!environment) {
    return (
      <div className="panel">
        <p className="desc">Select an environment to view your access.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="panel">
        <div className="rt-modal-loading">Loading access data...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="panel">
        <div className="rt-modal-error">{error}</div>
        <button className="btn btn-primary" type="button" style={{ marginTop: 12 }} onClick={() => void loadAccess()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const allRoleNames = new Set<string>();
  for (const r of data.roles || []) allRoleNames.add(r.name);
  for (const t of data.teams || []) for (const r of t.roles || []) allRoleNames.add(r.name);

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>Identity</h2>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadAccess()}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="metrics">
          {[
            ['Name', data.user?.fullname, undefined, undefined],
            ['UPN', data.user?.domainname, undefined, undefined],
            ['Email', data.user?.internalemailaddress, undefined, undefined],
            ['User ID', data.userId, 'systemuser', 'systemusers'],
            ['Business Unit', data.businessUnitId, 'businessunit', 'businessunits']
          ].map(([label, value, entity, entitySet]) => (
            <div key={String(label)} className="metric">
              <div className="metric-label">{label}</div>
              <div className="metric-value">
                {value && entity ? (
                  <span className="record-link" onClick={() => detail.open(String(entity), String(entitySet), String(value))}>
                    {String(value).slice(0, 8)}...
                  </span>
                ) : (
                  value || '-'
                )}
              </div>
            </div>
          ))}
        </div>
        {data.graph ? (
          <>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8, marginTop: 16 }}>Azure AD</h3>
            <div className="metrics">
              {[
                ['Job Title', data.graph.jobTitle],
                ['Department', data.graph.department],
                ['Office', data.graph.officeLocation],
                ['Manager', data.graph.manager]
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={String(label)} className="metric">
                    <div className="metric-label">{label}</div>
                    <div className="metric-value">{value}</div>
                  </div>
                ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="panel">
        <h2>Security Roles ({allRoleNames.size})</h2>
        <p className="desc">All security roles for your user, including roles inherited from teams.</p>

        {(data.roles?.length ?? 0) > 0 ? (
          <>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>Direct Roles</h3>
            <div className="card-list" style={{ marginBottom: 16 }}>
              {data.roles!.map((role) => (
                <div key={role.roleid} className="card-item" style={{ cursor: 'pointer' }} onClick={() => detail.open('role', 'roles', role.roleid)}>
                  <span style={{ fontWeight: 500, fontSize: '0.8125rem' }}>{role.name}</span>
                  <span className="record-link" style={{ fontFamily: 'var(--mono)', fontSize: '0.6875rem' }}>
                    {role.roleid.slice(0, 8)}...
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="desc">No roles directly assigned to your user.</p>
        )}
      </div>

      <div className="panel">
        <h2>Teams ({data.teams?.length || 0})</h2>
        <p className="desc">Team memberships and their associated security roles.</p>
        {(data.teams?.length ?? 0) > 0 ? (
          <div className="card-list">
            {data.teams!.map((team) => (
              <div key={team.teamid} className="access-team-card">
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: team.roles?.length ? 8 : 0, cursor: 'pointer' }}
                  onClick={() => detail.open('team', 'teams', team.teamid)}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{team.name}</span>
                  <span className="record-link" style={{ fontFamily: 'var(--mono)', fontSize: '0.6875rem' }}>
                    {team.teamid.slice(0, 8)}...
                  </span>
                </div>
                {team.roles?.length ? (
                  <div className="access-team-roles">
                    {team.roles.map((role) => (
                      <span
                        key={role.roleid}
                        className="badge"
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          detail.open('role', 'roles', role.roleid);
                        }}
                      >
                        {role.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>No roles</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="desc">No team memberships found.</p>
        )}
      </div>

      {data.graph?.licenses?.length ? (
        <div className="panel">
          <h2>Licenses</h2>
          <p className="desc">Microsoft 365 license assignments from Azure AD.</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.graph.licenses.map((sku) => (
              <span key={sku} className="badge">
                {sku}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {detail.target && environment && <RecordDetailModal initial={detail.target} environment={environment} onClose={detail.close} toast={toast} />}
    </>
  );
}
