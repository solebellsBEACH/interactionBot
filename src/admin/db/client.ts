import postgres from "postgres";
import { env } from "../../interactor/shared/env";

function createSqlClient(): ReturnType<typeof postgres> | null {
  const url = env.db.url;
  if (!url) return null;

  return postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
  });
}

export const sql = createSqlClient();
