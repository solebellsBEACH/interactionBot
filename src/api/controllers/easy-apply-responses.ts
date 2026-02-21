import { FormFieldValue } from "../../interactor/shared/interface/forms/form.types";
import { apiPost } from "../api-client";

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

export async function saveEasyApplyResponses(
  jobUrl: string,
  stepsValues: EasyApplyStepSnapshot[]
): Promise<EasyApplyResponse> {
  return apiPost<EasyApplyResponse>('/easy-apply/responses', { jobUrl, stepsValues });
}
