export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  source?: string;
  hint?: string;
  detail?: string;
  path?: string;
}

export interface OperationResult<T> {
  success: boolean;
  data?: T;
  diagnostics: Diagnostic[];
}

export function createDiagnostic(
  level: Diagnostic['level'],
  code: string,
  message: string,
  extra: Omit<Diagnostic, 'level' | 'code' | 'message'> = {},
): Diagnostic {
  return { level, code, message, ...extra };
}

export function ok<T>(data: T, diagnostics: Diagnostic[] = []): OperationResult<T> {
  return { success: true, data, diagnostics };
}

export function fail<T = never>(...diagnostics: Diagnostic[]): OperationResult<T> {
  return { success: false, diagnostics };
}
