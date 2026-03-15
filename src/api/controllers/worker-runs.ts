import { apiPost } from "../api-client";

export type WorkerRunStatus = "running" | "succeeded" | "failed";
export type WorkerRunEventLevel = "debug" | "info" | "warn" | "error";

export type WorkerRunEvent = {
  level: WorkerRunEventLevel;
  message: string;
  createdAt?: string;
  data?: string;
};

export async function startWorkerRun(payload: {
  runId: string;
  jobId?: string;
  type: string;
  userId?: string;
  payload?: Record<string, unknown>;
}) {
  return apiPost("/worker-runs/start", payload);
}

export async function completeWorkerRun(
  runId: string,
  payload: {
    summary: string;
    output?: unknown;
    finishedAt?: string;
  }
) {
  return apiPost(`/worker-runs/${encodeURIComponent(runId)}/complete`, payload);
}

export async function failWorkerRun(
  runId: string,
  payload: {
    error: string;
    finishedAt?: string;
  }
) {
  return apiPost(`/worker-runs/${encodeURIComponent(runId)}/fail`, payload);
}

export async function appendWorkerRunEvent(runId: string, event: WorkerRunEvent) {
  return apiPost(`/worker-runs/${encodeURIComponent(runId)}/events`, event);
}
