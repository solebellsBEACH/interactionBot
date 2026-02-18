import { normalizeTextAlphaNum } from "./normalize";

export const parseApplicantsCount = (text: string) => {
  const normalized = normalizeTextAlphaNum(text)
  if (!normalized) return null
  const keyword = '(?:applicants?|applications?|candidatos?|candidaturas?|aplicantes?)'
  const prefixWords =
    '(?:total|totais|received|recebidas?|recebido|ate|até|agora|no\\s*total|so\\s*far)'
  const patterns: Array<{ regex: RegExp; over?: boolean }> = [
    {
      regex:
        new RegExp(`(?:over|more than|mais de)\\s*([\\d.,]+)\\s*${keyword}`),
      over: true
    },
    {
      regex:
        new RegExp(`([\\d.,]+)\\s*\\+\\s*${keyword}`),
      over: true
    },
    {
      regex: new RegExp(
        `${keyword}\\s*(?:[:\\-]|\\s)*(?:${prefixWords}\\s*){0,3}([\\d.,]+)\\s*\\+`
      ),
      over: true
    },
    { regex: new RegExp(`([\\d.,]+)\\s*${keyword}`) },
    {
      regex: new RegExp(
        `${keyword}\\s*(?:[:\\-]|\\s)*(?:${prefixWords}\\s*){0,3}([\\d.,]+)`
      )
    },
    { regex: /be among the first\\s*([\\d.,]+)/ },
    { regex: /seja um dos primeiros\\s*([\\d.,]+)/ }
  ]
  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex)
    if (match) {
      const raw = match[1].replace(/[^\\d]/g, '')
      if (!raw) continue
      const value = Number(raw)
      if (Number.isNaN(value)) return null
      return pattern.over ? value + 1 : value
    }
  }
  return null
}

export const parsePostedAgeMinutes = (text: string) => {
  const normalized = normalizeTextAlphaNum(text)
  if (!normalized) return null
  const cleaned = normalized
    .replace(/\\b(reposted|repostado|repostada|publicado|publicada|publicado ha|publicada ha)\\b/g, '')
    .trim()
  if (!cleaned) return null
  if (/(just now|agora mesmo|neste momento)/.test(cleaned)) return 0

  const numberMatch = cleaned.match(/(\\d+)/)
  const wordOne = cleaned.match(/\\b(um|uma|one|a)\\b/)
  const amount = numberMatch ? Number(numberMatch[1]) : wordOne ? 1 : null
  if (!amount || Number.isNaN(amount)) return null

  const unit =
    cleaned.match(/\\b(minuto|minutos|minute|minutes|min)\\b/)?.[1] ||
    cleaned.match(/\\b(hora|horas|hour|hours|hr|hrs)\\b/)?.[1] ||
    cleaned.match(/\\b(dia|dias|day|days)\\b/)?.[1] ||
    cleaned.match(/\\b(semana|semanas|week|weeks|sem)\\b/)?.[1] ||
    cleaned.match(/\\b(mes|meses|month|months)\\b/)?.[1] ||
    cleaned.match(/\\b(ano|anos|year|years)\\b/)?.[1]

  if (!unit) return null
  if (/min/.test(unit)) return amount
  if (/hora|hour|hr/.test(unit)) return amount * 60
  if (/dia|day/.test(unit)) return amount * 60 * 24
  if (/semana|week|sem/.test(unit)) return amount * 60 * 24 * 7
  if (/mes|month/.test(unit)) return amount * 60 * 24 * 30
  if (/ano|year/.test(unit)) return amount * 60 * 24 * 365
  return null
}
