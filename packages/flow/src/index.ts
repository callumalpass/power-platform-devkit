import { createDiagnostic, ok, withWarning, type OperationResult } from '@pp/diagnostics';

export interface FlowArtifactSummary {
  path: string;
  normalized: boolean;
}

export class FlowService {
  async inspect(path: string): Promise<OperationResult<FlowArtifactSummary>> {
    return withWarning(
      ok(
        {
          path,
          normalized: false,
        },
        {
          supportTier: 'preview',
        }
      ),
      createDiagnostic('warning', 'FLOW_IMPLEMENTATION_PENDING', 'Flow inspection is scaffolded but not implemented yet.', {
        source: '@pp/flow',
      })
    );
  }
}
