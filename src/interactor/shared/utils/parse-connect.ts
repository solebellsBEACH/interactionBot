import { normalizeTextBasic, normalizeWhitespace } from "./normalize";

export const parseConnectionLabelFields = (label: string) => {
  const cleaned = normalizeWhitespace(label)
  if (!cleaned) return { name: '', headline: '', location: '' }
  const lowered = normalizeTextBasic(cleaned)
  if (lowered.includes('profile') || lowered.includes('perfil')) {
    return { name: '', headline: '', location: '' }
  }
  let parts: string[] = []
  if (cleaned.includes(' - ')) {
    parts = cleaned.split(' - ')
  } else if (cleaned.includes(' | ')) {
    parts = cleaned.split(' | ')
  } else if (cleaned.includes(' · ')) {
    parts = cleaned.split(' · ')
  } else {
    parts = [cleaned]
  }
  const filtered = parts.map((part) => part.trim()).filter(Boolean)
  const [name, headline, location] = filtered
  return {
    name: name || '',
    headline: headline || '',
    location: location || ''
  }
}
