import { WithId } from "mongodb";

import { connectToDatabase, getCollection } from "../database";

export type GptInteractionSource = "responses" | "chat.completions";

export type GptInteraction = {
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

const COLLECTION = "gpt-interactions";

export async function saveGptInteraction(
  payload: Omit<GptInteraction, "createdAt">
): Promise<WithId<GptInteraction>> {
  await connectToDatabase();
  const collection = await getCollection<GptInteraction>(COLLECTION);

  const doc: GptInteraction = {
    ...payload,
    createdAt: new Date(),
  };

  const { insertedId } = await collection.insertOne(doc);
  return {
    ...doc,
    _id: insertedId,
  };
}

export async function listGptInteractions(limit = 50): Promise<WithId<GptInteraction>[]> {
  await connectToDatabase();
  const collection = await getCollection<GptInteraction>(COLLECTION);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);

  return collection.find({}).sort({ createdAt: -1 }).limit(safeLimit).toArray();
}
