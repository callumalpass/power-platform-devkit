import { randomUUID } from 'node:crypto';
export class UiJobStore {
    jobs = new Map();
    createJob(kind, run) {
        const now = new Date().toISOString();
        const job = {
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
    getJob(id) {
        return this.jobs.get(id);
    }
    cancelJob(id) {
        const job = this.jobs.get(id);
        if (!job || job.status !== 'pending')
            return job;
        job.status = 'cancelled';
        job.updatedAt = new Date().toISOString();
        return job;
    }
    async runJob(id, run) {
        try {
            const result = await run((metadata) => {
                const job = this.jobs.get(id);
                if (!job || job.status !== 'pending')
                    return;
                job.metadata = { ...(job.metadata ?? {}), ...metadata };
                job.updatedAt = new Date().toISOString();
            });
            const job = this.jobs.get(id);
            if (!job || job.status === 'cancelled')
                return;
            job.result = result;
            job.status = result.success ? 'completed' : 'failed';
            job.updatedAt = new Date().toISOString();
        }
        catch (error) {
            const job = this.jobs.get(id);
            if (!job || job.status === 'cancelled')
                return;
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
