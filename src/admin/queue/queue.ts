import { Queue } from "bullmq";
import { env } from "../../interactor/shared/env";

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

export const jobQueue: Queue | null = env.redis.url
  ? new Queue("linkedin-jobs", {
      connection: parseRedisConnection(env.redis.url),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    })
  : null;
