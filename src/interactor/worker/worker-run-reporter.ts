import {
  appendWorkerRunEvent,
  completeWorkerRun,
  failWorkerRun,
  startWorkerRun,
} from "../../api/controllers/worker-runs";
import type { WorkerJob, WorkerJobResult } from "./worker-job";
import { subscribeLogs } from "../shared/services/logger";
import type { LogEntry } from "../shared/services/logger";

export class WorkerRunReporter {
  readonly runId: string;

  private _unsubscribe?: () => void;
  private _remoteDisabled = false;

  constructor(private readonly _job: WorkerJob) {
    this.runId = _job.runId || _job.id || createId();
  }

  async start() {
    await this._safeCall(() =>
      startWorkerRun({
        runId: this.runId,
        jobId: this._job.id,
        type: this._job.type,
        userId: this._job.userId,
        payload: this._job.payload,
      })
    );

    this._unsubscribe = subscribeLogs((entry) => {
      void this._forwardLog(entry);
    });
  }

  async succeed(result: WorkerJobResult) {
    this.stop();
    await this._safeCall(() =>
      completeWorkerRun(this.runId, {
        summary: result.summary,
        output: result.output,
        finishedAt: new Date().toISOString(),
      })
    );
  }

  async fail(error: unknown) {
    this.stop();
    await this._safeCall(() =>
      failWorkerRun(this.runId, {
        error: formatError(error),
        finishedAt: new Date().toISOString(),
      })
    );
  }

  stop() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = undefined;
    }
  }

  private async _forwardLog(entry: LogEntry) {
    const payload =
      entry.context || entry.data !== undefined
        ? stringify({
            ...(entry.context ? { context: entry.context } : {}),
            ...(entry.data === undefined ? {} : { data: entry.data }),
          })
        : undefined;

    await this._safeCall(() =>
      appendWorkerRunEvent(this.runId, {
        level: entry.level,
        message: entry.message,
        createdAt: entry.createdAt,
        ...(payload === undefined ? {} : { data: payload }),
      })
    );
  }

  private async _safeCall(task: () => Promise<unknown>) {
    if (this._remoteDisabled) return;
    try {
      await task();
    } catch {
      this._remoteDisabled = true;
    }
  }
}

const stringify = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return "Erro desconhecido";
};

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
