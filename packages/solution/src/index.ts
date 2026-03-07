import { ok, type OperationResult } from '@pp/diagnostics';
import { DataverseClient } from '@pp/dataverse';

export interface SolutionSummary {
  solutionid: string;
  uniquename: string;
  friendlyname?: string;
  version?: string;
}

export class SolutionService {
  constructor(private readonly dataverseClient: DataverseClient) {}

  async list(): Promise<OperationResult<SolutionSummary[]>> {
    return this.dataverseClient.query<SolutionSummary>({
      table: 'solutions',
      select: ['solutionid', 'uniquename', 'friendlyname', 'version'],
      top: 100,
    });
  }

  async inspect(uniqueName: string): Promise<OperationResult<SolutionSummary | undefined>> {
    const solutions = await this.dataverseClient.query<SolutionSummary>({
      table: 'solutions',
      select: ['solutionid', 'uniquename', 'friendlyname', 'version'],
      filter: `uniquename eq '${uniqueName}'`,
      top: 1,
    });

    if (!solutions.success) {
      return solutions as unknown as OperationResult<SolutionSummary | undefined>;
    }

    return ok(solutions.data?.[0], {
      supportTier: 'preview',
      diagnostics: solutions.diagnostics,
      warnings: solutions.warnings,
    });
  }
}
