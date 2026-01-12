import { WithId } from "mongodb";
import { connectToDatabase, getCollection } from "../database";
import { EasyApplyField } from "./easy-apply-responses";

export type FieldAnswer = {
  key: string;
  label?: string | null;
  value: string;
  source: "input" | "select";
  jobUrl?: string;
  lastUsedAt: Date;
};

const COLLECTION = "field-answers";

export async function upsertFieldAnswers(jobUrl: string, fields: EasyApplyField[]): Promise<void> {
  await connectToDatabase();
  const collection = await getCollection<FieldAnswer>(COLLECTION);

  for (const field of fields) {
    if (!field.key) continue;
    await collection.updateOne(
      { key: field.key },
      {
        $set: {
          label: field.label,
          value: field.value,
          source: field.source,
          jobUrl,
          lastUsedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
}

export async function getFieldAnswer(key: string, label?: string | null): Promise<WithId<FieldAnswer> | null> {
  await connectToDatabase();
  const collection = await getCollection<FieldAnswer>(COLLECTION);
  if (label) {
    return collection.findOne({
      $or: [{ key }, { label }],
    });
  }
  return collection.findOne({ key });
}
