import { apiGet, apiPost } from "../api-client";

export type AdminRuntimeStepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "done"
  | "skipped"
  | "error";

export type AdminRuntimeLogEntry = {
  id: string;
  createdAt?: string;
  level: "debug" | "info" | "warn" | "error";
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
  createdAt?: string;
  meta?: Record<string, string>;
};

export type AdminRuntimeSnapshot = {
  activeStep: AdminRuntimeStepEntry | null;
  steps: AdminRuntimeStepEntry[];
  logs: AdminRuntimeLogEntry[];
};

export async function getAdminRuntimeSnapshot(logsLimit = 200, stepsLimit = 24) {
  return apiGet<AdminRuntimeSnapshot>(
    `/admin/runtime?logsLimit=${encodeURIComponent(String(logsLimit))}&stepsLimit=${encodeURIComponent(
      String(stepsLimit)
    )}`
  );
}

export async function appendAdminRuntimeLog(entry: AdminRuntimeLogEntry) {
  return apiPost<AdminRuntimeLogEntry>("/admin/runtime/logs", entry);
}

export async function appendAdminRuntimeStep(entry: AdminRuntimeStepEntry) {
  return apiPost<AdminRuntimeStepEntry>("/admin/runtime/steps", entry);
}

export async function clearAdminRuntime() {
  return apiPost<{ ok: true }>("/admin/runtime/clear", {});
}
