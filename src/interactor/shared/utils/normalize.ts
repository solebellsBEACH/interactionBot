export const stripDiacritics = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, ' ').trim()

export const normalizeTextBasic = (value: string) =>
  normalizeWhitespace(stripDiacritics(value)).toLowerCase()

export const normalizeTextAlphaNum = (value: string) =>
  stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export const normalizeKey = (value?: string | null) => {
  if (!value) return ''
  return stripDiacritics(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
