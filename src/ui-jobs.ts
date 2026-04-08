import { randomUUID } from 'node:crypto';
import type { OperationResult } from './diagnostics.js';

export type UiJobKind = 'account-login';
export type UiJobStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface UiJob<T = unknown> {
  id: string;
  kind: UiJobKind;
  status: UiJobStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  result?: OperationResult<T>;
}

export class UiJobStore {
  private readonly jobs = new Map<string, UiJob>();

  createJob<T>(
    kind: UiJobKind,
    run: (update: (metadata: Record<string, unknown>) => void) => Promise<OperationResult<T>>,
  ): UiJob<T> {
    const now = new Date().toISOString();
    const job: UiJob<T> = {
      id: randomUUID(),
      kind,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    void this.runJob(job.id, run);
    return job;
  }

  getJob(id: string): UiJob | undefined {
    return this.jobs.get(id);
  }

  cancelJob(id: string): UiJob | undefined {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'pending') return job;
    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    return job;
  }

  private async runJob<T>(
    id: string,
    run: (update: (metadata: Record<string, unknown>) => void) => Promise<OperationResult<T>>,
  ): Promise<void> {
    try {
      const result = await run((metadata) => {
        const job = this.jobs.get(id) as UiJob<T> | undefined;
        if (!job || job.status !== 'pending') return;
        job.metadata = { ...(job.metadata ?? {}), ...metadata };
        job.updatedAt = new Date().toISOString();
      });
      const job = this.jobs.get(id) as UiJob<T> | undefined;
      if (!job || job.status === 'cancelled') return;
      job.result = result;
      job.status = result.success ? 'completed' : 'failed';
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      const job = this.jobs.get(id) as UiJob<T> | undefined;
      if (!job || job.status === 'cancelled') return;
      job.status = 'failed';
      job.updatedAt = new Date().toISOString();
      job.result = {
        success: false,
        diagnostics: [{
          level: 'error',
          code: 'UI_JOB_FAILED',
          message: error instanceof Error ? error.message : String(error),
          source: 'pp/ui-jobs',
        }],
      };
    }
  }
}
