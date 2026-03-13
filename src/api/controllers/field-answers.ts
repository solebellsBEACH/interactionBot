import { apiDelete, apiGet } from "../api-client";

export type FieldAnswer = {
  _id?: string;
  key: string;
  label?: string | null;
  value: string;
  source: "input" | "select";
  jobUrl?: string;
  lastUsedAt: Date;
};

export async function getFieldAnswer(key: string, label?: string | null): Promise<FieldAnswer | null> {
  const params = new URLSearchParams();
  if (key) params.set('key', key);
  if (label) params.set('label', label);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiGet<FieldAnswer | null>(`/field-answers${query}`);
}

export async function clearFieldAnswers(): Promise<number> {
  try {
    const response = await apiDelete<{ deletedCount?: number }>("/field-answers?all=true");
    return response?.deletedCount || 0;
  } catch {
    return 0;
  }
}
