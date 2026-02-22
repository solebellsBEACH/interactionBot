import { apiGet, apiPost } from "../api-client";

export type PromptStatus = "pending" | "answered" | "expired";

export type PromptQueueItem = {
  _id?: string;
  jobId?: string;
  prompt: string;
  options?: string[];
  status: PromptStatus;
  answer?: string | null;
  createdAt: Date;
  answeredAt?: Date;
};

export async function createPrompt(
  jobId: string | undefined,
  prompt: string,
  options?: string[]
): Promise<PromptQueueItem> {
  return apiPost<PromptQueueItem>('/prompts', { jobId, prompt, options });
}

export async function waitForPromptAnswer(
  id: string,
  timeoutMs = 120_000,
  pollMs = 800
): Promise<string | null> {
  const response = await apiGet<{ answer: string | null }>(
    `/prompts/${id}/wait?timeoutMs=${timeoutMs}&pollMs=${pollMs}`,
    timeoutMs + 5_000
  );
  return response?.answer ?? null;
}

export async function answerPrompt(id: string, answer: string) {
  await apiPost(`/prompts/${id}/answer`, { answer });
}

export async function getNextPrompt(jobId?: string): Promise<PromptQueueItem | null> {
  const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : '';
  return apiGet<PromptQueueItem | null>(`/prompts/next${query}`);
}
