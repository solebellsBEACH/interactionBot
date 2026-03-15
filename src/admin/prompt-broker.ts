export type AdminPromptKind = "confirm-gpt" | "answer-field";
export type AdminPromptFieldType = "input" | "select";
import { logger } from "../interactor/shared/services/logger";
import { adminRuntimeStore } from "./admin-runtime-store";

export type AdminPromptAction = "confirm" | "manual" | "skip" | "cancel" | "timeout";

export type AdminPromptRequest = {
  id: string;
  kind: AdminPromptKind;
  createdAt: string;
  step: number;
  fieldLabel: string;
  fieldKey?: string;
  fieldType: AdminPromptFieldType;
  prompt: string;
  suggestedAnswer?: string;
  options?: string[];
};

export type AdminPromptResponse = {
  action: AdminPromptAction;
  value?: string | null;
};

export type AdminPromptSettings = {
  autoConfirmGpt: boolean;
  autoConfirmDelayMs: number;
};

type PendingPrompt = {
  request: AdminPromptRequest;
  resolve: (response: AdminPromptResponse) => void;
  timeoutId: NodeJS.Timeout;
  autoConfirmId?: NodeJS.Timeout;
};

export class AdminPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminPromptError";
  }
}

export class AdminPromptBroker {
  private _pending: PendingPrompt | null = null;
  private _settings: AdminPromptSettings = {
    autoConfirmGpt: false,
    autoConfirmDelayMs: 1000,
  };

  getPendingPrompt() {
    return this._pending?.request || null;
  }

  getSettings() {
    return { ...this._settings };
  }

  updateSettings(next: Partial<AdminPromptSettings>) {
    if (typeof next.autoConfirmGpt === "boolean") {
      this._settings.autoConfirmGpt = next.autoConfirmGpt;
    }

    if (
      typeof next.autoConfirmDelayMs === "number" &&
      Number.isFinite(next.autoConfirmDelayMs)
    ) {
      const normalized = Math.trunc(next.autoConfirmDelayMs);
      this._settings.autoConfirmDelayMs = Math.min(Math.max(normalized, 100), 5_000);
    }

    return this.getSettings();
  }

  async requestPrompt(
    request: Omit<AdminPromptRequest, "id" | "createdAt">,
    timeoutMs: number
  ): Promise<AdminPromptResponse> {
    if (this._pending) {
      throw new AdminPromptError("Já existe uma resposta pendente no admin.");
    }

    return new Promise<AdminPromptResponse>((resolve) => {
      const promptRequest: AdminPromptRequest = {
        ...request,
        id: this._createId(),
        createdAt: new Date().toISOString(),
      };
      const promptLabel = this._buildPromptLabel(promptRequest);
      const promptKey = this._buildPromptKey(promptRequest.id);

      const timeoutId = setTimeout(() => {
        if (!this._pending || this._pending.request.id !== promptRequest.id) return;
        this._pending = null;
        adminRuntimeStore.recordStep({
          key: promptKey,
          source: "prompt",
          label: promptLabel,
          detail: "Tempo esgotado aguardando resposta.",
          status: "error",
          meta: {
            action: "timeout",
            step: promptRequest.step,
            field: promptRequest.fieldLabel || promptRequest.fieldKey || "field",
          },
        });
        logger.warn(`Prompt admin expirou: ${promptLabel}`);
        resolve({ action: "timeout", value: null });
      }, Math.max(timeoutMs, 1_000));

      this._pending = {
        request: promptRequest,
        resolve: (response) => {
          clearTimeout(timeoutId);
          if (this._pending?.autoConfirmId) {
            clearTimeout(this._pending.autoConfirmId);
          }
          resolve(response);
        },
        timeoutId,
      };

      adminRuntimeStore.recordStep({
        key: promptKey,
        source: "prompt",
        label: promptLabel,
        detail: this._buildPromptDetail(promptRequest),
        status: "waiting",
        meta: {
          kind: promptRequest.kind,
          step: promptRequest.step,
          field: promptRequest.fieldLabel || promptRequest.fieldKey || "field",
          fieldType: promptRequest.fieldType,
        },
      });
      logger.info(`Prompt admin aguardando resposta: ${promptLabel}`);

      if (request.kind === "confirm-gpt" && this._settings.autoConfirmGpt) {
        this._pending.autoConfirmId = setTimeout(() => {
          if (!this._pending || this._pending.request.id !== promptRequest.id) return;
          this.answerPrompt(promptRequest.id, {
            action: "confirm",
            value: request.suggestedAnswer || null,
          });
        }, this._settings.autoConfirmDelayMs);
      }
    });
  }

  answerPrompt(id: string, response: AdminPromptResponse) {
    const pending = this._pending;
    if (!pending) {
      throw new AdminPromptError("Nenhuma resposta pendente no admin.");
    }
    if (pending.request.id !== id) {
      throw new AdminPromptError("A resposta pendente foi atualizada. Recarregue o painel.");
    }

    this._pending = null;
    clearTimeout(pending.timeoutId);
    if (pending.autoConfirmId) {
      clearTimeout(pending.autoConfirmId);
    }

    const promptLabel = this._buildPromptLabel(pending.request);
    const status =
      response.action === "confirm" || response.action === "manual"
        ? "done"
        : response.action === "skip"
          ? "skipped"
          : "error";

    adminRuntimeStore.recordStep({
      key: this._buildPromptKey(pending.request.id),
      source: "prompt",
      label: promptLabel,
      detail: this._buildResponseDetail(response),
      status,
      meta: {
        action: response.action,
        step: pending.request.step,
        field: pending.request.fieldLabel || pending.request.fieldKey || "field",
      },
    });
    logger.info(`Prompt admin resolvido: ${promptLabel}`, {
      action: response.action,
      value: response.value ?? null,
    });

    pending.resolve(response);
    return pending.request;
  }

  private _buildPromptKey(id: string) {
    return `prompt:${id}`;
  }

  private _buildPromptLabel(request: AdminPromptRequest) {
    const field = request.fieldLabel || request.fieldKey || "campo";
    return `Etapa ${request.step}: ${field}`;
  }

  private _buildPromptDetail(request: AdminPromptRequest) {
    if (request.kind === "confirm-gpt") {
      return request.suggestedAnswer
        ? `Confirmar sugestão do GPT: ${this._truncate(request.suggestedAnswer)}`
        : "Confirmar sugestão do GPT.";
    }

    if (request.fieldType === "select") {
      const count = Array.isArray(request.options) ? request.options.length : 0;
      return `Escolher opção manual${count ? ` (${count} opções)` : ""}.`;
    }

    return "Preencher valor manual.";
  }

  private _buildResponseDetail(response: AdminPromptResponse) {
    if (response.action === "confirm") {
      return "Resposta do GPT confirmada.";
    }
    if (response.action === "manual") {
      return response.value
        ? `Resposta manual enviada: ${this._truncate(response.value)}`
        : "Resposta manual enviada.";
    }
    if (response.action === "skip") {
      return "Campo/opção pulado no admin.";
    }
    if (response.action === "cancel") {
      return "Prompt cancelado no admin.";
    }
    return "Prompt encerrado por timeout.";
  }

  private _createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private _truncate(value: string, maxLength = 140) {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
  }
}
