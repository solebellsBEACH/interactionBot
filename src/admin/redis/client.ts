import Redis from "ioredis";
import { env } from "../../interactor/shared/env";

function createRedisClient(): Redis | null {
  const url = env.redis.url;
  if (!url) return null;

  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  client.on("error", () => {
    // suppress connection errors — app runs without Redis
  });

  process.on("exit", () => {
    client.disconnect();
  });

  return client;
}

export const redis = createRedisClient();
