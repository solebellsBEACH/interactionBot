import { ObjectId, WithId } from "mongodb";
import { getCollection } from "../database";

export type PromptStatus = "pending" | "answered" | "expired";

export type PromptQueueItem = {
  jobId?: string;
  prompt: string;
  options?: string[];
  status: PromptStatus;
  answer?: string | null;
  createdAt: Date;
  answeredAt?: Date;
};

const COLLECTION = "prompt-queue";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function createPrompt(
  jobId: string | undefined,
  prompt: string,
  options?: string[]
): Promise<WithId<PromptQueueItem>> {
  const collection = await getCollection<PromptQueueItem>(COLLECTION);
  const document: PromptQueueItem = {
    jobId,
    prompt,
    options,
    status: "pending",
    createdAt: new Date(),
  };

  const { insertedId } = await collection.insertOne(document);
  return { ...document, _id: insertedId };
}

export async function waitForPromptAnswer(
  id: string | ObjectId,
  timeoutMs = 120_000,
  pollMs = 800
): Promise<string | null> {
  const collection = await getCollection<PromptQueueItem>(COLLECTION);
  const _id = typeof id === "string" ? new ObjectId(id) : id;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const item = await collection.findOne({ _id });
    if (!item) return null;
    if (item.status === "answered") {
      return item.answer?.trim() || null;
    }
    await delay(pollMs);
  }

  await collection.updateOne(
    { _id },
    { $set: { status: "expired", answeredAt: new Date() } }
  );
  return null;
}

export async function answerPrompt(id: string, answer: string) {
  const collection = await getCollection<PromptQueueItem>(COLLECTION);
  const _id = new ObjectId(id);
  await collection.updateOne(
    { _id },
    { $set: { status: "answered", answer, answeredAt: new Date() } }
  );
}

export async function getNextPrompt(jobId?: string): Promise<WithId<PromptQueueItem> | null> {
  const collection = await getCollection<PromptQueueItem>(COLLECTION);
  const query = jobId
    ? ({ status: "pending", jobId } as const)
    : ({ status: "pending" } as const);
  return collection.find(query).sort({ createdAt: 1 }).limit(1).next();
}
