import { BrowserContext, chromium } from 'playwright';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';
import { logger } from './shared/services/logger';

let browser: BrowserContext | undefined
let shuttingDown = false

async function main(): Promise<void> {
  process.once('SIGINT', async () => {
    shuttingDown = true
    logger.info('Encerrando...')
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
  const linkedinFeatures = new LinkedinFeatures(page)

  logger.info('LinkedIn aberto. Feche a janela para encerrar.');
}

main().catch((error) => {
  if (shuttingDown) return
  logger.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});
