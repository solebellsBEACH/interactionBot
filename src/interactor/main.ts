import { BrowserContext, chromium, firefox } from 'playwright';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { CommandName, DiscordClient } from './shared/discord/discord-client';
import { EasyApplyJobResult } from './features/scraps';

let browser: BrowserContext | undefined
let shuttingDown = false

const registerDiscordCommands = (discord: DiscordClient, linkedinFeatures: LinkedinFeatures) => {
  const formatJobs = (jobs: EasyApplyJobResult[], limit = 10) => {
    const lines = jobs.slice(0, limit).map((job, idx) =>
      `${idx + 1}. ${job.title} | ${job.company} | ${job.location} | ${job.url}`
    )
    if (jobs.length > limit) {
      lines.push(`... e mais ${jobs.length - limit} vagas`)
    }
    return lines.join('\n')
  }

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
      const tag = args.join(' ').trim() || env.linkedinURLs.searchJobTag
      if (!tag) {
        await discord.sendMessage('Informe a tag de busca. Ex: !catch-jobs frontend')
        return
      }
      await discord.sendMessage(`Buscando vagas Easy Apply para "${tag}"...`)
      const results = await linkedinFeatures.catchJobs(tag)
      if (results.length === 0) {
        await discord.sendMessage('Nenhuma vaga Easy Apply encontrada.')
        return
      }
      await discord.sendMessage(`Encontradas ${results.length} vagas.`)
      await discord.sendMessage(formatJobs(results))
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
      await discord.sendMessage('Curtindo posts do feed...')
      await linkedinFeatures.upvoteOnPosts()
      await discord.sendMessage('Curtidas finalizadas.')
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

  // const catchJobsResult = await linkedinFeatures.catchJobs()
  // if (catchJobsResult.length === 0) {
  //   console.log('No Easy Apply jobs found.')
  //   return
  // }

  // const limit = Math.max(0, env.linkedinURLs.defaultJobsApplyLength || 0)
  // const jobsToApply = limit > 0 ? catchJobsResult.slice(0, limit) : catchJobsResult
  // console.table(jobsToApply)

  // for (const job of jobsToApply) {
  //   console.log(`Easy Apply: ${job.title} | ${job.company}`)
  //   try {
  //     await linkedinFeatures.easyApply(job.url)
  //     await page.waitForTimeout(1500)
  //   } catch (error) {
  //     console.error('Easy Apply failed for', job.url, error)
  //   }
  // }

  // console.log(easyApplyResult)
  // // await linkedinFeatures.easyApply()
  // // await linkedinFeatures.sendConnection(env.linkedinURLs.feedURL,{
  // //   message:'Example message',
  // // })

}

main().catch((error) => {
  if (shuttingDown) return
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});
