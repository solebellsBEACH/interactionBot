import type { LinkedinCommandActions, UpvoteOptions } from "../interactor/features/actions/commands/types";
import type { SearchJobTagOptions } from "../interactor/features/actions/scrap/scraps";

export type AdminProcessType =
  | "easy-apply"
  | "search-jobs"
  | "apply-jobs"
  | "connect"
  | "upvote-posts"
  | "profile-review";
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
  }

  getState() {
    return {
      running: this._running,
      history: [...this._history],
    };
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

    void run()
      .then((result) => {
        processRecord.status = "succeeded";
        processRecord.endedAt = new Date().toISOString();
        processRecord.summary = result.summary;
        processRecord.output = result.output;
      })
      .catch((error: unknown) => {
        processRecord.status = "failed";
        processRecord.endedAt = new Date().toISOString();
        processRecord.summary = "Processo finalizado com erro.";
        processRecord.error = this._formatError(error);
      })
      .finally(() => {
        this._running = null;
        this._history = [processRecord, ...this._history].slice(0, this._historyLimit);
      });

    return processRecord;
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
