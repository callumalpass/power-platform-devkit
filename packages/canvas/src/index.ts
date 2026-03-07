import { createDiagnostic, ok, withWarning, type OperationResult } from '@pp/diagnostics';

export interface CanvasBuildRequest {
  path: string;
}

export interface CanvasBuildSummary {
  path: string;
  mode: 'strict' | 'seeded' | 'registry';
  supported: boolean;
}

export class CanvasService {
  async inspect(path: string): Promise<OperationResult<CanvasBuildSummary>> {
    return withWarning(
      ok(
        {
          path,
          mode: 'strict',
          supported: false,
        },
        {
          supportTier: 'preview',
        }
      ),
      createDiagnostic(
        'warning',
        'CANVAS_IMPLEMENTATION_PENDING',
        'Canvas build and inspect are scaffolded but not implemented yet.',
        {
          source: '@pp/canvas',
        }
      )
    );
  }
}
