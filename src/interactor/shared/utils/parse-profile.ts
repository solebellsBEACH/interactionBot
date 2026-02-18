import { normalizeTextBasic } from "./normalize";
import type { Experience } from "../interface/scrap/profile.types";

export const cleanProfileLines = (lines: string[], extraIgnore: string[] = []) => {
  const ignore = new Set(
    [
      'see more',
      'show more',
      'see less',
      'show less',
      'mostrar mais',
      'ver mais',
      'mostrar menos',
      'ver menos',
      'experience',
      'experiência',
      ...extraIgnore
    ].map((item) => item.toLowerCase())
  )

  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const line of lines) {
    const trimmed = line.replace(/\s+/g, ' ').trim()
    if (!trimmed) continue
    const normalized = trimmed.toLowerCase()
    if (ignore.has(normalized)) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    cleaned.push(trimmed)
  }
  return cleaned
}

export const extractCompanyName = (line: string) => {
  if (!line) return ''
  const parts = line.split(/[·•|]/).map((part) => part.trim()).filter(Boolean)
  return parts[0] || line.trim()
}

const isEmploymentTypeLine = (line: string) => {
  const normalized = normalizeTextBasic(line)
  return /(full[- ]time|part[- ]time|intern|internship|contract|freelance|temporary|self[- ]employed|tempo integral|meio periodo|estagio|contrato|autonomo)/.test(
    normalized
  )
}

const isDateLine = (line: string) => {
  const normalized = normalizeTextBasic(line)
  if (!normalized) return false
  if (/\b(19|20)\d{2}\b/.test(normalized)) return true
  if (/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/.test(normalized)) return true
  if (/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(normalized)) return true
  if (/(present|atual|current)/.test(normalized)) return true
  return false
}

const looksLikeLocation = (line: string) => {
  if (!line) return false
  if (isDateLine(line) || isEmploymentTypeLine(line)) return false
  const normalized = normalizeTextBasic(line)
  if (
    normalized === 'remote' ||
    normalized === 'remoto' ||
    normalized === 'hibrido' ||
    normalized === 'hybrid' ||
    normalized === 'on-site' ||
    normalized === 'onsite' ||
    normalized === 'presencial'
  ) {
    return true
  }
  return line.includes(',') || line.length <= 60
}

const buildExperience = (lines: string[], companyOverride?: string): Experience => {
  const title = lines[0] || ''
  let company = companyOverride || ''

  if (!company) {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (isDateLine(line)) break
      if (isEmploymentTypeLine(line)) continue
      company = extractCompanyName(line)
      break
    }
  }

  const dateIndex = lines.findIndex((line) => isDateLine(line))
  const dates = dateIndex >= 0 ? lines[dateIndex] : ''

  let location = ''
  if (dateIndex >= 0 && dateIndex + 1 < lines.length) {
    const candidate = lines[dateIndex + 1]
    if (looksLikeLocation(candidate)) {
      location = candidate
    }
  }

  const descriptionStart = dateIndex >= 0 ? dateIndex + (location ? 2 : 1) : 1
  const description = lines
    .slice(descriptionStart)
    .filter((line) => !isEmploymentTypeLine(line))
    .join(' ')

  return {
    label: [title, company].filter(Boolean).join(' | '),
    title,
    company,
    dates,
    location,
    description
  }
}

export const parseExperienceLines = (lines: string[], companyOverride?: string): Experience[] => {
  const cleaned = cleanProfileLines(lines)
  if (cleaned.length === 0) return []

  if (companyOverride) {
    return [buildExperience(cleaned, companyOverride)]
  }

  const dateIndices = cleaned
    .map((line, idx) => (isDateLine(line) ? idx : -1))
    .filter((idx) => idx >= 0)

  if (dateIndices.length > 1) {
    const company = extractCompanyName(cleaned[0] || '')
    const entries: Experience[] = []
    for (let i = 0; i < dateIndices.length; i++) {
      const dateIndex = dateIndices[i]
      const nextIndex = dateIndices[i + 1] ?? cleaned.length

      let titleIndex = dateIndex - 1
      while (titleIndex > 0 && isEmploymentTypeLine(cleaned[titleIndex])) {
        titleIndex -= 1
      }
      let title = cleaned[titleIndex] || ''
      if (title === company && titleIndex > 0) {
        title = cleaned[titleIndex - 1] || title
      }

      let location = ''
      if (dateIndex + 1 < nextIndex) {
        const candidate = cleaned[dateIndex + 1]
        if (looksLikeLocation(candidate)) {
          location = candidate
        }
      }

      const descriptionStart = dateIndex + (location ? 2 : 1)
      const description = cleaned
        .slice(descriptionStart, nextIndex)
        .filter((line) => !isEmploymentTypeLine(line))
        .join(' ')

      entries.push({
        label: [title, company].filter(Boolean).join(' | '),
        title,
        company,
        dates: cleaned[dateIndex] || '',
        location,
        description
      })
    }
    return entries
  }

  return [buildExperience(cleaned)]
}
