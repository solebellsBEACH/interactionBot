import { chromium, firefox } from 'playwright';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { DiscordClient } from './shared/discord/discord-client';

async function main(): Promise<void> {
  const discord = new DiscordClient(env.discord)
  await discord.init()

  const browser = await chromium.launchPersistentContext(
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
  if (catchJobsResult.length > 0) {
    console.table(catchJobsResult)
  } else {
    console.log('No Easy Apply jobs found.')
  }

  // const jobUrl = process.env.LINKEDIN_JOB_URL?.trim();
  // const easyApplyResult = await linkedinFeatures.easyApply(jobUrl || undefined);

  // console.log(easyApplyResult)
  // // await linkedinFeatures.easyApply()
  // // await linkedinFeatures.sendConnection(env.linkedinURLs.feedURL,{
  // //   message:'Example message',
  // // })

}

main().catch((error) => {
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});
