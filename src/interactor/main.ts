import { BrowserContext, chromium } from "playwright";

import { AdminPromptBroker } from "../admin/prompt-broker";
import { AdminProcessManager } from "../admin/process-manager";
import { createFastifyServer } from "../admin/fastify-server";
import { startWorkerPool } from "../admin/queue/worker-pool";
import { hydrateControlPlaneContext } from "../api/controllers/auth";
import { createAnalyticsSchema } from "../admin/db/analytics-store";
import { LinkedinFeatures } from "./features/linkedin";
import { DiscordClient } from "./shared/discord/discord-client";
import { env } from "./shared/env";
import { logger } from "./shared/services/logger";
import { hydrateUserProfile } from "./shared/user-profile";
import { resolveScopedPath } from "./shared/utils/user-data-dir";

let browser: BrowserContext | undefined
let adminServer: { start: () => Promise<string>; stop: () => Promise<void>; address: string } | undefined
let shuttingDown = false

async function main(): Promise<void> {
    const discord = new DiscordClient(env.discord)
    const adminPromptBroker = env.admin.enabled ? new AdminPromptBroker() : undefined

    process.once('SIGINT', async () => {
        shuttingDown = true
        logger.info('Encerrando...')
        try {
            await adminServer?.stop().catch(() => undefined)
            await browser?.close()
        } finally {
            process.exit(0)
        }
    })

    await hydrateControlPlaneContext()
    await hydrateUserProfile()
    await createAnalyticsSchema().catch(() => undefined)

    browser = await chromium.launchPersistentContext(resolveScopedPath(env.userDataDir), {
        headless: false,
        slowMo: 50,
    })

    let page = browser.pages()[0]
    if (!page) {
        page = await browser.newPage()
    }

    const linkedinFeatures = new LinkedinFeatures(page, {
        discord,
        adminPromptBroker
    })

    linkedinFeatures.registerDiscordCommands(discord)
    await discord.init()

    if (env.admin.enabled) {
        const processManager = new AdminProcessManager({
            easyApply: linkedinFeatures.easyApply.bind(linkedinFeatures),
            searchJobTag: linkedinFeatures.searchJobTag.bind(linkedinFeatures)
        })

        adminServer = await createFastifyServer({
            host: env.admin.host,
            port: resolveAdminPort(env.admin.port),
            processManager,
            promptBroker: adminPromptBroker
        })

        await adminServer.start()
        logger.info(`Admin disponível em ${adminServer.address}`)

        if (env.queue.enabled) {
            startWorkerPool()
            logger.info("Worker pool BullMQ iniciado.")
        }
    }

    logger.info('LinkedIn aberto. Feche a janela para encerrar.')
}

function resolveAdminPort(port: number) {
    if (!Number.isFinite(port)) return 5050
    const normalized = Math.trunc(port)
    if (normalized < 0 || normalized > 65535) return 5050
    return normalized
}

main().catch((error) => {
    if (shuttingDown) return
    logger.error('Falha ao abrir o LinkedIn:', error)
    process.exit(1)
})
