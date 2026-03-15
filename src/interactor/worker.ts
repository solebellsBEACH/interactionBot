import { BrowserContext, chromium } from "playwright";

import { hydrateControlPlaneContext } from "../api/controllers/auth";
import { LinkedinFeatures } from "./features/linkedin";
import { env } from "./shared/env";
import { hydrateUserProfile, flushUserProfile } from "./shared/user-profile";
import { logger } from "./shared/services/logger";
import { resolveScopedPath } from "./shared/utils/user-data-dir";
import {
  applyWorkerUserContext,
  readWorkerJob,
  resolveWorkerHeadless,
  runWorkerJob,
} from "./worker/worker-job";
import { WorkerRunReporter } from "./worker/worker-run-reporter";

let browser: BrowserContext | undefined;
let shuttingDown = false;

const main = async () => {
  const job = readWorkerJob();
  applyWorkerUserContext(job);
  await hydrateControlPlaneContext();
  await hydrateUserProfile(true);

  const reporter = new WorkerRunReporter(job);
  await reporter.start();

  process.once("SIGINT", async () => {
    shuttingDown = true;
    logger.info("Encerrando worker...");
    reporter.stop();
    try {
      await browser?.close();
      await flushUserProfile();
    } finally {
      process.exit(0);
    }
  });

  const headless = resolveWorkerHeadless(job);
  browser = await chromium.launchPersistentContext(resolveScopedPath(env.userDataDir), {
    headless,
    slowMo: 0,
  });

  let page = browser.pages()[0];
  if (!page) {
    page = await browser.newPage();
  }

  const features = new LinkedinFeatures(page);

  try {
    logger.info(`Worker job iniciado: ${job.type}`, {
      jobId: job.id || null,
      runId: reporter.runId,
      userId: job.userId || null,
      headless,
    });
    const result = await runWorkerJob(features, job);
    await flushUserProfile();
    await reporter.succeed(result);
    logger.info(`Worker job concluído: ${job.type}`, {
      runId: reporter.runId,
      summary: result.summary,
    });
  } catch (error) {
    await flushUserProfile();
    await reporter.fail(error);
    throw error;
  } finally {
    reporter.stop();
    await browser?.close().catch(() => undefined);
  }
};

main().catch((error) => {
  if (shuttingDown) return;
  logger.error("Falha ao executar worker job:", error);
  process.exit(1);
});
