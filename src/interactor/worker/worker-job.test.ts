import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWorkerUserContext,
  parseWorkerJob,
  resolveWorkerHeadless,
  runWorkerJob,
} from "./worker-job";

test("parseWorkerJob normaliza payload e contexto do worker", () => {
  const job = parseWorkerJob({
    id: "job-1",
    runId: "run-1",
    userId: "tenant-a",
    type: "search-jobs",
    headless: "false",
    payload: {
      tag: "frontend",
      apply: "true",
    },
  });

  assert.deepEqual(job, {
    id: "job-1",
    runId: "run-1",
    userId: "tenant-a",
    type: "search-jobs",
    headless: false,
    payload: {
      tag: "frontend",
      apply: "true",
    },
  });
});

test("resolveWorkerHeadless e applyWorkerUserContext respeitam job e env", () => {
  const previousUserId = process.env.BOT_USER_ID;
  const previousRunId = process.env.BOT_RUN_ID;
  const previousHeadless = process.env.WORKER_HEADLESS;

  try {
    delete process.env.BOT_USER_ID;
    delete process.env.BOT_RUN_ID;
    process.env.WORKER_HEADLESS = "false";

    assert.equal(resolveWorkerHeadless({ type: "reset-session" }), false);

    applyWorkerUserContext({
      type: "reset-session",
      userId: "tenant-b",
      runId: "run-2",
    });

    assert.equal(process.env.BOT_USER_ID, "tenant-b");
    assert.equal(process.env.BOT_RUN_ID, "run-2");
    assert.equal(resolveWorkerHeadless({ type: "reset-session", headless: true }), true);
  } finally {
    restoreEnv("BOT_USER_ID", previousUserId);
    restoreEnv("BOT_RUN_ID", previousRunId);
    restoreEnv("WORKER_HEADLESS", previousHeadless);
  }
});

test("runWorkerJob agrega sucesso e falha em apply-jobs", async () => {
  const attempts: string[] = [];
  const features = {
    async easyApply(jobUrl: string) {
      attempts.push(jobUrl);
      if (jobUrl.includes("fail")) {
        throw new Error("apply-failed");
      }
      return [];
    },
  };

  const result = await runWorkerJob(features as any, {
    type: "apply-jobs",
    payload: {
      jobUrls: ["https://linkedin/jobs/ok", "https://linkedin/jobs/fail"],
      waitBetweenMs: 0,
    },
  });

  assert.deepEqual(attempts, [
    "https://linkedin/jobs/ok",
    "https://linkedin/jobs/fail",
  ]);
  assert.equal(result.summary, "1 aplicação(ões) concluída(s) em 2 vaga(s).");
  assert.deepEqual(result.output, {
    attempted: 2,
    applied: 1,
    failed: ["https://linkedin/jobs/fail"],
  });
});

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};
