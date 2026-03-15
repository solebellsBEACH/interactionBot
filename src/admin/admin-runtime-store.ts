import { subscribeLogs } from "../interactor/shared/services/logger";
import type { LogEntry, LogLevel } from "../interactor/shared/services/logger";

export type AdminRuntimeStepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "done"
  | "skipped"
  | "error";

export type AdminRuntimeLogEntry = {
  id: string;
  createdAt: string;
  level: LogLevel;
  scope?: string;
  message: string;
  data?: string;
};

export type AdminRuntimeStepEntry = {
  id: string;
  key?: string;
  source: string;
  label: string;
  detail?: string;
  status: AdminRuntimeStepStatus;
  createdAt: string;
  meta?: Record<string, string>;
};

type RecordStepInput = {
  key?: string;
  source: string;
  label: string;
  detail?: string;
  status: AdminRuntimeStepStatus;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

const MAX_LOG_ENTRIES = 500;
const MAX_STEP_ENTRIES = 160;

class AdminRuntimeStore {
  private _logs: AdminRuntimeLogEntry[] = [];
  private _steps: AdminRuntimeStepEntry[] = [];
  private _activeStep: AdminRuntimeStepEntry | null = null;

  constructor() {
    subscribeLogs((entry) => {
      this._captureLog(entry);
    });
  }

  getSnapshot(options?: { logsLimit?: number; stepsLimit?: number }) {
    const logsLimit = this._normalizeLimit(options?.logsLimit, 200, MAX_LOG_ENTRIES);
    const stepsLimit = this._normalizeLimit(options?.stepsLimit, 24, MAX_STEP_ENTRIES);

    return {
      activeStep: this._activeStep,
      steps: this._steps.slice(0, stepsLimit),
      logs: this._logs.slice(0, logsLimit),
    };
  }

  clear() {
    this._logs = [];
    this._steps = [];
    this._activeStep = null;
  }

  recordStep(input: RecordStepInput) {
    const entry: AdminRuntimeStepEntry = {
      id: this._createId(),
      ...(input.key ? { key: input.key } : {}),
      source: input.source,
      label: input.label,
      ...(input.detail ? { detail: input.detail } : {}),
      status: input.status,
      createdAt: new Date().toISOString(),
      ...(input.meta ? { meta: this._normalizeMeta(input.meta) } : {}),
    };

    this._steps = [entry, ...this._steps].slice(0, MAX_STEP_ENTRIES);

    if (entry.status === "pending" || entry.status === "running" || entry.status === "waiting") {
      this._activeStep = entry;
      return entry;
    }

    if (this._activeStep && entry.key && this._activeStep.key === entry.key) {
      this._activeStep = null;
    }

    return entry;
  }

  private _captureLog(entry: LogEntry) {
    const logEntry: AdminRuntimeLogEntry = {
      id: entry.id,
      createdAt: entry.createdAt,
      level: entry.level,
      ...(entry.scope ? { scope: entry.scope } : {}),
      message: entry.message,
      ...(entry.data === undefined ? {} : { data: this._stringify(entry.data) }),
    };

    this._logs = [logEntry, ...this._logs].slice(0, MAX_LOG_ENTRIES);
  }

  private _normalizeLimit(value: number | undefined, fallback: number, max: number) {
    if (!Number.isFinite(value)) return fallback;
    const normalized = Math.trunc(value || fallback);
    if (normalized <= 0) return fallback;
    return Math.min(normalized, max);
  }

  private _normalizeMeta(meta: Record<string, string | number | boolean | null | undefined>) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(meta)) {
      if (value === undefined) continue;
      result[key] = String(value);
    }
    return result;
  }

  private _stringify(value: unknown) {
    if (value === undefined) return undefined;
    if (typeof value === "string") {
      return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
    }

    try {
      const serialized = JSON.stringify(value, null, 2);
      return serialized.length > 4000 ? `${serialized.slice(0, 4000)}...` : serialized;
    } catch {
      const fallback = String(value);
      return fallback.length > 4000 ? `${fallback.slice(0, 4000)}...` : fallback;
    }
  }

  private _createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export const adminRuntimeStore = new AdminRuntimeStore();
