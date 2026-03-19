import { sql } from "./client";
import type { UserProfile } from "../../interactor/shared/interface/user/user-profile.types";

export async function createSchema(): Promise<void> {
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  if (!sql) return null;
  const rows = await sql<{ data: UserProfile }[]>`
    SELECT data FROM user_profiles WHERE id = ${userId} LIMIT 1
  `;
  return rows[0]?.data ?? null;
}

export async function saveProfile(userId: string, profile: UserProfile): Promise<void> {
  if (!sql) return;
  // postgres.js sql.json() expects a JSONValue; cast through unknown to satisfy TS
  const jsonData = sql.json(profile as unknown as Parameters<typeof sql.json>[0]);
  await sql`
    INSERT INTO user_profiles (id, data, updated_at)
    VALUES (${userId}, ${jsonData}, NOW())
    ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data,
          updated_at = NOW()
  `;
}
