import { apiDelete, apiGet, apiPost } from "../api-client";

export type GptInteractionSource = "responses" | "chat.completions";

export type GptInteraction = {
  _id?: string;
  fieldType: "input" | "select";
  fieldKey?: string;
  fieldLabel?: string | null;
  step?: number;
  prompt: string;
  answer?: string | null;
  model: string;
  source: GptInteractionSource;
  success: boolean;
  error?: string;
  durationMs?: number;
  createdAt: Date;
};

export async function saveGptInteraction(
  payload: Omit<GptInteraction, "_id" | "createdAt">
): Promise<GptInteraction> {
  return apiPost<GptInteraction>("/gpt-interactions", payload);
}

export async function listGptInteractions(limit = 50): Promise<GptInteraction[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  try {
    return await apiGet<GptInteraction[]>(`/gpt-interactions?limit=${safeLimit}`);
  } catch {
    return [];
  }
}

export async function clearGptInteractions(): Promise<number> {
  try {
    const response = await apiDelete<{ deletedCount?: number }>("/gpt-interactions?all=true");
    return response?.deletedCount || 0;
  } catch {
    return 0;
  }
}
