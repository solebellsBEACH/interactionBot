import { FormFieldValue } from "../../interactor/shared/interface/forms/form.types";
import { apiDelete, apiPost } from "../api-client";

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
  _id?: string;
  jobUrl: string;
  fields: EasyApplyField[];
  createdAt: Date;
};

export async function saveEasyApplyResponses(
  jobUrl: string,
  stepsValues: EasyApplyStepSnapshot[]
): Promise<EasyApplyResponse> {
  return apiPost<EasyApplyResponse>("/easy-apply/responses", { jobUrl, stepsValues });
}

export async function clearEasyApplyResponses(): Promise<number> {
  try {
    const response = await apiDelete<{ deletedCount?: number }>("/easy-apply/responses?all=true");
    return response?.deletedCount || 0;
  } catch {
    return 0;
  }
}
