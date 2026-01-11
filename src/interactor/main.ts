import { BrowserContext, chromium, firefox } from 'playwright';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { DiscordClient } from './shared/discord/discord-client';

let browser: BrowserContext | undefined
let shuttingDown = false

async function main(): Promise<void> {
  const discord = new DiscordClient(env.discord)
  await discord.init()

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
  console.log('LinkedIn aberto. Feche a janela para encerrar.');

  const catchJobsResult = await linkedinFeatures.catchJobs()
  if (catchJobsResult.length === 0) {
    console.log('No Easy Apply jobs found.')
    return
  }

  const limit = Math.max(0, env.linkedinURLs.defaultJobsApplyLength || 0)
  const jobsToApply = limit > 0 ? catchJobsResult.slice(0, limit) : catchJobsResult
  console.table(jobsToApply)

  for (const job of jobsToApply) {
    console.log(`Easy Apply: ${job.title} | ${job.company}`)
    try {
      await linkedinFeatures.easyApply(job.url)
      await page.waitForTimeout(1500)
    } catch (error) {
      console.error('Easy Apply failed for', job.url, error)
    }
  }

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
