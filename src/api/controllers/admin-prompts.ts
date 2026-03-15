import { apiGet, apiPost } from "../api-client";

export type AdminPromptKind = "confirm-gpt" | "answer-field";
export type AdminPromptFieldType = "input" | "select";
export type AdminPromptAction = "confirm" | "manual" | "skip" | "cancel" | "timeout";

export type AdminPromptRequest = {
  id?: string;
  kind: AdminPromptKind;
  createdAt?: string;
  step: number;
  fieldLabel: string;
  fieldKey?: string;
  fieldType: AdminPromptFieldType;
  prompt: string;
  suggestedAnswer?: string;
  options?: string[];
  timeoutMs?: number;
};

export type AdminPromptItem = {
  id: string;
  kind: AdminPromptKind;
  createdAt: string;
  step: number;
  fieldLabel: string;
  fieldKey?: string;
  fieldType: AdminPromptFieldType;
  prompt: string;
  suggestedAnswer?: string;
  options?: string[];
  status?: "pending" | "resolved" | "expired";
  timeoutAt?: string;
  responseAction?: AdminPromptAction;
  responseValue?: string | null;
  resolvedAt?: string;
};

export type AdminPromptResponse = {
  action: AdminPromptAction;
  value?: string | null;
};

export type AdminPromptSettings = {
  autoConfirmGpt: boolean;
  autoConfirmDelayMs: number;
};

export async function getAdminPromptState() {
  return apiGet<{ item: AdminPromptItem | null; settings: AdminPromptSettings }>("/admin/prompts/current");
}

export async function requestAdminPrompt(payload: AdminPromptRequest) {
  return apiPost<{ item: AdminPromptItem }>("/admin/prompts/request", payload);
}

export async function waitForAdminPromptAnswer(
  id: string,
  timeoutMs = 120_000,
  pollMs = 800
) {
  return apiGet<AdminPromptResponse>(
    `/admin/prompts/${encodeURIComponent(id)}/wait?timeoutMs=${encodeURIComponent(
      String(timeoutMs)
    )}&pollMs=${encodeURIComponent(String(pollMs))}`,
    timeoutMs + 5_000
  );
}

export async function answerAdminPrompt(id: string, response: AdminPromptResponse) {
  return apiPost<{ item: AdminPromptItem }>("/admin/prompts/respond", {
    id,
    action: response.action,
    value: response.value ?? null,
  });
}

export async function updateAdminPromptSettings(payload: Partial<AdminPromptSettings>) {
  return apiPost<{ settings: AdminPromptSettings }>("/admin/prompts/settings", payload);
}
