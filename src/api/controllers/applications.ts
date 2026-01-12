import { ObjectId } from "mongodb";
import { getCollection } from "../database";

export type ApplicationStatus = "applied" | "interview" | "offer" | "rejected";

export type Application = {
  _id?: ObjectId;
  title: string;
  company: string;
  status: ApplicationStatus;
  link?: string;
  appliedAt?: Date;
  notes?: string;
};

const COLLECTION = "applications";

export async function createApplication(payload: Omit<Application, "_id">) {
  const collection = await getCollection<Application>(COLLECTION);
  const item = {
    ...payload,
    appliedAt: payload.appliedAt ?? new Date(),
  };

  const { insertedId } = await collection.insertOne(item);
  return { ...item, _id: insertedId };
}

export async function listApplications() {
  const collection = await getCollection<Application>(COLLECTION);
  return collection.find({}).sort({ appliedAt: -1 }).toArray();
}

export async function updateApplication(id: string, updates: Partial<Application>) {
  const collection = await getCollection<Application>(COLLECTION);
  const _id = new ObjectId(id);

  const result = await collection.findOneAndUpdate(
    { _id },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: "after" }
  );

  return result.value;
}

export async function deleteApplication(id: string) {
  const collection = await getCollection<Application>(COLLECTION);
  const _id = new ObjectId(id);
  await collection.deleteOne({ _id });
}
