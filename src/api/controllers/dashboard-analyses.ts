import { apiGet, apiPost } from "../api-client";

export type AnalysisType = "profile" | "network" | "full";

export type WordRanking = {
  word: string;
  count: number;
};

export type DashboardAnalysis = {
  type: AnalysisType;
  profileWords?: WordRanking[];
  networkWords?: WordRanking[];
  profileUrl?: string;
  connectionsCount?: number;
  createdAt: Date;
};

export async function saveDashboardAnalysis(
  payload: Omit<DashboardAnalysis, "createdAt">
): Promise<DashboardAnalysis> {
  return apiPost<DashboardAnalysis>('/dashboard/analyses', payload);
}

export async function listDashboardAnalyses(limit = 20): Promise<DashboardAnalysis[]> {
  return apiGet<DashboardAnalysis[]>(`/dashboard/analyses?limit=${limit}`);
}

export async function getLatestDashboardAnalysis(type?: AnalysisType): Promise<DashboardAnalysis | null> {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  return apiGet<DashboardAnalysis | null>(`/dashboard/analyses/latest${query}`);
}
