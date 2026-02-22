export type FormFieldValue = {
  key?: string
  label?: string | null
  value: string
}

export type FormPromptField = FormFieldValue & {
  type: 'input' | 'select'
  options?: string[]
}

export type FormValues = {
  inputValues: FormFieldValue[]
  selectValues: FormFieldValue[]
}
