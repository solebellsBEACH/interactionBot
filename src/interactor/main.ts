import { BrowserContext, chromium, firefox } from 'playwright';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { CommandName, DiscordClient } from './shared/discord/discord-client';
import { EasyApplyJobResult } from './features/scraps';

let browser: BrowserContext | undefined
let shuttingDown = false

const registerDiscordCommands = (discord: DiscordClient, linkedinFeatures: LinkedinFeatures) => {
  const formatJobs = (jobs: EasyApplyJobResult[]) => {
    return jobs
      .map((job, idx) => `${idx + 1}. ${job.title} | ${job.company} | ${job.location} | ${job.url}`)
      .join('\n')
  }

  const isAffirmative = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false
    return /^(s|sim|y|yes|ok|1|aplicar|aplica|apply)\b/.test(normalized)
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

  const parseCatchJobsArgs = (args: string[]) => {
    const parts = [...args]
    const numberIndex = parts.findIndex((part) => /^\d+$/.test(part))
    let maxResults: number | undefined
    if (numberIndex >= 0) {
      maxResults = Number(parts[numberIndex])
      parts.splice(numberIndex, 1)
    }
    const tag = parts.join(' ').trim() || undefined
    return {
      tag,
      maxResults: maxResults && maxResults > 0 ? maxResults : undefined
    }
  }

  const parseMaxResultsAnswer = (value: string | null) => {
    if (!value) return undefined
    const normalized = value.trim().toLowerCase()
    if (!normalized) return undefined
    if (/^(todas|todos|all|tudo)$/.test(normalized)) return undefined
    const match = normalized.match(/(\d+)/)
    if (!match) return undefined
    const parsed = Number(match[1])
    return parsed > 0 ? parsed : undefined
  }

  const isStop = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false
    return /^(parar|stop|sair|cancelar)\b/.test(normalized)
  }

  const isSkip = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false
    return /^(skip|pular|nao|não|n)\b/.test(normalized)
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

      await discord.sendMessage(`Buscando vagas Easy Apply para "${tag}"...`)
      const results = await linkedinFeatures.searchJobTag(
        tag,
        maxResults ? { maxResults } : undefined
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
        } catch (error) {
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

async function main(): Promise<void> {
  const discord = new DiscordClient(env.discord)

  process.once('SIGINT', async () => {
    shuttingDown = true
    console.log('Encerrando...')
    try {
      await browser?.close()
    } finally {
      process.exit(0)
    }
  })

  browser = await chromium.launchPersistentContext(
    env.userDataDir,
    {
      headless: false,
      slowMo: 50,
    }
  )

  const page = await browser.pages()[0]
  const linkedinFeatures = new LinkedinFeatures(page, discord)
  registerDiscordCommands(discord, linkedinFeatures)
  await discord.init()
  console.log('LinkedIn aberto. Feche a janela para encerrar.');

}

main().catch((error) => {
  if (shuttingDown) return
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});
