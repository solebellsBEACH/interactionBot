import { sql } from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export type AnalyticsAppliedJob = {
  url: string;
  title?: string;
  company?: string;
  location?: string;
  appliedAt?: string;
  source: string;
  tag?: string;
};

export type AnalyticsJobSearch = {
  tag: string;
  location?: string;
  jobsFound: number;
  jobsApplied: number;
};

export type AnalyticsSummary = {
  totalApplied: number;
  thisWeek: number;
  topCompany: string | null;
  topKeyword: string | null;
  timeSeries: { date: string; count: number }[];
  topCompanies: { company: string; count: number }[];
  topKeywords: { keyword: string; count: number }[];
  recentJobs: AnalyticsAppliedJob[];
};

// ── Schema ───────────────────────────────────────────────────────────────────

export async function createAnalyticsSchema(): Promise<void> {
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_applied_jobs (
      url        TEXT PRIMARY KEY,
      title      TEXT,
      company    TEXT,
      location   TEXT,
      applied_at TIMESTAMPTZ,
      source     TEXT NOT NULL DEFAULT 'scan',
      tag        TEXT,
      saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_job_searches (
      id           TEXT PRIMARY KEY,
      tag          TEXT NOT NULL,
      location     TEXT,
      jobs_found   INTEGER NOT NULL DEFAULT 0,
      jobs_applied INTEGER NOT NULL DEFAULT 0,
      searched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function saveAppliedJobsBatch(jobs: AnalyticsAppliedJob[]): Promise<void> {
  if (!sql) return;
  const withUrl = jobs.filter((j) => j.url);
  for (const job of withUrl) {
    await sql`
      INSERT INTO analytics_applied_jobs (url, title, company, location, applied_at, source, tag)
      VALUES (
        ${job.url},
        ${job.title ?? null},
        ${job.company ?? null},
        ${job.location ?? null},
        ${job.appliedAt ? new Date(job.appliedAt) : null},
        ${job.source},
        ${job.tag ?? null}
      )
      ON CONFLICT (url) DO UPDATE SET
        title      = COALESCE(EXCLUDED.title,      analytics_applied_jobs.title),
        company    = COALESCE(EXCLUDED.company,    analytics_applied_jobs.company),
        location   = COALESCE(EXCLUDED.location,   analytics_applied_jobs.location),
        applied_at = COALESCE(EXCLUDED.applied_at, analytics_applied_jobs.applied_at),
        source     = EXCLUDED.source,
        tag        = COALESCE(EXCLUDED.tag,        analytics_applied_jobs.tag)
    `;
  }
}

export async function saveJobSearch(search: AnalyticsJobSearch): Promise<void> {
  if (!sql) return;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await sql`
    INSERT INTO analytics_job_searches (id, tag, location, jobs_found, jobs_applied)
    VALUES (${id}, ${search.tag}, ${search.location ?? null}, ${search.jobsFound}, ${search.jobsApplied})
  `;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  if (!sql) {
    return { totalApplied: 0, thisWeek: 0, topCompany: null, topKeyword: null, timeSeries: [], topCompanies: [], topKeywords: [], recentJobs: [] };
  }

  const [totals] = await sql<{ total: string; this_week: string }[]>`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE saved_at >= NOW() - INTERVAL '7 days') AS this_week
    FROM analytics_applied_jobs
  `;

  const [topCo] = await sql<{ company: string }[]>`
    SELECT company FROM analytics_applied_jobs
    WHERE company IS NOT NULL
    GROUP BY company ORDER BY COUNT(*) DESC LIMIT 1
  `;

  const [topKw] = await sql<{ keyword: string }[]>`
    SELECT tag AS keyword FROM analytics_job_searches
    WHERE tag IS NOT NULL
    GROUP BY tag ORDER BY COUNT(*) DESC LIMIT 1
  `;

  const timeSeries = await sql<{ date: string; count: string }[]>`
    SELECT TO_CHAR(DATE(COALESCE(applied_at, saved_at)), 'YYYY-MM-DD') AS date, COUNT(*) AS count
    FROM analytics_applied_jobs
    WHERE COALESCE(applied_at, saved_at) >= NOW() - INTERVAL '30 days'
    GROUP BY date ORDER BY date
  `;

  const topCompanies = await sql<{ company: string; count: string }[]>`
    SELECT company, COUNT(*) AS count
    FROM analytics_applied_jobs
    WHERE company IS NOT NULL
    GROUP BY company ORDER BY count DESC LIMIT 10
  `;

  const topKeywords = await sql<{ keyword: string; count: string }[]>`
    SELECT tag AS keyword, SUM(jobs_found) AS count
    FROM analytics_job_searches
    WHERE tag IS NOT NULL
    GROUP BY tag ORDER BY count DESC LIMIT 10
  `;

  const recentJobs = await sql<AnalyticsAppliedJob[]>`
    SELECT url, title, company, location,
           applied_at AS "appliedAt", source, tag
    FROM analytics_applied_jobs
    ORDER BY COALESCE(applied_at, saved_at) DESC NULLS LAST
    LIMIT 20
  `;

  return {
    totalApplied: Number(totals?.total ?? 0),
    thisWeek: Number(totals?.this_week ?? 0),
    topCompany: topCo?.company ?? null,
    topKeyword: topKw?.keyword ?? null,
    timeSeries: timeSeries.map((r) => ({ date: r.date, count: Number(r.count) })),
    topCompanies: topCompanies.map((r) => ({ company: r.company, count: Number(r.count) })),
    topKeywords: topKeywords.map((r) => ({ keyword: r.keyword, count: Number(r.count) })),
    recentJobs,
  };
}

export async function getAppliedJobs(options: {
  company?: string;
  tag?: string;
  order?: "asc" | "desc";
  limit?: number;
} = {}): Promise<AnalyticsAppliedJob[]> {
  if (!sql) return [];
  const { company, tag, order = "desc", limit = 200 } = options;
  const co = company ? `%${company}%` : null;
  const tg = tag ?? null;

  if (order === "asc") {
    return sql<AnalyticsAppliedJob[]>`
      SELECT url, title, company, location, applied_at AS "appliedAt", source, tag
      FROM analytics_applied_jobs
      WHERE (${co}::text IS NULL OR company ILIKE ${co ?? ""})
        AND (${tg}::text IS NULL OR tag = ${tg ?? ""})
      ORDER BY COALESCE(applied_at, saved_at) ASC NULLS LAST
      LIMIT ${limit}
    `;
  }
  return sql<AnalyticsAppliedJob[]>`
    SELECT url, title, company, location, applied_at AS "appliedAt", source, tag
    FROM analytics_applied_jobs
    WHERE (${co}::text IS NULL OR company ILIKE ${co ?? ""})
      AND (${tg}::text IS NULL OR tag = ${tg ?? ""})
    ORDER BY COALESCE(applied_at, saved_at) DESC NULLS LAST
    LIMIT ${limit}
  `;
}
