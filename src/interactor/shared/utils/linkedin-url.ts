import { LINKEDIN_BASE_URL, LINKEDIN_URLS } from "../constants/linkedin-urls"

type JobSearchOptions = {
  tag: string
  location?: string
  start?: number
  geoId?: string | number
  easyApplyOnly?: boolean
  postedWithinDays?: number
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

export const buildLinkedinContentSearchUrl = (tag: string) => {
  const normalized = tag.replace(/\+/g, ' ').trim()
  if (!normalized) return LINKEDIN_URLS.contentSearch
  const params = new URLSearchParams()
  params.set('keywords', normalized)
  return `${LINKEDIN_URLS.contentSearch}?${params.toString()}`
}

export const buildLinkedinPeopleSearchUrl = (keyword: string) => {
  const normalized = keyword.trim()
  if (!normalized) return LINKEDIN_URLS.peopleSearch
  return `${LINKEDIN_URLS.peopleSearch}?keywords=${encodeURIComponent(normalized)}`
}

export const buildLinkedinPostUrlFromUrn = (urn: string) => {
  return `${LINKEDIN_URLS.feedUpdateBase}${urn}`
}

export const buildLinkedinConnectionsNextPageUrl = (currentUrl: string, pageSize: number) => {
  try {
    const url = new URL(currentUrl)
    const params = url.searchParams

    const pageParam = params.get('page')
    const pageNumParam = params.get('pageNum')
    const startParam = params.get('start')

    if (pageParam && !Number.isNaN(Number(pageParam))) {
      params.set('page', String(Number(pageParam) + 1))
    } else if (pageNumParam && !Number.isNaN(Number(pageNumParam))) {
      params.set('pageNum', String(Number(pageNumParam) + 1))
    } else if (startParam && !Number.isNaN(Number(startParam))) {
      params.set('start', String(Number(startParam) + pageSize))
    } else {
      params.set('start', String(pageSize))
      params.set('count', String(pageSize))
    }

    url.search = params.toString()
    return url.toString()
  } catch {
    return null
  }
}
