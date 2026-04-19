const ENV_RECENCY_KEY = 'pp-env-recency';

export function readEnvironmentRecency(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(ENV_RECENCY_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function touchEnvironmentRecency(alias: string) {
  if (!alias) return;
  try {
    const current = readEnvironmentRecency();
    current[alias] = Date.now();
    localStorage.setItem(ENV_RECENCY_KEY, JSON.stringify(current));
  } catch {
    // ignore quota errors
  }
}
