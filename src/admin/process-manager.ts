import type { EasyApplyStepValues } from "../interactor/shared/interface/easy-apply/step-values.types";
import type {
  AppliedJobsRangePreset,
  AppliedJobsScanResult,
  EasyApplyJobResult,
  ScanAppliedJobsOptions,
  SearchJobTagOptions,
} from "../interactor/shared/interface/scrap/jobs.types";
import type { UserProfile } from "../interactor/shared/interface/user/user-profile.types";
import { logger } from "../interactor/shared/services/logger";
import { env } from "../interactor/shared/env";
import { adminRuntimeStore } from "./admin-runtime-store";
import { redis } from "./redis/client";
import { jobQueue } from "./queue/queue";
import { saveAppliedJobsBatch, saveJobSearch } from "./db/analytics-store";
import type { WorkerJob } from "../interactor/worker/worker-job";

const REDIS_HISTORY_KEY = "bot:process:history";

type UpvoteOptions = {
  maxLikes?: number
  tag?: string
}

type LinkedinCommandActions = {
  easyApply: (jobUrl?: string) => Promise<EasyApplyStepValues[]>
  searchJobTag: (searchJobTag: string, options?: SearchJobTagOptions) => Promise<EasyApplyJobResult[]>
  sendConnection: (profileUrl: string, inMailOptions?: { message: string }) => Promise<void>
  upvoteOnPosts: (options?: UpvoteOptions) => Promise<string[]>
  scanAppliedJobs?: (options?: ScanAppliedJobsOptions) => Promise<AppliedJobsScanResult>
  reviewOwnProfile?: () => Promise<UserProfile>
  resetSession?: () => Promise<{
    cleared: {
      applications: number
      easyApplyResponses: number
      fieldAnswers: number
      gptInteractions: number
    }
  }>
}

export type AdminProcessType =
  | "easy-apply"
  | "search-jobs"
  | "apply-jobs"
  | "connect"
  | "upvote-posts"
  | "scan-applied-jobs"
  | "profile-review"
  | "reset-session";
export type AdminProcessStatus = "running" | "succeeded" | "failed";

export type AdminProcessRecord = {
  id: string;
  type: AdminProcessType;
  status: AdminProcessStatus;
  startedAt: string;
  endedAt?: string;
  input: Record<string, unknown>;
  summary: string;
  error?: string;
  output?: unknown;
};

export type SearchJobsPayload = {
  tag: string;
  options?: SearchJobTagOptions;
  apply?: boolean;
  maxApplies?: number;
  waitBetweenMs?: number;
};

export type ApplyJobsPayload = {
  jobUrls: string[];
  waitBetweenMs?: number;
};

export type EasyApplyPayload = {
  jobUrl?: string;
};

export type ConnectPayload = {
  profileUrl: string;
  message?: string;
};

export type UpvotePayload = {
  tag: string;
  maxLikes?: number;
};

export type ScanAppliedJobsPayload = {
  periodPreset?: AppliedJobsRangePreset;
  customDays?: number;
};

type ProcessResult = {
  summary: string;
  output?: unknown;
};

type ProcessRunner = () => Promise<ProcessResult>;

export class ProcessBusyError extends Error {
  readonly running: AdminProcessRecord;

  constructor(running: AdminProcessRecord) {
    super("Já existe um processo em execução.");
    this.name = "ProcessBusyError";
    this.running = running;
  }
}

export class ProcessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessValidationError";
  }
}

export class AdminProcessManager {
  private readonly _actions: LinkedinCommandActions;
  private readonly _historyLimit: number;
  private _running: AdminProcessRecord | null = null;
  private _history: AdminProcessRecord[] = [];

  constructor(actions: LinkedinCommandActions, options?: { historyLimit?: number }) {
    this._actions = actions;
    this._historyLimit = options?.historyLimit ?? 30;
    void this._loadHistoryFromRedis();
  }

  getState() {
    return {
      running: this._running,
      history: [...this._history],
    };
  }

  private async _loadHistoryFromRedis() {
    if (!redis) return;
    try {
      const raw = await redis.get(REDIS_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AdminProcessRecord[];
      if (Array.isArray(parsed)) {
        this._history = parsed.slice(0, this._historyLimit);
      }
    } catch {
      // ignore — start fresh
    }
  }

  private _persistHistoryToRedis() {
    if (!redis) return;
    void redis
      .set(REDIS_HISTORY_KEY, JSON.stringify(this._history))
      .catch(() => undefined);
  }

  startEasyApply(payload: EasyApplyPayload) {
    const jobUrl = payload.jobUrl?.trim();

    return this._startProcess(
      "easy-apply",
      { jobUrl: jobUrl || "default" },
      async () => {
        const steps = await this._actions.easyApply(jobUrl || undefined);
        const totalFields = steps.reduce(
          (sum, step) => sum + (step.inputValues?.length || 0) + (step.selectValues?.length || 0),
          0
        );

        return {
          summary: `Easy Apply finalizado com ${steps.length} etapa(s) e ${totalFields} campo(s).`,
          output: {
            steps,
            totalFields,
          },
        };
      }
    );
  }

  startSearchJobs(payload: SearchJobsPayload) {
    const tag = payload.tag?.trim();
    if (!tag) {
      throw new ProcessValidationError("Informe a tag para buscar vagas.");
    }

    const apply = payload.apply ?? true;
    const waitBetweenMs = this._normalizeWaitMs(payload.waitBetweenMs);
    const maxApplies = this._normalizeMaxApplies(payload.maxApplies);

    return this._startProcess(
      "search-jobs",
      { tag, ...(payload.options || {}), apply, maxApplies },
      async () => {
        const results = await this._actions.searchJobTag(tag, payload.options);

        if (!apply) {
          return {
            summary: `${results.length} vaga(s) encontrada(s) para "${tag}".`,
            output: {
              total: results.length,
              jobs: results,
            },
          };
        }

        const jobsPreview = results.slice(0, 50);
        const easyApplyJobs = results.filter((job) => job.easyApply);
        const jobsToApply = maxApplies
          ? easyApplyJobs.slice(0, maxApplies)
          : easyApplyJobs;

        let applied = 0;
        const failed: string[] = [];

        for (let index = 0; index < jobsToApply.length; index++) {
          const job = jobsToApply[index];
          try {
            await this._actions.easyApply(job.url);
            applied++;
          } catch {
            failed.push(job.url);
          }

          if (waitBetweenMs > 0 && index < jobsToApply.length - 1) {
            await this._wait(waitBetweenMs);
          }
        }

        return {
          summary: `${results.length} vaga(s) encontrada(s), ${easyApplyJobs.length} com Easy Apply, ${applied} aplicação(ões) concluída(s) para "${tag}".`,
          output: {
            total: results.length,
            easyApplyTotal: easyApplyJobs.length,
            attempted: jobsToApply.length,
            applied,
            failed: failed.slice(0, 30),
            jobs: jobsPreview,
          },
        };
      }
    );
  }

  startApplyJobs(payload: ApplyJobsPayload) {
    const jobUrls = this._normalizeJobUrls(payload.jobUrls);
    if (jobUrls.length === 0) {
      throw new ProcessValidationError("Selecione ao menos uma vaga para aplicar.");
    }

    const waitBetweenMs = this._normalizeWaitMs(payload.waitBetweenMs);

    return this._startProcess(
      "apply-jobs",
      { jobUrls, waitBetweenMs },
      async () => {
        let applied = 0;
        const failed: string[] = [];

        for (let index = 0; index < jobUrls.length; index++) {
          const jobUrl = jobUrls[index];
          try {
            await this._actions.easyApply(jobUrl);
            applied++;
          } catch {
            failed.push(jobUrl);
          }

          if (waitBetweenMs > 0 && index < jobUrls.length - 1) {
            await this._wait(waitBetweenMs);
          }
        }

        return {
          summary: `${applied} aplicação(ões) concluída(s) em ${jobUrls.length} vaga(s) selecionada(s).`,
          output: {
            attempted: jobUrls.length,
            applied,
            failed: failed.slice(0, 30),
          },
        };
      }
    );
  }

  startConnect(payload: ConnectPayload) {
    const profileUrl = payload.profileUrl?.trim();
    if (!profileUrl) {
      throw new ProcessValidationError("Informe a URL do perfil para conectar.");
    }

    return this._startProcess(
      "connect",
      { profileUrl, message: payload.message || "" },
      async () => {
        const message = payload.message?.trim();
        await this._actions.sendConnection(profileUrl, message ? { message } : undefined);
        return {
          summary: `Convite enviado para ${profileUrl}.`,
        };
      }
    );
  }

  startUpvote(payload: UpvotePayload) {
    const tag = payload.tag?.trim();
    if (!tag) {
      throw new ProcessValidationError("Informe a tag para curtir posts.");
    }

    const maxLikes = payload.maxLikes;
    if (maxLikes !== undefined && (!Number.isFinite(maxLikes) || maxLikes <= 0)) {
      throw new ProcessValidationError("O valor de curtidas deve ser maior que zero.");
    }

    const options: UpvoteOptions = {
      tag,
      ...(maxLikes !== undefined ? { maxLikes } : {}),
    };

    return this._startProcess("upvote-posts", { ...options }, async () => {
      const links = await this._actions.upvoteOnPosts(options);
      return {
        summary: `${links.length} post(s) curtido(s) para "${tag}".`,
        output: {
          total: links.length,
          links,
        },
      };
    });
  }

  startProfileReview() {
    if (!this._actions.reviewOwnProfile) {
      throw new ProcessValidationError("A análise do perfil não está habilitada.");
    }

    return this._startProcess("profile-review", {}, async () => {
      const profile = await this._actions.reviewOwnProfile?.();
      if (!profile) {
        throw new Error("Não foi possível analisar o perfil atual.");
      }

      const stackCount = Object.keys(profile.stackExperience || {}).length;
      const hasReview = Boolean(profile.profileReview?.raw);

      return {
        summary: hasReview
          ? `Perfil analisado com ${stackCount} stack(s) mapeada(s) e review JSON gerado.`
          : `Perfil analisado com ${stackCount} stack(s) mapeada(s).`,
        output: {
          profile,
        },
      };
    });
  }

  startScanAppliedJobs(payload: ScanAppliedJobsPayload = {}) {
    if (!this._actions.scanAppliedJobs) {
      throw new ProcessValidationError("A varredura de vagas aplicadas não está habilitada.");
    }

    const periodPreset = this._normalizeAppliedJobsPreset(payload.periodPreset);
    const customDays = this._normalizeAppliedJobsCustomDays(payload.customDays, periodPreset);

    return this._startProcess("scan-applied-jobs", { periodPreset, customDays }, async () => {
      const result = await this._actions.scanAppliedJobs?.({ periodPreset, customDays });
      if (!result) {
        throw new Error("Não foi possível varrer as vagas aplicadas.");
      }

      const stopLabel = result.stoppedEarly
        ? " Varredura encerrada ao sair da janela escolhida."
        : "";

      return {
        summary: `${result.total} vaga(s) aplicada(s) encontradas no filtro ${result.filterLabel}. ${result.scannedPages} página(s) varridas.${stopLabel}`,
        output: {
          total: result.total,
          scannedPages: result.scannedPages,
          totalPages: result.totalPages,
          filterPreset: result.filterPreset,
          filterDays: result.filterDays,
          filterLabel: result.filterLabel,
          stoppedEarly: result.stoppedEarly,
          jobsPreview: result.jobs.slice(0, 100),
        },
      };
    });
  }

  startResetSession() {
    if (!this._actions.resetSession) {
      throw new ProcessValidationError("O reset de sessão não está habilitado.");
    }

    this._history = [];
    this._persistHistoryToRedis();

    return this._startProcess("reset-session", {}, async () => {
      const result = await this._actions.resetSession?.();
      const cleared = result?.cleared || {
        applications: 0,
        easyApplyResponses: 0,
        fieldAnswers: 0,
        gptInteractions: 0,
      };

      return {
        summary: "Sessão do LinkedIn encerrada e dados locais limpos.",
        output: {
          ...result,
          cleared,
        },
      };
    });
  }

  private _startProcess(
    type: AdminProcessType,
    input: Record<string, unknown>,
    run: ProcessRunner
  ): AdminProcessRecord {
    if (this._running) {
      throw new ProcessBusyError(this._running);
    }

    const processRecord: AdminProcessRecord = {
      id: this._createId(),
      type,
      status: "running",
      startedAt: new Date().toISOString(),
      input,
      summary: "Processo iniciado.",
    };

    this._running = processRecord;
    logger.info(`Processo admin iniciado: ${type}`, { id: processRecord.id, input });
    adminRuntimeStore.recordStep({
      key: `process:${processRecord.id}`,
      source: "process",
      label: `${type} iniciado`,
      detail: "Processo em execução.",
      status: "running",
      meta: {
        processId: processRecord.id,
        type,
      },
    });

    const runner = env.queue.enabled && jobQueue
      ? () => this._runViaQueue(processRecord, type, input)
      : run;

    void runner()
      .then((result) => {
        processRecord.status = "succeeded";
        processRecord.endedAt = new Date().toISOString();
        processRecord.summary = result.summary;
        processRecord.output = result.output;
        logger.info(`Processo admin concluído: ${type}`, {
          id: processRecord.id,
          summary: result.summary,
        });
        adminRuntimeStore.recordStep({
          key: `process:${processRecord.id}`,
          source: "process",
          label: `${type} concluído`,
          detail: result.summary,
          status: "done",
          meta: {
            processId: processRecord.id,
            type,
          },
        });
        void this._saveAnalytics(type, input, result.output).catch(() => undefined);
      })
      .catch((error: unknown) => {
        processRecord.status = "failed";
        processRecord.endedAt = new Date().toISOString();
        processRecord.summary = "Processo finalizado com erro.";
        processRecord.error = this._formatError(error);
        logger.error(`Processo admin falhou: ${type}`, {
          id: processRecord.id,
          error: processRecord.error,
        });
        adminRuntimeStore.recordStep({
          key: `process:${processRecord.id}`,
          source: "process",
          label: `${type} falhou`,
          detail: processRecord.error,
          status: "error",
          meta: {
            processId: processRecord.id,
            type,
          },
        });
      })
      .finally(() => {
        this._running = null;
        this._history = [processRecord, ...this._history].slice(0, this._historyLimit);
        this._persistHistoryToRedis();
      });

    return processRecord;
  }

  private async _runViaQueue(
    processRecord: AdminProcessRecord,
    type: AdminProcessType,
    input: Record<string, unknown>
  ): Promise<ProcessResult> {
    if (!jobQueue) throw new Error("Queue not available");

    const workerJob: WorkerJob = {
      id: processRecord.id,
      type,
      payload: input,
      headless: true,
    };

    const queueEvents = await this._getQueueEvents();
    const job = await jobQueue.add(type, { processRecord, job: workerJob });
    const result = await job.waitUntilFinished(queueEvents);
    return result as ProcessResult;
  }

  private _queueEvents: import("bullmq").QueueEvents | null = null;
  private async _getQueueEvents() {
    if (!this._queueEvents) {
      const { QueueEvents } = await import("bullmq");
      const redisUrl = env.redis.url;
      if (!redisUrl) throw new Error("REDIS_URL required for queue mode");
      const connection = this._parseRedisUrl(redisUrl);
      this._queueEvents = new QueueEvents("linkedin-jobs", { connection });
    }
    return this._queueEvents;
  }

  private _parseRedisUrl(url: string) {
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

  private async _saveAnalytics(
    type: AdminProcessType,
    input: Record<string, unknown>,
    output: unknown
  ): Promise<void> {
    const o = output as Record<string, unknown> | undefined;

    if (type === "scan-applied-jobs") {
      type ScannedJob = { url?: string; title?: string; company?: string; location?: string; appliedAt?: string };
      const jobs = (o?.jobsPreview as ScannedJob[] | undefined) ?? [];
      await saveAppliedJobsBatch(jobs.map((j) => ({ ...j, url: j.url ?? "", source: "scan" })));
    }

    if (type === "search-jobs") {
      const tag = input.tag as string;
      const jobsFound = (o?.total as number) ?? 0;
      const jobsApplied = (o?.applied as number) ?? 0;
      await saveJobSearch({ tag, jobsFound, jobsApplied, location: input.location as string | undefined });
      if (input.apply && o?.jobs) {
        const now = new Date().toISOString();
        type SearchJob = { url?: string; title?: string; company?: string; location?: string };
        const jobs = o.jobs as SearchJob[];
        await saveAppliedJobsBatch(jobs.map((j) => ({ ...j, url: j.url ?? "", appliedAt: now, source: "search-jobs", tag })));
      }
    }

    if (type === "easy-apply") {
      const jobUrl = input.jobUrl as string | undefined;
      if (jobUrl && jobUrl !== "default") {
        await saveAppliedJobsBatch([{ url: jobUrl, appliedAt: new Date().toISOString(), source: "easy-apply" }]);
      }
    }

    if (type === "apply-jobs") {
      const jobUrls = input.jobUrls as string[] | undefined;
      if (jobUrls?.length) {
        const failed = new Set((o?.failed as string[] | undefined) ?? []);
        const succeeded = jobUrls.filter((u) => !failed.has(u));
        const now = new Date().toISOString();
        await saveAppliedJobsBatch(succeeded.map((url) => ({ url, appliedAt: now, source: "apply-jobs" })));
      }
    }
  }

  private _createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private _formatError(error: unknown) {
    if (error instanceof Error) return error.message || error.name;
    if (typeof error === "string") return error;
    return "Erro desconhecido";
  }

  private _normalizeMaxApplies(value?: number) {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value)) return undefined;
    const normalized = Math.trunc(value);
    if (normalized <= 0) return undefined;
    return Math.min(normalized, 100);
  }

  private _normalizeAppliedJobsPreset(value?: AppliedJobsRangePreset): AppliedJobsRangePreset {
    if (value === "week" || value === "month" || value === "quarter" || value === "custom") {
      return value;
    }
    return "month";
  }

  private _normalizeAppliedJobsCustomDays(
    value: number | undefined,
    periodPreset: AppliedJobsRangePreset
  ) {
    if (periodPreset !== "custom") return undefined;
    if (!Number.isFinite(value)) {
      throw new ProcessValidationError("Informe a quantidade de dias para o filtro custom.");
    }

    const normalized = Math.trunc(value ?? 0);
    if (normalized <= 0) {
      throw new ProcessValidationError("O filtro custom deve ter ao menos 1 dia.");
    }

    return Math.min(normalized, 3650);
  }

  private _normalizeWaitMs(value?: number) {
    if (value === undefined) return 1_500;
    if (!Number.isFinite(value)) return 1_500;
    const normalized = Math.trunc(value);
    if (normalized < 0) return 0;
    return Math.min(normalized, 10_000);
  }

  private _normalizeJobUrls(values: string[]) {
    const normalized = Array.isArray(values)
      ? values
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      : [];

    return Array.from(new Set(normalized)).slice(0, 100);
  }

  private async _wait(ms: number) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
