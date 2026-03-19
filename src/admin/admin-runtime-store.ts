import {
  appendAdminRuntimeLog,
  appendAdminRuntimeStep,
  clearAdminRuntime,
  getAdminRuntimeSnapshot,
  type AdminRuntimeLogEntry,
  type AdminRuntimeSnapshot,
  type AdminRuntimeStepEntry,
  type AdminRuntimeStepStatus,
} from "../api/controllers/admin-runtime";
import { subscribeLogs } from "../interactor/shared/services/logger";
import type { LogEntry } from "../interactor/shared/services/logger";
import { hasBotControlPlaneContext } from "../interactor/shared/utils/user-data-dir";
import { redis } from "./redis/client";

const REDIS_LOGS_KEY = "bot:runtime:logs";
const REDIS_STEPS_KEY = "bot:runtime:steps";

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
const REMOTE_RETRY_DELAY_MS = 5_000;

class AdminRuntimeStore {
  private _logs: AdminRuntimeLogEntry[] = [];
  private _steps: AdminRuntimeStepEntry[] = [];
  private _activeStep: AdminRuntimeStepEntry | null = null;
  private _remoteQueue = Promise.resolve();
  private _lastRemoteFailureAt = 0;

  constructor() {
    subscribeLogs((entry) => {
      this._captureLog(entry);
    });
  }

  async getSnapshot(options?: { logsLimit?: number; stepsLimit?: number }): Promise<AdminRuntimeSnapshot> {
    if (this._shouldTryRemote()) {
      try {
        return await getAdminRuntimeSnapshot(options?.logsLimit, options?.stepsLimit);
      } catch {
        this._markRemoteFailure();
      }
    }

    const logsLimit = this._normalizeLimit(options?.logsLimit, 200, MAX_LOG_ENTRIES);
    const stepsLimit = this._normalizeLimit(options?.stepsLimit, 24, MAX_STEP_ENTRIES);

    if (redis) {
      try {
        const [rawLogs, rawSteps] = await Promise.all([
          redis.lrange(REDIS_LOGS_KEY, 0, logsLimit - 1),
          redis.lrange(REDIS_STEPS_KEY, 0, stepsLimit - 1),
        ]);
        const logs = rawLogs.map((s) => JSON.parse(s) as AdminRuntimeLogEntry);
        const steps = rawSteps.map((s) => JSON.parse(s) as AdminRuntimeStepEntry);
        return { activeStep: this._activeStep, steps, logs };
      } catch {
        // fall through to in-memory
      }
    }

    return {
      activeStep: this._activeStep,
      steps: this._steps.slice(0, stepsLimit),
      logs: this._logs.slice(0, logsLimit),
    };
  }

  async clear() {
    if (this._shouldTryRemote()) {
      try {
        await clearAdminRuntime();
      } catch {
        this._markRemoteFailure();
      }
    }

    if (redis) {
      try {
        await redis.del(REDIS_LOGS_KEY, REDIS_STEPS_KEY);
      } catch {
        // ignore
      }
    }

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
    } else if (this._activeStep && entry.key && this._activeStep.key === entry.key) {
      this._activeStep = null;
    }

    if (redis) {
      const r = redis;
      void r
        .lpush(REDIS_STEPS_KEY, JSON.stringify(entry))
        .then(() => r.ltrim(REDIS_STEPS_KEY, 0, MAX_STEP_ENTRIES - 1))
        .catch(() => undefined);
    }

    this._queueRemote(() => appendAdminRuntimeStep(entry));
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

    if (redis) {
      const r = redis;
      void r
        .lpush(REDIS_LOGS_KEY, JSON.stringify(logEntry))
        .then(() => r.ltrim(REDIS_LOGS_KEY, 0, MAX_LOG_ENTRIES - 1))
        .catch(() => undefined);
    }

    this._queueRemote(() => appendAdminRuntimeLog(logEntry));
  }

  private _queueRemote(task: () => Promise<unknown>) {
    if (!this._shouldTryRemote()) return;

    this._remoteQueue = this._remoteQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this._shouldTryRemote()) return;
        try {
          await task();
          this._lastRemoteFailureAt = 0;
        } catch {
          this._markRemoteFailure();
        }
      });
  }

  private _shouldTryRemote() {
    if (!hasBotControlPlaneContext()) return false;
    if (!this._lastRemoteFailureAt) return true;
    return Date.now() - this._lastRemoteFailureAt >= REMOTE_RETRY_DELAY_MS;
  }

  private _markRemoteFailure() {
    this._lastRemoteFailureAt = Date.now();
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
export type { AdminRuntimeLogEntry, AdminRuntimeStepEntry, AdminRuntimeStepStatus };
