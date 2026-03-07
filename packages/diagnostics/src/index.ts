export type DiagnosticLevel = 'error' | 'warning' | 'info';
export type SupportTier = 'stable' | 'preview' | 'experimental';
export type ProvenanceClass = 'official-api' | 'official-artifact' | 'harvested' | 'inferred';

export interface ProvenanceRecord {
  kind: ProvenanceClass;
  source: string;
  detail?: string;
}

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  source?: string;
  path?: string;
  hint?: string;
  detail?: string;
}

export interface OperationResult<T> {
  success: boolean;
  data?: T;
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
  suggestedNextActions?: string[];
  supportTier: SupportTier;
  provenance?: ProvenanceRecord[];
  knownLimitations?: string[];
}

export interface ResultOptions {
  supportTier?: SupportTier;
  suggestedNextActions?: string[];
  provenance?: ProvenanceRecord[];
  knownLimitations?: string[];
}

export function createDiagnostic(
  level: DiagnosticLevel,
  code: string,
  message: string,
  options: Omit<Diagnostic, 'level' | 'code' | 'message'> = {}
): Diagnostic {
  return {
    level,
    code,
    message,
    ...options,
  };
}

export function ok<T>(data: T, options: ResultOptions & { diagnostics?: Diagnostic[]; warnings?: Diagnostic[] } = {}): OperationResult<T> {
  return {
    success: true,
    data,
    diagnostics: options.diagnostics ?? [],
    warnings: options.warnings ?? [],
    suggestedNextActions: options.suggestedNextActions,
    supportTier: options.supportTier ?? 'preview',
    provenance: options.provenance,
    knownLimitations: options.knownLimitations,
  };
}

export function fail<T = never>(
  diagnostics: Diagnostic | Diagnostic[],
  options: ResultOptions & { warnings?: Diagnostic[] } = {}
): OperationResult<T> {
  const diagnosticList = Array.isArray(diagnostics) ? diagnostics : [diagnostics];

  return {
    success: false,
    diagnostics: diagnosticList,
    warnings: options.warnings ?? [],
    suggestedNextActions: options.suggestedNextActions,
    supportTier: options.supportTier ?? 'preview',
    provenance: options.provenance,
    knownLimitations: options.knownLimitations,
  };
}

export function mergeDiagnostics(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
}

export function mapResult<T, U>(result: OperationResult<T>, mapper: (value: T) => U): OperationResult<U> {
  if (!result.success || result.data === undefined) {
    return result as unknown as OperationResult<U>;
  }

  return {
    ...result,
    data: mapper(result.data),
  };
}

export function withWarning<T>(result: OperationResult<T>, warning: Diagnostic): OperationResult<T> {
  return {
    ...result,
    warnings: [...result.warnings, warning],
  };
}

export function ensureValue<T>(
  value: T | undefined,
  diagnostic: Diagnostic,
  options: ResultOptions = {}
): OperationResult<T> {
  if (value === undefined) {
    return fail(diagnostic, options);
  }

  return ok(value, options);
}
