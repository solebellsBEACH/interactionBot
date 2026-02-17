import { BrowserContext, chromium } from 'playwright';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { disconnectFromDatabase } from '../api/database';
import { ERROR_CODES } from './shared/constants/errors';

type Action =
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
  | 'connect'
  | 'upvote';

type ParsedArgs = {
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
};

const TRUTHY_VALUES = new Set(['1', 'true', 'yes'])
const FALSEY_VALUES = new Set(['0', 'false', 'no'])

const parseRawArgs = (argv: string[]): Record<string, string | boolean> => {
  const raw: Record<string, string | boolean> = {}
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
  const normalized = value.trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? undefined : parsed
}

const parseOptionalBoolean = (value: string | boolean | undefined) => {
  if (value === true) return true
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (TRUTHY_VALUES.has(normalized)) return true
  if (FALSEY_VALUES.has(normalized)) return false
  return undefined
}

const parseDatePostedDays = (value: string | undefined) => {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
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

const getStringArg = (raw: Record<string, string | boolean>, key: string) => {
  const value = raw[key]
  return typeof value === 'string' ? value : undefined
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const raw = parseRawArgs(argv)
  const postedWithinDays = parseOptionalNumber(raw.postedWithinDays)
  const datePostedDays = parseDatePostedDays(getStringArg(raw, 'datePosted'))

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
    headless: parseOptionalBoolean(raw.headless)
  }
}

let browser: BrowserContext | undefined
let shuttingDown = false

type JobFilterLog = {
  easyApplyOnly: boolean
  maxApplicants?: number
  includeUnknownApplicants?: boolean
  postedWithinDays?: number
}

const buildJobSearchOptions = (args: ParsedArgs, easyApplyDefault: boolean) => {
  const easyApplyOnly = args.easyApplyOnly ?? easyApplyDefault
  const maxApplicants = args.maxApplicants
  const includeUnknownApplicants = args.includeUnknownApplicants
  const postedWithinDays = args.postedWithinDays
  return {
    filters: {
      easyApplyOnly,
      maxApplicants,
      includeUnknownApplicants,
      postedWithinDays
    },
    options: {
      maxResults: args.maxResults,
      maxPages: args.maxPages,
      maxApplicants,
      postedWithinDays,
      easyApplyOnly,
      includeUnknownApplicants
    }
  }
}

const logJobFilters = (filters: JobFilterLog) => {
  console.log(
    `[bot] Filtros: easyApplyOnly=${filters.easyApplyOnly} | maxApplicants=${filters.maxApplicants ?? '-'} | includeUnknownApplicants=${filters.includeUnknownApplicants ?? '-'} | postedWithinDays=${filters.postedWithinDays ?? '-'}`
  )
}

const runAction = async (features: LinkedinFeatures, args: ParsedArgs) => {
  const action = args.action || 'profile'
  const defaultTag = env.linkedinURLs.searchJobTag || ''

  switch (action) {
    case 'session':
      return features.ensureSession()
    case 'profile':
      {
        const profileUrl = args.profileUrl?.trim() || undefined
        return features.profile(profileUrl)
      }
    case 'dashboard':
      return features.dashboard(args.profileUrl)
    case 'dashboard-profile':
      return features.dashboardProfile(args.profileUrl)
    case 'dashboard-network':
      return features.dashboardNetwork()
    case 'connections-visit':
      return features.visitConnections({
        maxToVisit: args.maxConnections,
        delayMs: args.delayMs,
        maxScrollRounds: args.maxScrollRounds,
        maxIdleRounds: args.maxIdleRounds
      })
    case 'easy-apply':
      return features.easyApply(args.jobUrl)
    case 'search-jobs':
      {
        const tag = (args.tag || defaultTag).trim()
        if (!tag) throw new Error(ERROR_CODES.missingTag)
        const { filters, options } = buildJobSearchOptions(args, false)
        logJobFilters(filters)
        const results = await features.searchJobTag(tag, options)
        logJobs('Buscar jobs', results)
        return results
      }
    case 'catch-jobs':
      {
        const tag = (args.tag || defaultTag).trim() || undefined
        const { filters, options } = buildJobSearchOptions(args, true)
        logJobFilters(filters)
        const results = await features.catchJobs(tag, options)
        logJobs('Capturar jobs', results)
        if (results.length === 0) return results

        console.log(`[bot] Iniciando Easy Apply em ${results.length} vagas...`)
        let applied = 0
        for (const [index, job] of results.entries()) {
          console.log(`[bot] Easy Apply ${index + 1}/${results.length}: ${job.title} | ${job.company}`)
          try {
            await features.easyApply(job.url)
            applied++
          } catch (error) {
            console.warn(`[bot] Falha Easy Apply: ${job.url}`, error)
          }
          await wait(1500)
        }
        console.log(`[bot] Easy Apply finalizado. Sucesso: ${applied}/${results.length}`)
        return results
      }
    case 'connect':
      if (args.profileUrl) {
        return features.sendConnection(
          args.profileUrl,
          args.message ? { message: args.message } : undefined
        )
      }
      {
        const keyword = (args.tag || '').trim()
        if (!keyword) throw new Error(ERROR_CODES.missingTag)
        const results = await features.connectByKeyword(keyword, {
          maxResults: args.maxResults,
          maxPages: args.maxPages
        })
        logConnections('Conexoes encontradas', results)
        return results
      }
    case 'account':
      {
        const summary = await features.accountSummary()
        if (!summary) throw new Error('account-not-found')
        if (summary.name) console.log(`[account] name: ${summary.name}`)
        if (summary.headline) console.log(`[account] headline: ${summary.headline}`)
        if (summary.location) console.log(`[account] location: ${summary.location}`)
        if (summary.photoUrl) console.log(`[account] photo: ${summary.photoUrl}`)
        if (summary.profileUrl) console.log(`[account] url: ${summary.profileUrl}`)
        return summary
      }
    case 'upvote':
      {
        const results = await features.upvoteOnPosts({
          tag: args.tag,
          maxLikes: args.maxLikes
        })
        logList('Upvotes', results)
        return results
      }
    default:
      throw new Error(`unknown-action:${action}`)
  }
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const headless = args.headless ?? false

  process.once('SIGINT', async () => {
    shuttingDown = true
    console.log('Encerrando...')
    try {
      await browser?.close()
      await disconnectFromDatabase().catch(() => undefined)
    } finally {
      process.exit(0)
    }
  })

  browser = await chromium.launchPersistentContext(env.userDataDir, {
    headless,
    slowMo: 50
  })

  let page = (await browser.pages())[0]
  if (!page) {
    page = await browser.newPage()
  }

  const linkedinFeatures = new LinkedinFeatures(page)
  try {
    logHeader('Iniciando ação', args.action || 'profile')
    await runAction(linkedinFeatures, args)
    console.log('Ação concluída.')
  } finally {
    await browser?.close().catch((error) => {
      console.warn('Falha ao fechar o navegador:', error)
    })
    await disconnectFromDatabase().catch((error) => {
      console.warn('Falha ao fechar o MongoDB:', error)
    })
  }
}

main().catch((error) => {
  if (shuttingDown) return
  console.error('Falha ao executar ação:', error)
  process.exit(1)
})

function logHeader(title: string, value: string) {
  const padded = value || 'profile'
  console.log(`[bot] ${title}: ${padded}`)
}

function logJobs(
  title: string,
  jobs: {
    title: string
    company: string
    location: string
    url: string
    applicants?: number | null
    postedAt?: string | null
    easyApply?: boolean
  }[]
) {
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
  console.log(`[bot] ${title}: ${jobs.length}`)
  if (!jobs.length) return
  for (const [idx, job] of jobs.entries()) {
    const posted = job.postedAt ? `Publicado: ${job.postedAt}` : 'Publicado: —'
    const applicants =
      typeof job.applicants === 'number' ? `Candidaturas: ${job.applicants}` : 'Candidaturas: —'
    const easyApply = `Easy Apply: ${job.easyApply ? 'sim' : 'nao'}`
    const parts = [job.title, job.company, job.location, posted, applicants, easyApply]
      .filter(Boolean)
      .map((value) => clean(String(value)))
      .join(' | ')
    console.log(`${idx + 1}. ${parts} | ${clean(job.url)}`)
  }
}

function logConnections(
  title: string,
  connections: {
    name?: string
    headline?: string
    location?: string
    url: string
  }[]
) {
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
  console.log(`[bot] ${title}: ${connections.length}`)
  if (!connections.length) return
  for (const [idx, connection] of connections.entries()) {
    const parts = [connection.name, connection.headline, connection.location]
      .filter(Boolean)
      .map((value) => clean(String(value)))
      .join(' | ')
    const label = parts ? `${parts} | ${clean(connection.url)}` : clean(connection.url)
    console.log(`${idx + 1}. ${label}`)
  }
}

function logList(title: string, items: string[]) {
  console.log(`[bot] ${title}: ${items.length}`)
  if (!items.length) return
  for (const [idx, item] of items.entries()) {
    console.log(`${idx + 1}. ${item}`)
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
