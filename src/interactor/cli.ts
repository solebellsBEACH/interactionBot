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
  const action = args.action || 'session'
  const defaultTag = env.linkedinURLs.searchJobTag || ''

  switch (action) {
    case 'session':
      return features.ensureSession()
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
    const action = args.action || 'session'
    logger.info(`[bot] Iniciando ação: ${action}`)
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
  }
}

main().catch((error) => {
  if (shuttingDown) return
  logger.error('Falha ao executar ação:', error)
  process.exit(1)
})

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

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
