import type { LinkedinFeatures } from "../features/linkedin";
import type { SearchJobTagOptions } from "../shared/interface/scrap/jobs.types";
import { logger } from "../shared/services/logger";

export type WorkerJobType =
  | "easy-apply"
  | "search-jobs"
  | "apply-jobs"
  | "connect"
  | "upvote-posts"
  | "scan-applied-jobs"
  | "profile-review"
  | "reset-session";

export type WorkerJob = {
  id?: string;
  runId?: string;
  userId?: string;
  type: WorkerJobType;
  headless?: boolean;
  payload?: Record<string, unknown>;
};

export type WorkerJobResult = {
  summary: string;
  output?: unknown;
};

const parseArgMap = (argv: string[]) => {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) continue;
    result[key] = next;
    index += 1;
  }
  return result;
};

const readString = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

const readBool = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return undefined;
};

const readNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const readStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
};

const normalizeWaitMs = (value: unknown) => {
  const parsed = readNumber(value);
  if (parsed === undefined) return 1500;
  if (!Number.isFinite(parsed)) return 1500;
  return Math.min(Math.max(Math.trunc(parsed), 0), 10_000);
};

const readJobInput = () => {
  const args = parseArgMap(process.argv.slice(2));
  const rawJob =
    args.job ||
    process.env.BOT_JOB_JSON ||
    undefined;

  if (rawJob) {
    try {
      return JSON.parse(rawJob);
    } catch (error) {
      throw new Error(`worker-job-json-invalid:${String(error)}`);
    }
  }

  const jobFile = args.jobFile || process.env.BOT_JOB_FILE;
  if (jobFile) {
    const fs = require("fs") as typeof import("fs");
    const content = fs.readFileSync(jobFile, "utf-8");
    return JSON.parse(content);
  }

  throw new Error("worker-job-missing");
};

const ensurePayload = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const parseWorkerJob = (value: unknown): WorkerJob => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("worker-job-invalid");
  }

  const record = value as Record<string, unknown>;
  const type = readString(record.type) as WorkerJobType | undefined;
  if (
    type !== "easy-apply" &&
    type !== "search-jobs" &&
    type !== "apply-jobs" &&
    type !== "connect" &&
    type !== "upvote-posts" &&
    type !== "scan-applied-jobs" &&
    type !== "profile-review" &&
    type !== "reset-session"
  ) {
    throw new Error("worker-job-type-invalid");
  }

  return {
    ...(readString(record.id) ? { id: readString(record.id) } : {}),
    ...(readString(record.runId) ? { runId: readString(record.runId) } : {}),
    ...(readString(record.userId) ? { userId: readString(record.userId) } : {}),
    type,
    ...(readBool(record.headless) !== undefined ? { headless: readBool(record.headless) } : {}),
    payload: ensurePayload(record.payload),
  };
};

export const readWorkerJob = () => parseWorkerJob(readJobInput());

export const resolveWorkerHeadless = (job: WorkerJob) => {
  if (job.headless !== undefined) return job.headless;
  const envValue = readBool(process.env.WORKER_HEADLESS);
  return envValue ?? true;
};

export const applyWorkerUserContext = (job: WorkerJob) => {
  if (job.userId) {
    process.env.BOT_USER_ID = job.userId;
  }
  if (job.runId) {
    process.env.BOT_RUN_ID = job.runId;
  }
};

export const runWorkerJob = async (
  features: LinkedinFeatures,
  job: WorkerJob
): Promise<WorkerJobResult> => {
  const payload = ensurePayload(job.payload);

  switch (job.type) {
    case "easy-apply": {
      const jobUrl = readString(payload.jobUrl);
      const steps = await features.easyApply(jobUrl);
      const totalFields = steps.reduce(
        (sum, step) => sum + (step.inputValues?.length || 0) + (step.selectValues?.length || 0),
        0
      );
      return {
        summary: `Easy Apply finalizado com ${steps.length} etapa(s) e ${totalFields} campo(s).`,
        output: { steps, totalFields },
      };
    }
    case "search-jobs": {
      const tag = readString(payload.tag);
      if (!tag) {
        throw new Error("worker-job-missing-tag");
      }

      const apply = readBool(payload.apply) ?? false;
      const maxApplies = readNumber(payload.maxApplies);
      const waitBetweenMs = normalizeWaitMs(payload.waitBetweenMs);
      const options = ensurePayload(payload.options) as SearchJobTagOptions;
      const results = await features.searchJobTag(tag, options);

      if (!apply) {
        return {
          summary: `${results.length} vaga(s) encontrada(s) para "${tag}".`,
          output: { total: results.length, jobs: results },
        };
      }

      const easyApplyJobs = results.filter((item) => item.easyApply);
      const jobsToApply =
        maxApplies && maxApplies > 0 ? easyApplyJobs.slice(0, Math.trunc(maxApplies)) : easyApplyJobs;

      let applied = 0;
      const failed: string[] = [];
      for (let index = 0; index < jobsToApply.length; index++) {
        const current = jobsToApply[index];
        try {
          await features.easyApply(current.url);
          applied += 1;
        } catch (error) {
          failed.push(current.url);
          logger.warn(`[worker] falha em easy-apply ${current.url}`, error);
        }

        if (waitBetweenMs > 0 && index < jobsToApply.length - 1) {
          await wait(waitBetweenMs);
        }
      }

      return {
        summary: `${results.length} vaga(s) encontrada(s), ${applied} aplicação(ões) concluída(s) para "${tag}".`,
        output: {
          total: results.length,
          applied,
          attempted: jobsToApply.length,
          failed,
          jobs: results.slice(0, 50),
        },
      };
    }
    case "apply-jobs": {
      const jobUrls = readStringArray(payload.jobUrls);
      if (jobUrls.length === 0) {
        throw new Error("worker-job-missing-job-urls");
      }

      const waitBetweenMs = normalizeWaitMs(payload.waitBetweenMs);
      let applied = 0;
      const failed: string[] = [];

      for (let index = 0; index < jobUrls.length; index++) {
        const current = jobUrls[index];
        try {
          await features.easyApply(current);
          applied += 1;
        } catch (error) {
          failed.push(current);
          logger.warn(`[worker] falha em easy-apply ${current}`, error);
        }

        if (waitBetweenMs > 0 && index < jobUrls.length - 1) {
          await wait(waitBetweenMs);
        }
      }

      return {
        summary: `${applied} aplicação(ões) concluída(s) em ${jobUrls.length} vaga(s).`,
        output: { attempted: jobUrls.length, applied, failed },
      };
    }
    case "connect": {
      const profileUrl = readString(payload.profileUrl);
      if (!profileUrl) {
        throw new Error("worker-job-missing-profile-url");
      }
      const message = readString(payload.message);
      await features.sendConnection(profileUrl, message ? { message } : undefined);
      return {
        summary: `Convite enviado para ${profileUrl}.`,
      };
    }
    case "upvote-posts": {
      const tag = readString(payload.tag);
      const maxLikes = readNumber(payload.maxLikes);
      const links = await features.upvoteOnPosts({
        ...(tag ? { tag } : {}),
        ...(maxLikes !== undefined ? { maxLikes } : {}),
      });
      return {
        summary: `${links.length} post(s) curtido(s).`,
        output: { total: links.length, links },
      };
    }
    case "scan-applied-jobs": {
      const result = await features.scanAppliedJobs({
        periodPreset: payload.periodPreset as any,
        customDays: readNumber(payload.customDays),
      });
      return {
        summary: `${result.total} vaga(s) aplicada(s) encontradas no filtro ${result.filterLabel}.`,
        output: result,
      };
    }
    case "profile-review": {
      const profile = await features.reviewOwnProfile();
      return {
        summary: `Perfil analisado com ${Object.keys(profile.stackExperience || {}).length} stack(s).`,
        output: { profile },
      };
    }
    case "reset-session": {
      const result = await features.resetSession();
      return {
        summary: "Sessão do LinkedIn encerrada e dados locais limpos.",
        output: result,
      };
    }
    default:
      throw new Error(`worker-job-unsupported:${String(job.type)}`);
  }
};

const wait = async (ms: number) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};
