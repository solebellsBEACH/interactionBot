import { Worker as BullWorker } from "bullmq";
import { spawn } from "child_process";
import path from "path";
import { adminRuntimeStore } from "../admin-runtime-store";
import { env } from "../../interactor/shared/env";
import type { WorkerJob } from "../../interactor/worker/worker-job";
import type { AdminProcessRecord } from "../process-manager";

type WorkerPoolJobData = {
  processRecord: AdminProcessRecord;
  job: WorkerJob;
};

const WORKER_SCRIPT = path.resolve(process.cwd(), "src", "interactor", "worker.ts");

function parseRedisConnection(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "127.0.0.1",
      port: u.port ? Number(u.port) : 6379,
      password: u.password || undefined,
      db: u.pathname ? Number(u.pathname.slice(1)) || 0 : 0,
    };
  } catch {
    return { host: "127.0.0.1", port: 6379 };
  }
}

function spawnWorkerProcess(job: WorkerJob): Promise<{ summary: string; output?: unknown }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register", WORKER_SCRIPT],
      {
        env: {
          ...process.env,
          BOT_JOB_JSON: JSON.stringify(job),
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const lines: string[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) lines.push(trimmed);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          adminRuntimeStore.recordStep({
            source: "worker",
            label: trimmed.slice(0, 120),
            status: "running",
          });
        }
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        const lastLine = lines[lines.length - 1];
        let result: { summary: string; output?: unknown } = { summary: "Processo concluído." };
        if (lastLine) {
          try {
            result = JSON.parse(lastLine);
          } catch {
            result = { summary: lastLine };
          }
        }
        resolve(result);
      } else {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

export function startWorkerPool(): BullWorker | null {
  const redisUrl = env.redis.url;
  if (!redisUrl) return null;

  const worker = new BullWorker<WorkerPoolJobData>(
    "linkedin-jobs",
    async (job) => {
      const { processRecord, job: workerJob } = job.data;

      adminRuntimeStore.recordStep({
        key: `process:${processRecord.id}`,
        source: "queue",
        label: `${workerJob.type} despachado para worker`,
        status: "running",
        meta: { processId: processRecord.id },
      });

      const result = await spawnWorkerProcess(workerJob);
      return result;
    },
    {
      connection: parseRedisConnection(redisUrl),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    if (job) {
      adminRuntimeStore.recordStep({
        key: `process:${job.data.processRecord.id}`,
        source: "queue",
        label: `${job.data.job?.type ?? "job"} falhou no worker`,
        detail: err.message,
        status: "error",
      });
    }
  });

  return worker;
}
