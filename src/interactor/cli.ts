import { BrowserContext, chromium } from 'playwright';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { DiscordClient } from './shared/discord/discord-client';
import { disconnectFromDatabase } from '../api/database';

type Action =
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

const parseArgs = (argv: string[]): ParsedArgs => {
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

  const headlessRaw = raw.headless
  const headless =
    headlessRaw === true ||
    (typeof headlessRaw === 'string' && ['1', 'true', 'yes'].includes(headlessRaw.toLowerCase()))

  const maxResults =
    typeof raw.maxResults === 'string' && raw.maxResults.trim()
      ? Number(raw.maxResults)
      : undefined

  const maxLikes =
    typeof raw.maxLikes === 'string' && raw.maxLikes.trim()
      ? Number(raw.maxLikes)
      : undefined

  const maxApplicants =
    typeof raw.maxApplicants === 'string' && raw.maxApplicants.trim()
      ? Number(raw.maxApplicants)
      : undefined

  const maxPages =
    typeof raw.maxPages === 'string' && raw.maxPages.trim()
      ? Number(raw.maxPages)
      : undefined

  const postedWithinDays =
    typeof raw.postedWithinDays === 'string' && raw.postedWithinDays.trim()
      ? Number(raw.postedWithinDays)
      : undefined

  let datePostedDays: number | undefined
  if (typeof raw.datePosted === 'string') {
    const normalized = raw.datePosted.trim().toLowerCase()
    if (['24h', '24hours', '24hrs', 'day', '1d', 'hoje'].includes(normalized)) {
      datePostedDays = 1
    } else if (['week', 'semana', '7d', '1w'].includes(normalized)) {
      datePostedDays = 7
    } else if (['month', 'mes', 'mês', '30d', '1m'].includes(normalized)) {
      datePostedDays = 30
    }
  }

  let easyApplyOnly: boolean | undefined
  if (raw.easyApplyOnly !== undefined) {
    const easyApplyOnlyRaw = raw.easyApplyOnly
    if (easyApplyOnlyRaw === true) {
      easyApplyOnly = true
    } else if (typeof easyApplyOnlyRaw === 'string') {
      const normalized = easyApplyOnlyRaw.toLowerCase()
      if (['1', 'true', 'yes'].includes(normalized)) {
        easyApplyOnly = true
      } else if (['0', 'false', 'no'].includes(normalized)) {
        easyApplyOnly = false
      }
    }
  }

  let includeUnknownApplicants: boolean | undefined
  if (raw.includeUnknownApplicants !== undefined) {
    const includeRaw = raw.includeUnknownApplicants
    if (includeRaw === true) {
      includeUnknownApplicants = true
    } else if (typeof includeRaw === 'string') {
      const normalized = includeRaw.toLowerCase()
      if (['1', 'true', 'yes'].includes(normalized)) {
        includeUnknownApplicants = true
      } else if (['0', 'false', 'no'].includes(normalized)) {
        includeUnknownApplicants = false
      }
    }
  }

  const maxConnections =
    typeof raw.maxConnections === 'string' && raw.maxConnections.trim()
      ? Number(raw.maxConnections)
      : undefined

  const delayMs =
    typeof raw.delayMs === 'string' && raw.delayMs.trim()
      ? Number(raw.delayMs)
      : undefined

  const maxScrollRounds =
    typeof raw.maxScrollRounds === 'string' && raw.maxScrollRounds.trim()
      ? Number(raw.maxScrollRounds)
      : undefined

  const maxIdleRounds =
    typeof raw.maxIdleRounds === 'string' && raw.maxIdleRounds.trim()
      ? Number(raw.maxIdleRounds)
      : undefined

  return {
    action: typeof raw.action === 'string' ? (raw.action as Action) : undefined,
    jobUrl: typeof raw.jobUrl === 'string' ? raw.jobUrl : undefined,
    tag: typeof raw.tag === 'string' ? raw.tag : undefined,
    profileUrl: typeof raw.profileUrl === 'string' ? raw.profileUrl : undefined,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    maxResults: Number.isNaN(maxResults) ? undefined : maxResults,
    maxLikes: Number.isNaN(maxLikes) ? undefined : maxLikes,
    maxApplicants: Number.isNaN(maxApplicants) ? undefined : maxApplicants,
    maxPages: Number.isNaN(maxPages) ? undefined : maxPages,
    postedWithinDays:
      postedWithinDays === undefined || Number.isNaN(postedWithinDays)
        ? datePostedDays
        : postedWithinDays,
    easyApplyOnly,
    includeUnknownApplicants,
    maxConnections: Number.isNaN(maxConnections) ? undefined : maxConnections,
    delayMs: Number.isNaN(delayMs) ? undefined : delayMs,
    maxScrollRounds: Number.isNaN(maxScrollRounds) ? undefined : maxScrollRounds,
    maxIdleRounds: Number.isNaN(maxIdleRounds) ? undefined : maxIdleRounds,
    headless
  }
}

let browser: BrowserContext | undefined
let shuttingDown = false

const runAction = async (features: LinkedinFeatures, args: ParsedArgs) => {
  const action = args.action || 'profile'
  const defaultTag = env.linkedinURLs.searchJobTag || ''

  switch (action) {
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
        if (!tag) throw new Error('missing-tag')
        const easyApplyOnly = args.easyApplyOnly ?? false
        const maxApplicants = args.maxApplicants
        const includeUnknownApplicants = args.includeUnknownApplicants
        console.log(
          `[bot] Filtros: easyApplyOnly=${easyApplyOnly} | maxApplicants=${maxApplicants ?? '-'} | includeUnknownApplicants=${includeUnknownApplicants ?? '-'} | postedWithinDays=${args.postedWithinDays ?? '-'}`
        )
        const results = await features.searchJobTag(tag, {
          maxResults: args.maxResults,
          maxPages: args.maxPages,
          maxApplicants,
          postedWithinDays: args.postedWithinDays,
          easyApplyOnly,
          includeUnknownApplicants
        })
        logJobs('Buscar jobs', results)
        return results
      }
    case 'catch-jobs':
      {
        const tag = (args.tag || defaultTag).trim() || undefined
        const easyApplyOnly = args.easyApplyOnly ?? true
        const maxApplicants = args.maxApplicants
        const includeUnknownApplicants = args.includeUnknownApplicants
        console.log(
          `[bot] Filtros: easyApplyOnly=${easyApplyOnly} | maxApplicants=${maxApplicants ?? '-'} | includeUnknownApplicants=${includeUnknownApplicants ?? '-'} | postedWithinDays=${args.postedWithinDays ?? '-'}`
        )
        const results = await features.catchJobs(tag, {
          maxResults: args.maxResults,
          maxPages: args.maxPages,
          maxApplicants,
          postedWithinDays: args.postedWithinDays,
          easyApplyOnly,
          includeUnknownApplicants
        })
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
      if (!args.profileUrl) throw new Error('missing-profile-url')
      return features.sendConnection(
        args.profileUrl,
        args.message ? { message: args.message } : undefined
      )
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

  const discord = new DiscordClient(env.discord)

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

  const linkedinFeatures = new LinkedinFeatures(page, discord)
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
  console.log(`[bot] ${title}: ${jobs.length}`)
  if (!jobs.length) return
  for (const [idx, job] of jobs.entries()) {
    const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
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
