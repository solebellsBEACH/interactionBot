import { WithId } from "mongodb";
import { FormFieldValue } from "../../shared/utils/element-handle";
import { connectToDatabase, getCollection } from "../database";
import { upsertFieldAnswers } from "./field-answers";

export type EasyApplyStepSnapshot = {
  step: number;
  inputValues?: FormFieldValue[];
  selectValues?: FormFieldValue[];
};

export type EasyApplyFieldSource = "input" | "select";

export type EasyApplyField = {
  key: string;
  label?: string | null;
  value: string;
  step: number;
  source: EasyApplyFieldSource;
};

export type EasyApplyResponse = {
  jobUrl: string;
  fields: EasyApplyField[];
  createdAt: Date;
};

const COLLECTION = "easy-apply-responses";

export async function saveEasyApplyResponses(
  jobUrl: string,
  stepsValues: EasyApplyStepSnapshot[]
): Promise<WithId<EasyApplyResponse>> {
  await connectToDatabase();
  const collection = await getCollection<EasyApplyResponse>(COLLECTION);

  const uniqueFields = dedupeByKey(flattenFields(stepsValues));

  await upsertFieldAnswers(jobUrl, uniqueFields);

  const document: EasyApplyResponse = {
    jobUrl,
    fields: uniqueFields,
    createdAt: new Date(),
  };

  const { insertedId } = await collection.insertOne(document);
  return { ...document, _id: insertedId };
}

function flattenFields(stepsValues: EasyApplyStepSnapshot[]): EasyApplyField[] {
  const fields: EasyApplyField[] = [];

  for (const step of stepsValues) {
    for (const input of step.inputValues || []) {
      if (!input.key) continue;
      fields.push({
        key: input.key,
        label: input.label,
        value: input.value,
        step: step.step,
        source: "input",
      });
    }

    for (const select of step.selectValues || []) {
      if (!select.key) continue;
      fields.push({
        key: select.key,
        label: select.label,
        value: select.value,
        step: step.step,
        source: "select",
      });
    }
  }

  return fields;
}

function dedupeByKey(fields: EasyApplyField[]): EasyApplyField[] {
  const seen = new Set<string>();
  const unique: EasyApplyField[] = [];

  for (const field of fields) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    unique.push(field);
  }

  return unique;
}
