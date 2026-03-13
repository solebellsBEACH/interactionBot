import { BrowserContext, chromium } from 'playwright';

import { AdminPromptBroker } from '../admin/prompt-broker';
import { AdminProcessManager } from '../admin/process-manager';
import { AdminServer } from '../admin/admin-server';
import { LinkedinFeatures } from './features/linkedin';
import { DiscordClient } from './shared/discord/discord-client';
import { env } from './shared/env';

let browser: BrowserContext | undefined
let adminServer: AdminServer | undefined
let shuttingDown = false

async function main(): Promise<void> {
  const discord = new DiscordClient(env.discord)
  const adminPromptBroker = env.admin.enabled ? new AdminPromptBroker() : undefined

  process.once('SIGINT', async () => {
    shuttingDown = true
    console.log('Encerrando...')
    try {
      await adminServer?.stop().catch(() => undefined)
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

  const page = browser.pages()[0]
  const linkedinFeatures = new LinkedinFeatures(page, {
    discord,
    adminPromptBroker
  })
  linkedinFeatures.registerDiscordCommands(discord)
  await discord.init()

  if (env.admin.enabled) {
    const processManager = new AdminProcessManager({
      easyApply: linkedinFeatures.easyApply.bind(linkedinFeatures),
      searchJobTag: linkedinFeatures.searchJobTag.bind(linkedinFeatures),
      sendConnection: linkedinFeatures.sendConnection.bind(linkedinFeatures),
      upvoteOnPosts: linkedinFeatures.upvoteOnPosts.bind(linkedinFeatures)
    })

    adminServer = new AdminServer({
      host: env.admin.host,
      port: resolveAdminPort(env.admin.port),
      processManager,
      promptBroker: adminPromptBroker
    })

    await adminServer.start()
    console.log(`Admin disponível em ${adminServer.address}`)
  }

  console.log('LinkedIn aberto. Feche a janela para encerrar.')
}

function resolveAdminPort(port: number) {
  if (!Number.isFinite(port)) return 5050
  const normalized = Math.trunc(port)
  if (normalized < 1 || normalized > 65535) return 5050
  return normalized
}

main().catch((error) => {
  if (shuttingDown) return
  console.error('Falha ao abrir o LinkedIn:', error)
  process.exit(1)
})
