import { normalizeTextBasic, normalizeWhitespace } from "./normalize";

export type Action =
  | 'account'
  | 'session'
  | 'profile'
  | 'dashboard'
  | 'dashboard-profile'
  | 'dashboard-network'
  | 'connections-visit'
  | 'easy-apply'
  | 'search-jobs'
  | 'catch-jobs'
  | 'applied-jobs'
  | 'connect'
  | 'upvote'

export type ParsedArgs = {
  action?: Action
  jobUrl?: string
  tag?: string
  profileUrl?: string
  message?: string
  maxResults?: number
  maxLikes?: number
  maxApplicants?: number
  maxPages?: number
  postedWithinDays?: number
  easyApplyOnly?: boolean
  includeUnknownApplicants?: boolean
  maxConnections?: number
  delayMs?: number
  maxScrollRounds?: number
  maxIdleRounds?: number
  headless?: boolean
  workplaceTypes?: string[]
};

type RawArgs = Record<string, string | boolean>

const TRUTHY_VALUES = new Set(['1', 'true', 'yes'])
const FALSEY_VALUES = new Set(['0', 'false', 'no'])

const parseRawArgs = (argv: string[]): RawArgs => {
  const raw: RawArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      raw[key] = true
      continue
    }
    raw[key] = next
    i++
  }
  return raw
}

const parseOptionalNumber = (value: string | boolean | undefined) => {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeWhitespace(value)
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? undefined : parsed
}

const parseOptionalBoolean = (value: string | boolean | undefined) => {
  if (value === true) return true
  if (typeof value !== 'string') return undefined
  const normalized = normalizeTextBasic(value)
  if (TRUTHY_VALUES.has(normalized)) return true
  if (FALSEY_VALUES.has(normalized)) return false
  return undefined
}

const parseOptionalList = (value: string | boolean | undefined) => {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeWhitespace(value)
  if (!normalized) return undefined
  return normalized
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

const parseDatePostedDays = (value: string | undefined) => {
  if (!value) return undefined
  const normalized = normalizeTextBasic(value)
  if (['24h', '24hours', '24hrs', 'day', '1d', 'hoje'].includes(normalized)) {
    return 1
  }
  if (['week', 'semana', '7d', '1w'].includes(normalized)) {
    return 7
  }
  if (['month', 'mes', 'mês', '30d', '1m'].includes(normalized)) {
    return 30
  }
  return undefined
}

const getStringArg = (raw: RawArgs, key: string) => {
  const value = raw[key]
  return typeof value === 'string' ? value : undefined
}

export const parseArgs = (argv: string[]): ParsedArgs => {
  const raw = parseRawArgs(argv)
  const postedWithinDays = parseOptionalNumber(raw.postedWithinDays)
  const datePostedDays = parseDatePostedDays(getStringArg(raw, 'datePosted'))
  const workplaceTypes = parseOptionalList(raw.workplaceTypes ?? raw.workplaceType)

  return {
    action: typeof raw.action === 'string' ? (raw.action as Action) : undefined,
    jobUrl: getStringArg(raw, 'jobUrl'),
    tag: getStringArg(raw, 'tag'),
    profileUrl: getStringArg(raw, 'profileUrl'),
    message: getStringArg(raw, 'message'),
    maxResults: parseOptionalNumber(raw.maxResults),
    maxLikes: parseOptionalNumber(raw.maxLikes),
    maxApplicants: parseOptionalNumber(raw.maxApplicants),
    maxPages: parseOptionalNumber(raw.maxPages),
    postedWithinDays: postedWithinDays ?? datePostedDays,
    easyApplyOnly: parseOptionalBoolean(raw.easyApplyOnly),
    includeUnknownApplicants: parseOptionalBoolean(raw.includeUnknownApplicants),
    maxConnections: parseOptionalNumber(raw.maxConnections),
    delayMs: parseOptionalNumber(raw.delayMs),
    maxScrollRounds: parseOptionalNumber(raw.maxScrollRounds),
    maxIdleRounds: parseOptionalNumber(raw.maxIdleRounds),
    headless: parseOptionalBoolean(raw.headless),
    workplaceTypes
  }
}
