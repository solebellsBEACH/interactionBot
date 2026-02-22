import { normalizeWhitespace } from "./normalize";

export const parseMetaTitle = (raw: string) => {
  if (!raw) return ''
  const cleaned = normalizeWhitespace(raw)
  if (!cleaned) return ''
  const parts = cleaned.split(' | ').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return ''
  return parts[0]
}

export const parseMetaHeadline = (raw: string) => {
  if (!raw) return ''
  const cleaned = normalizeWhitespace(raw)
  if (!cleaned) return ''
  const parts = cleaned.split(' | ').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0]
  const headline = parts[0]
  if (headline.toLowerCase().includes('linkedin')) return ''
  return headline
}

export const parseMetaLocation = (raw: string) => {
  if (!raw) return ''
  const cleaned = normalizeWhitespace(raw)
  if (!cleaned) return ''
  const parts = cleaned.split(' | ').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return ''
  const candidate = parts[1]
  if (candidate.toLowerCase().includes('linkedin')) return ''
  return candidate
}
