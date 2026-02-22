import type { FormFieldValue } from "../forms/form.types"

export type EasyApplyStepValues = {
  step: number
  inputValues?: FormFieldValue[]
  selectValues?: FormFieldValue[]
}
