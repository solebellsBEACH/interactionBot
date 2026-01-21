import { env } from '../shared/env'
import { LinkedinFeatures } from '../features/linkedin'
import { CommandName, DiscordClient } from '../shared/discord/discord-client'
import { EasyApplyJobResult } from '../features/scraps'

const GLOBAL_GEO_ID = '92000000'

const formatJobs = (jobs: EasyApplyJobResult[]) => {
  return jobs
    .map((job, idx) => `${idx + 1}. ${job.title} | ${job.company} | ${job.location} | ${job.url}`)
    .join('\n')
}

const normalizeAnswer = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

const isAffirmative = (value: string) => {
  const normalized = normalizeAnswer(value)
  if (!normalized) return false
  return /^(s|sim|y|yes|ok|1|aplicar|aplica|apply)\b/.test(normalized)
}

const isNegative = (value: string) => {
  const normalized = normalizeAnswer(value)
  if (!normalized) return false
  return /^(n|nao|no)\b/.test(normalized)
}

const parseQuantityAndTag = (value: string) => {
  const trimmed = value.trim()
  const match = trimmed.match(/(\d+)/)
  const count = match ? Number(match[1]) : 0
  const remainder = match ? trimmed.replace(match[1], '').trim() : ''
  let tag = remainder.replace(/^posts?\s+de\s+/i, '').replace(/^posts?\s+/i, '').trim()
  if (!tag) {
    tag = remainder.replace(/^de\s+/i, '').trim()
  }
  return {
    count: Number.isNaN(count) ? 0 : count,
    tag: tag || undefined
  }
}

const normalizeArgValue = (value?: string) => {
  if (!value) return undefined
  return value.replace(/[+_]/g, ' ').trim()
}

const parseArgNumber = (value?: string) => {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed
}

const parseCatchJobsArgs = (args: string[]) => {
  const parts = [...args]
  const leftover: string[] = []
  let maxResults: number | undefined
  let maxPages: number | undefined
  let location: string | undefined

  const parseInline = (rawValue: string, normalizedValue: string, keys: string[]) => {
    for (const key of keys) {
      if (normalizedValue.startsWith(`${key}:`)) {
        const idx = rawValue.indexOf(':')
        return normalizeArgValue(rawValue.slice(idx + 1))
      }
      if (normalizedValue.startsWith(`${key}=`)) {
        const idx = rawValue.indexOf('=')
        return normalizeArgValue(rawValue.slice(idx + 1))
      }
    }
    return undefined
  }

  const isBoundaryToken = (value: string) => {
    if (!value) return true
    const lowered = value.toLowerCase()
    if (lowered.startsWith('--')) return true
    const match = lowered.match(/^([a-z0-9_-]+)[:=]/)
    if (!match) return false
    const key = match[1]
    return [
      'loc',
      'location',
      'local',
      'localizacao',
      'pages',
      'page',
      'paginas',
      'pagina',
      'max',
      'limit',
      'results',
      'vagas'
    ].includes(key)
  }

  const collectValue = (startIndex: number) => {
    const tokens: string[] = []
    let idx = startIndex
    while (idx < parts.length && !isBoundaryToken(parts[idx])) {
      tokens.push(parts[idx])
      idx++
    }
    return {
      value: normalizeArgValue(tokens.join(' ')),
      endIndex: idx - 1
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]
    const normalized = raw.toLowerCase()
    if (normalized === '--loc' || normalized === '--location' || normalized === '--local' || normalized === '--localizacao') {
      const collected = collectValue(i + 1)
      location = collected.value
      i = collected.endIndex
      continue
    }
    if (normalized === '--pages' || normalized === '--page' || normalized === '--paginas' || normalized === '--pagina' || normalized === '--max-pages') {
      maxPages = parseArgNumber(parts[i + 1])
      i++
      continue
    }
    if (normalized === '--max' || normalized === '--limit' || normalized === '--results' || normalized === '--max-results' || normalized === '--max-vagas') {
      maxResults = parseArgNumber(parts[i + 1])
      i++
      continue
    }

    const inlineLocation = parseInline(raw, normalized, ['loc', 'location', 'local', 'localizacao'])
    if (inlineLocation) {
      location = inlineLocation
      continue
    }
    const inlinePages = parseInline(raw, normalized, ['pages', 'page', 'paginas', 'pagina'])
    if (inlinePages) {
      maxPages = parseArgNumber(inlinePages)
      continue
    }
    const inlineMax = parseInline(raw, normalized, ['max', 'limit', 'results', 'vagas'])
    if (inlineMax) {
      maxResults = parseArgNumber(inlineMax)
      continue
    }

    if (!maxResults && /^\d+$/.test(raw)) {
      maxResults = Number(raw)
      continue
    }

    leftover.push(raw)
  }

  const tag = leftover.join(' ').trim() || undefined
  return {
    tag,
    location,
    maxPages,
    maxResults
  }
}

const parseMaxResultsAnswer = (value: string | null) => {
  if (!value) return undefined
  const normalized = normalizeAnswer(value)
  if (!normalized) return undefined
  if (/^(todas|todos|all|tudo)$/.test(normalized)) return undefined
  const match = normalized.match(/(\d+)/)
  if (!match) return undefined
  const parsed = Number(match[1])
  return parsed > 0 ? parsed : undefined
}

const parseLocationAnswer = (value: string | null) => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const normalized = normalizeAnswer(trimmed)
  if (/^(skip|pular|nao|n)$/.test(normalized)) return undefined
  return trimmed
}

const parseMaxPagesAnswer = (value: string | null) => {
  if (!value) return undefined
  const normalized = normalizeAnswer(value)
  if (!normalized) return undefined
  if (/^(pular|skip|padrao|default|nao|n)$/.test(normalized)) return undefined
  const match = normalized.match(/(\d+)/)
  if (!match) return undefined
  const parsed = Number(match[1])
  return parsed > 0 ? parsed : undefined
}

const isStop = (value: string) => {
  const normalized = normalizeAnswer(value)
  if (!normalized) return false
  return /^(parar|stop|sair|cancelar)\b/.test(normalized)
}

const isSkip = (value: string) => {
  const normalized = normalizeAnswer(value)
  if (!normalized) return false
  return /^(skip|pular|nao|n)\b/.test(normalized)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const registerDiscordCommands = (discord: DiscordClient, linkedinFeatures: LinkedinFeatures) => {
  discord.setCommandHandlers({
    [CommandName.EasyApply]: async ({ args }) => {
      const jobUrl = args[0] || env.linkedinURLs.jobURL
      if (!jobUrl) {
        await discord.sendMessage('Informe a URL do job. Ex: !easy-apply https://...')
        return
      }
      await discord.sendMessage(`Iniciando Easy Apply: ${jobUrl}`)
      const steps = await linkedinFeatures.easyApply(jobUrl)
      await discord.sendMessage(`Easy Apply finalizado. Passos preenchidos: ${steps.length}`)
    },
    [CommandName.CatchJobs]: async ({ args }) => {
      const parsedArgs = parseCatchJobsArgs(args)
      let tag = parsedArgs.tag
      let maxResults = parsedArgs.maxResults
      let location = parsedArgs.location
      let maxPages = parsedArgs.maxPages
      let geoId: string | undefined

      if (!tag) {
        const tagAnswer = await discord.ask('Qual tag de busca? (ex: react+next)')
        tag = tagAnswer?.trim() || undefined
      }

      if (!tag) {
        await discord.sendMessage('Sem tag. Operacao cancelada.')
        return
      }

      if (!maxResults) {
        const quantityAnswer = await discord.ask('Quantas vagas deseja buscar? (ex: 20 ou "todas")')
        maxResults = parseMaxResultsAnswer(quantityAnswer)
      }

      if (!location) {
        const wantsLocation = await discord.ask('Deseja filtrar por localizacao? (sim/nao ou informe a localizacao)')
        if (wantsLocation) {
          if (isAffirmative(wantsLocation)) {
            const locationAnswer = await discord.ask('Localizacao (ex: Sao Paulo, Remote)')
            location = parseLocationAnswer(locationAnswer)
            if (location) {
              geoId = undefined
            }
          } else if (isNegative(wantsLocation)) {
            geoId = GLOBAL_GEO_ID
          } else if (!isSkip(wantsLocation)) {
            location = parseLocationAnswer(wantsLocation)
            if (location) {
              geoId = undefined
            }
          }
        }
      }

      if (!maxPages) {
        const wantsPages = await discord.ask('Deseja limitar paginas? (sim/nao ou informe o numero)')
        if (wantsPages) {
          const directPages = parseMaxPagesAnswer(wantsPages)
          if (directPages) {
            maxPages = directPages
          } else if (isAffirmative(wantsPages)) {
            const pagesAnswer = await discord.ask('Quantas paginas deseja percorrer? (ex: 2)')
            maxPages = parseMaxPagesAnswer(pagesAnswer)
          }
        }
      }

      const filterSummary = [
        maxResults ? `max: ${maxResults}` : undefined,
        location ? `local: ${location}` : (geoId ? `geoId: ${geoId}` : undefined),
        maxPages ? `paginas: ${maxPages}` : undefined
      ].filter(Boolean).join(' | ')
      const searchMessage = filterSummary
        ? `Buscando vagas Easy Apply para "${tag}" (${filterSummary})...`
        : `Buscando vagas Easy Apply para "${tag}"...`
      await discord.sendMessage(searchMessage)
      const results = await linkedinFeatures.searchJobTag(
        tag,
        {
          ...(maxResults ? { maxResults } : {}),
          ...(location ? { location } : {}),
          ...(geoId ? { geoId } : {}),
          ...(maxPages ? { maxPages } : {})
        }
      )
      if (results.length === 0) {
        await discord.sendMessage('Nenhuma vaga Easy Apply encontrada.')
        return
      }
      await discord.sendMessage(`Encontradas ${results.length} vagas.`)
      await discord.sendMessage(formatJobs(results))
      const autoAnswer = await discord.ask('Quer candidatar automaticamente? (sim/nao)')
      if (!autoAnswer) {
        await discord.sendMessage('Sem resposta. Aplicacao cancelada.')
        return
      }
      const autoApply = isAffirmative(autoAnswer)
      if (!autoApply) {
        await discord.sendMessage('Modo manual: voce pode pular vagas.')
      }
      await discord.sendMessage(`Iniciando Easy Apply em ${results.length} vagas...`)
      for (let index = 0; index < results.length; index++) {
        const job = results[index]
        if (!autoApply) {
          await discord.sendMessage(
            `Vaga ${index + 1}/${results.length}:\n${job.title} | ${job.company} | ${job.location}\n${job.url}`
          )
          const decision = await discord.ask('Aplicar esta vaga? (sim/skip/parar)')
          if (!decision) {
            await discord.sendMessage('Sem resposta. Vaga pulada.')
            continue
          }
          if (isStop(decision)) {
            await discord.sendMessage('Aplicacao interrompida.')
            break
          }
          if (!isAffirmative(decision) && isSkip(decision)) {
            await discord.sendMessage('Vaga pulada.')
            continue
          }
          if (!isAffirmative(decision)) {
            await discord.sendMessage('Vaga pulada.')
            continue
          }
        }
        try {
          await linkedinFeatures.easyApply(job.url)
        } catch {
          await discord.sendMessage(`Falha no Easy Apply: ${job.url}`)
        }
        if ((index + 1) % 5 === 0 || index === results.length - 1) {
          await discord.sendMessage(`Progresso: ${index + 1}/${results.length}`)
        }
        await wait(1500)
      }
      await discord.sendMessage('Easy Apply finalizado.')
    },
    [CommandName.Connect]: async ({ args }) => {
      const profileUrl = args[0]
      if (!profileUrl) {
        await discord.sendMessage('Informe a URL do perfil. Ex: !connect https://...')
        return
      }
      const message = args.slice(1).join(' ').trim()
      await discord.sendMessage(`Enviando convite para ${profileUrl}...`)
      await linkedinFeatures.sendConnection(profileUrl, message ? { message } : undefined)
      await discord.sendMessage('Convite enviado.')
    },
    [CommandName.UpvotePosts]: async () => {
      const quantityAnswer = await discord.ask('Quantos posts voce quer curtir? (ex: 10)')
      if (!quantityAnswer) {
        await discord.sendMessage('Sem resposta. Operacao cancelada.')
        return
      }

      const parsed = parseQuantityAndTag(quantityAnswer)
      if (!parsed.count || parsed.count <= 0) {
        await discord.sendMessage('Quantidade invalida.')
        return
      }

      let tag = parsed.tag
      if (!tag) {
        const tagAnswer = await discord.ask('Qual tag/tema? (ex: react+next)')
        if (!tagAnswer) {
          await discord.sendMessage('Sem resposta. Operacao cancelada.')
          return
        }
        tag = tagAnswer.trim()
      }

      if (!tag) {
        await discord.sendMessage('Tag vazia. Operacao cancelada.')
        return
      }

      await discord.sendMessage(`Curtindo ${parsed.count} posts de "${tag}"...`)
      const links = await linkedinFeatures.upvoteOnPosts({ maxLikes: parsed.count, tag })
      await discord.sendMessage('Curtidas finalizadas.')
      if (links.length === 0) {
        await discord.sendMessage('Nao foi possivel capturar links dos posts.')
        return
      }
      await discord.sendMessage(`Links dos posts curtidos:\n${links.join('\n')}`)
    }
  })
}
