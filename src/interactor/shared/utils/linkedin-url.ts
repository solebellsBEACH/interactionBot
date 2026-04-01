import { LINKEDIN_BASE_URL, LINKEDIN_URLS } from "../constants/linkedin-urls"
import { normalizeTextBasic } from "./normalize"

type JobSearchOptions = {
  tag: string
  location?: string
  start?: number
  geoId?: string | number
  easyApplyOnly?: boolean
  postedWithinDays?: number
  workplaceTypes?: string[]
}

export const normalizeLinkedinUrl = (href: string) => {
  if (!href) return href
  try {
    const url = new URL(href, LINKEDIN_BASE_URL)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return href
  }
}

export const normalizeLinkedinProfileUrl = (
  raw: string,
  options: { allowMe?: boolean } = {}
) => {
  if (!raw) return null
  const allowMe = options.allowMe === true
  try {
    const url = new URL(raw, LINKEDIN_BASE_URL)
    if (!url.pathname.includes('/in/')) return null
    if (!allowMe && url.pathname.includes('/in/me')) return null
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    if (!raw.includes('/in/')) return null
    if (!allowMe && raw.includes('/in/me')) return null
    return raw.split('#')[0].split('?')[0]
  }
}

export const extractLinkedinProfileSlug = (profileUrl?: string | null) => {
  if (!profileUrl) return ''
  const raw = String(profileUrl)
  const parseSlug = (input: string) => {
    const match = input.match(/\/in\/([^/?#]+)/i)
    if (!match) return ''
    try {
      return decodeURIComponent(match[1]).replace(/[-_]+/g, ' ').trim()
    } catch {
      return match[1].replace(/[-_]+/g, ' ').trim()
    }
  }
  try {
    const url = new URL(raw, LINKEDIN_BASE_URL)
    return parseSlug(url.pathname)
  } catch {
    return parseSlug(raw)
  }
}

export const guessNameFromLinkedinProfileUrl = (profileUrl?: string | null) => {
  const slug = extractLinkedinProfileSlug(profileUrl)
  if (!slug) return ''
  const cleaned = slug
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\d+/g, '')
    .replace(/[-\s]+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export const buildLinkedinJobSearchUrl = (options: JobSearchOptions) => {
  const params = new URLSearchParams()
  params.set('keywords', options.tag)
  if (options.easyApplyOnly) {
    params.set('f_AL', 'true')
  }
  if (options.postedWithinDays !== undefined && options.postedWithinDays > 0) {
    const seconds = Math.round(options.postedWithinDays * 24 * 60 * 60)
    params.set('f_TPR', `r${seconds}`)
  }
  const workplaceTypes = normalizeWorkplaceTypes(options.workplaceTypes)
  if (workplaceTypes.length > 0) {
    params.set('f_WT', workplaceTypes.join(','))
  }
  if (options.geoId !== undefined && options.geoId !== null) {
    const normalized = String(options.geoId).trim()
    if (normalized) {
      params.set('geoId', normalized)
    }
  }
  if (options.location && options.location.trim()) {
    params.set('location', options.location.trim())
  }
  if (options.start && options.start > 0) {
    params.set('start', options.start.toString())
  }
  return `${LINKEDIN_URLS.jobSearch}?${params.toString()}`
}

const normalizeWorkplaceTypes = (types?: string[]) => {
  if (!types || types.length === 0) return []
  const results: string[] = []
  const map: Record<string, string> = {
    onsite: '1',
    'on-site': '1',
    'on site': '1',
    presencial: '1',
    remote: '2',
    remoto: '2',
    hybrid: '3',
    hibrido: '3'
  }

  for (const raw of types) {
    if (!raw) continue
    const trimmed = String(raw).trim()
    if (!trimmed) continue
    if (/^\\d+$/.test(trimmed)) {
      if (!results.includes(trimmed)) results.push(trimmed)
      continue
    }
    const normalized = normalizeTextBasic(trimmed)
    const mapped = map[normalized]
    if (mapped && !results.includes(mapped)) {
      results.push(mapped)
    }
  }

  return results
}

