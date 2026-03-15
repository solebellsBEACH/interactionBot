import { BrowserContext, chromium } from 'playwright';
import { hydrateControlPlaneContext } from '../api/controllers/auth';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { ERROR_CODES } from './shared/constants/errors';
import { logger } from './shared/services/logger';
import { hydrateUserProfile } from './shared/user-profile';
import { parseArgs, ParsedArgs } from './shared/utils/parse-cli-args';
import { resolveScopedPath } from './shared/utils/user-data-dir';

let browser: BrowserContext | undefined
let shuttingDown = false

type JobFilterLog = {
  easyApplyOnly: boolean
  maxApplicants?: number
  includeUnknownApplicants?: boolean
  postedWithinDays?: number
  workplaceTypes?: string[]
}

const buildJobSearchOptions = (args: ParsedArgs, easyApplyDefault: boolean) => {
  const easyApplyOnly = args.easyApplyOnly ?? easyApplyDefault
  const maxApplicants = args.maxApplicants
  const includeUnknownApplicants = maxApplicants === undefined ? args.includeUnknownApplicants : false
  const postedWithinDays = args.postedWithinDays
  const workplaceTypes = args.workplaceTypes
  return {
    filters: {
      easyApplyOnly,
      maxApplicants,
      includeUnknownApplicants,
      postedWithinDays,
      workplaceTypes
    },
    options: {
      maxResults: args.maxResults,
      maxPages: args.maxPages,
      maxApplicants,
      postedWithinDays,
      easyApplyOnly,
      includeUnknownApplicants,
      workplaceTypes
    }
  }
}

const logJobFilters = (filters: JobFilterLog) => {
  const workplace = filters.workplaceTypes?.length ? filters.workplaceTypes.join(',') : '-'
  logger.info(
    `[bot] Filtros: easyApplyOnly=${filters.easyApplyOnly} | maxApplicants=${filters.maxApplicants ?? '-'} | includeUnknownApplicants=${filters.includeUnknownApplicants ?? '-'} | postedWithinDays=${filters.postedWithinDays ?? '-'} | workplaceTypes=${workplace}`
  )
}

const runAction = async (features: LinkedinFeatures, args: ParsedArgs) => {
  const action = args.action || 'profile'
  const defaultTag = env.linkedinURLs.searchJobTag || ''

  switch (action) {
    case 'session':
      return features.ensureSession()
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
    case 'applied-jobs':
      {
        const result = await features.scanAppliedJobs()
        logger.info(
          `[bot] Applied jobs: total=${result.total} | filter=${result.filterLabel} | scannedPages=${result.scannedPages} | totalPages=${result.totalPages ?? '-'}`
        )
        logAppliedJobs(result.jobs.slice(0, 50))
        return result
      }
    case 'catch-jobs':
      {
        const tag = (args.tag || defaultTag).trim() || undefined
        const { filters, options } = buildJobSearchOptions(args, true)
        logJobFilters(filters)
        const results = await features.catchJobs(tag, options)
        logJobs('Capturar jobs', results)
        if (results.length === 0) return results

        logger.info(`[bot] Iniciando Easy Apply em ${results.length} vagas...`)
        let applied = 0
        for (const [index, job] of results.entries()) {
          logger.info(`[bot] Easy Apply ${index + 1}/${results.length}: ${job.title} | ${job.company}`)
          try {
            await features.easyApply(job.url)
            applied++
          } catch (error) {
            logger.warn(`[bot] Falha Easy Apply: ${job.url}`, error)
          }
          await wait(1500)
        }
        logger.info(`[bot] Easy Apply finalizado. Sucesso: ${applied}/${results.length}`)
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
        if (summary.name) logger.info(`[account] name: ${summary.name}`)
        if (summary.headline) logger.info(`[account] headline: ${summary.headline}`)
        if (summary.location) logger.info(`[account] location: ${summary.location}`)
        if (summary.photoUrl) logger.info(`[account] photo: ${summary.photoUrl}`)
        if (summary.profileUrl) logger.info(`[account] url: ${summary.profileUrl}`)
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
    logger.info('Encerrando...')
    try {
      await browser?.close()
      // no-op: API handles DB connections
    } finally {
      process.exit(0)
    }
  })

  await hydrateControlPlaneContext()
  await hydrateUserProfile()

  browser = await chromium.launchPersistentContext(resolveScopedPath(env.userDataDir), {
    headless,
    slowMo: 50
  })

  let page = (await browser.pages())[0]
  if (!page) {
    page = await browser.newPage()
  }

  const linkedinFeatures = new LinkedinFeatures(page)
  try {
    const action = args.action || 'profile'
    logHeader('Iniciando ação', action)
    const result = await runAction(linkedinFeatures, args)
    logger.info('Ação concluída.')
    if (action === 'search-jobs' || action === 'catch-jobs') {
      printJobsTable(result as Array<{
        title: string
        company: string
        location: string
        url: string
        applicants?: number | null
        postedAt?: string | null
        easyApply?: boolean
      }>)
    }
  } finally {
    await browser?.close().catch((error) => {
      logger.warn('Falha ao fechar o navegador:', error)
    })
    // no-op: API handles DB connections
  }
}

main().catch((error) => {
  if (shuttingDown) return
  logger.error('Falha ao executar ação:', error)
  process.exit(1)
})

function logHeader(title: string, value: string) {
  const padded = value || 'profile'
  logger.info(`[bot] ${title}: ${padded}`)
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
  logger.info(`[bot] ${title}: ${jobs.length}`)
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
    logger.info(`${idx + 1}. ${parts} | ${clean(job.url)}`)
  }
}

function printJobsTable(
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
  if (!jobs || jobs.length === 0) return
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
  const header = ['Vaga', 'Empresa', 'Local', 'Publicado', 'Candidaturas', 'Easy Apply', 'Link']
  console.log(`--\t${header.join('\t')}`)
  for (const job of jobs) {
    const posted = job.postedAt ?? ''
    const applicants = typeof job.applicants === 'number' ? String(job.applicants) : ''
    const easyApply = job.easyApply ? 'Sim' : 'Nao'
    const row = [
      job.title,
      job.company,
      job.location,
      posted,
      applicants,
      easyApply,
      job.url
    ].map((value) => clean(String(value ?? '')))
    console.log(row.join('\t'))
  }
}

function logAppliedJobs(
  jobs: {
    title: string
    company: string
    location: string
    url: string
    appliedAt: string
    page: number
  }[]
) {
  if (!jobs.length) {
    logger.info('[bot] Applied jobs preview: 0')
    return
  }

  logger.info(`[bot] Applied jobs preview: ${jobs.length}`)
  for (const [index, job] of jobs.entries()) {
    logger.info(
      `${index + 1}. ${job.title} | ${job.company} | ${job.location} | ${job.appliedAt || '-'} | page=${job.page} | ${job.url}`
    )
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
  const dash = '—'
  logger.info(`[bot] ${title}: ${connections.length}`)
  if (!connections.length) return
  for (const [idx, connection] of connections.entries()) {
    const name = connection.name ? clean(String(connection.name)) : dash
    const headline = connection.headline ? clean(String(connection.headline)) : dash
    const location = connection.location ? clean(String(connection.location)) : dash
    const label = `${name} | ${headline} | ${location} | ${clean(connection.url)}`
    logger.info(`${idx + 1}. ${label}`)
  }
}

function logList(title: string, items: string[]) {
  logger.info(`[bot] ${title}: ${items.length}`)
  if (!items.length) return
  for (const [idx, item] of items.entries()) {
    logger.info(`${idx + 1}. ${item}`)
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
