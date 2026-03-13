import { apiDelete, apiGet, apiPatch, apiPost } from "../api-client";

export type ApplicationStatus = "applied" | "interview" | "offer" | "rejected";

export type Application = {
  _id?: string;
  title: string;
  company: string;
  status: ApplicationStatus;
  link?: string;
  appliedAt?: Date;
  notes?: string;
};

export async function createApplication(payload: Omit<Application, "_id">) {
  return apiPost<Application>('/applications', payload);
}

export async function listApplications() {
  return apiGet<Application[]>('/applications');
}

export async function updateApplication(id: string, updates: Partial<Application>) {
  return apiPatch<Application | null>(`/applications/${id}`, updates);
}

export async function deleteApplication(id: string) {
  await apiDelete(`/applications/${id}`);
}

export async function clearApplications() {
  try {
    const response = await apiDelete<{ deletedCount?: number }>("/applications?all=true");
    return response?.deletedCount || 0;
  } catch {
    return 0;
  }
}
