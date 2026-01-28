import { BrowserContext, chromium } from 'playwright';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { DiscordClient } from './shared/discord/discord-client';

let browser: BrowserContext | undefined
let shuttingDown = false

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

  // linkedinFeatures.registerDiscordCommands(discord)
  await discord.init()
   console.log('LinkedIn aberto. Feche a janela para encerrar.');

  linkedinFeatures.sendConnection('https://www.linkedin.com/in/rafaela-guimar%C3%A3es-a09589133/')
}

main().catch((error) => {
  if (shuttingDown) return
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});
