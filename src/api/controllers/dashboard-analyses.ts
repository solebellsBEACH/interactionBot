import { WithId } from "mongodb";
import { getCollection } from "../database";

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

const COLLECTION = "dashboard-analyses";

export async function saveDashboardAnalysis(
  payload: Omit<DashboardAnalysis, "createdAt">
): Promise<WithId<DashboardAnalysis>> {
  const collection = await getCollection<DashboardAnalysis>(COLLECTION);
  const document: DashboardAnalysis = {
    ...payload,
    createdAt: new Date(),
  };

  const { insertedId } = await collection.insertOne(document);
  return { ...document, _id: insertedId };
}

export async function listDashboardAnalyses(limit = 20): Promise<WithId<DashboardAnalysis>[]> {
  const collection = await getCollection<DashboardAnalysis>(COLLECTION);
  return collection.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function getLatestDashboardAnalysis(type?: AnalysisType): Promise<WithId<DashboardAnalysis> | null> {
  const collection = await getCollection<DashboardAnalysis>(COLLECTION);
  const query = type ? { type } : {};
  return collection.find(query).sort({ createdAt: -1 }).limit(1).next();
}
