import { BrowserContext, chromium } from "playwright";

import { hydrateControlPlaneContext } from "../api/controllers/auth";
import { LinkedinFeatures } from "./features/linkedin";
import { env } from "./shared/env";
import { hydrateUserProfile, flushUserProfile } from "./shared/user-profile";
import { logger } from "./shared/services/logger";
import { prepareBrowserUserDataDir } from "./shared/utils/user-data-dir";
import {
  applyWorkerUserContext,
  readWorkerJob,
  resolveWorkerHeadless,
  runWorkerJob,
} from "./worker/worker-job";
import { WorkerRunReporter } from "./worker/worker-run-reporter";

let browser: BrowserContext | undefined;
let workerSession:
  | {
      path: string;
      sessionMode: "persistent" | "ephemeral";
      cleanup: () => Promise<void>;
    }
  | undefined;
let shuttingDown = false;
let cleanedUp = false;

const cleanupWorkerResources = async (reporter?: WorkerRunReporter) => {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  reporter?.stop();
  await browser?.close().catch(() => undefined);
  await flushUserProfile().catch(() => undefined);
  await workerSession?.cleanup().catch((error) => {
    logger.warn("Falha ao limpar userDataDir efêmero do worker", error);
  });
};

const main = async () => {
  const job = readWorkerJob();
  applyWorkerUserContext(job);
  await hydrateControlPlaneContext();
  await hydrateUserProfile(true);

  const reporter = new WorkerRunReporter(job);
  await reporter.start();

  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    shuttingDown = true;
    logger.info("Encerrando worker...", {
      signal,
      jobId: job.id || null,
      runId: reporter.runId,
    });
    await cleanupWorkerResources(reporter);
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  const headless = resolveWorkerHeadless(job);
  workerSession = await prepareBrowserUserDataDir(env.userDataDir, {
    sessionMode: env.worker.sessionMode === "ephemeral" ? "ephemeral" : "persistent",
    runId: reporter.runId,
    jobId: job.id,
  });
  browser = await chromium.launchPersistentContext(workerSession.path, {
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
      linkedinAccountId: job.linkedinAccountId || null,
      headless,
      sessionMode: workerSession.sessionMode,
      userDataDir: workerSession.path,
    });
    const result = await runWorkerJob(features, job);
    await reporter.succeed(result);
    logger.info(`Worker job concluído: ${job.type}`, {
      runId: reporter.runId,
      summary: result.summary,
    });
  } catch (error) {
    await reporter.fail(error);
    throw error;
  } finally {
    await cleanupWorkerResources(reporter);
  }
};

main().catch((error) => {
  if (shuttingDown) return;
  logger.error("Falha ao executar worker job:", error);
  process.exit(1);
});
