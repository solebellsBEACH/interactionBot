import {
  answerAdminPrompt,
  getAdminPromptState,
  requestAdminPrompt,
  updateAdminPromptSettings,
  waitForAdminPromptAnswer,
  type AdminPromptItem,
  type AdminPromptRequest,
  type AdminPromptResponse,
  type AdminPromptSettings,
} from "../api/controllers/admin-prompts";
import { logger } from "../interactor/shared/services/logger";
import { hasBotControlPlaneContext } from "../interactor/shared/utils/user-data-dir";
import { adminRuntimeStore } from "./admin-runtime-store";

export type AdminPromptKind = "confirm-gpt" | "answer-field";
export type AdminPromptFieldType = "input" | "select";
export type AdminPromptAction = "confirm" | "manual" | "skip" | "cancel" | "timeout";

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

  async getPendingPrompt() {
    if (this._shouldUseRemote()) {
      try {
        const state = await getAdminPromptState();
        return state.item || null;
      } catch {
        // fallback local
      }
    }

    return this._pending?.request || null;
  }

  async getSettings() {
    if (this._shouldUseRemote()) {
      try {
        const state = await getAdminPromptState();
        this._settings = { ...state.settings };
        return { ...this._settings };
      } catch {
        // fallback local
      }
    }

    return { ...this._settings };
  }

  async updateSettings(next: Partial<AdminPromptSettings>) {
    if (this._shouldUseRemote()) {
      try {
        const data = await updateAdminPromptSettings(next);
        this._settings = { ...data.settings };
        return this.getSettings();
      } catch (error) {
        throw new AdminPromptError(this._formatError(error));
      }
    }

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
    if (this._shouldUseRemote()) {
      return this._requestPromptRemote(request, timeoutMs);
    }

    return this._requestPromptLocal(request, timeoutMs);
  }

  async answerPrompt(id: string, response: AdminPromptResponse) {
    if (this._shouldUseRemote()) {
      try {
        const data = await answerAdminPrompt(id, response);
        return data.item;
      } catch (error) {
        throw new AdminPromptError(this._formatError(error));
      }
    }

    return this._answerPromptLocal(id, response);
  }

  private async _requestPromptRemote(
    request: Omit<AdminPromptRequest, "id" | "createdAt">,
    timeoutMs: number
  ) {
    const promptRequest: AdminPromptRequest = {
      ...request,
      id: this._createId(),
      createdAt: new Date().toISOString(),
      timeoutMs,
    };
    const promptLabel = this._buildPromptLabel(promptRequest);
    const promptKey = this._buildPromptKey(promptRequest.id || "");

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

    try {
      const data = await requestAdminPrompt(promptRequest);
      const resolved = await waitForAdminPromptAnswer(data.item.id, timeoutMs);
      this._recordPromptResolution(promptRequest, resolved);
      return resolved;
    } catch (error) {
      const message = this._formatError(error);
      if (message.includes("Já existe uma resposta pendente")) {
        throw new AdminPromptError("Já existe uma resposta pendente no admin.");
      }
      throw new AdminPromptError(message);
    }
  }

  private async _requestPromptLocal(
    request: Omit<AdminPromptRequest, "id" | "createdAt">,
    timeoutMs: number
  ) {
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
      const promptKey = this._buildPromptKey(promptRequest.id || "");

      const timeoutId = setTimeout(() => {
        if (!this._pending || this._pending.request.id !== promptRequest.id) return;
        this._pending = null;
        this._recordPromptResolution(promptRequest, { action: "timeout", value: null });
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
          void this.answerPrompt(promptRequest.id || "", {
            action: "confirm",
            value: request.suggestedAnswer || null,
          });
        }, this._settings.autoConfirmDelayMs);
      }
    });
  }

  private _answerPromptLocal(id: string, response: AdminPromptResponse) {
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

    this._recordPromptResolution(pending.request, response);
    pending.resolve(response);
    return pending.request;
  }

  private _recordPromptResolution(
    request: Pick<AdminPromptRequest, "id" | "kind" | "step" | "fieldLabel" | "fieldKey" | "fieldType" | "suggestedAnswer">,
    response: AdminPromptResponse
  ) {
    const promptLabel = this._buildPromptLabel(request);
    const status =
      response.action === "confirm" || response.action === "manual"
        ? "done"
        : response.action === "skip"
          ? "skipped"
          : "error";

    adminRuntimeStore.recordStep({
      key: this._buildPromptKey(request.id || ""),
      source: "prompt",
      label: promptLabel,
      detail: this._buildResponseDetail(response),
      status,
      meta: {
        action: response.action,
        step: request.step,
        field: request.fieldLabel || request.fieldKey || "field",
      },
    });
    logger.info(`Prompt admin resolvido: ${promptLabel}`, {
      action: response.action,
      value: response.value ?? null,
    });
  }

  private _shouldUseRemote() {
    return hasBotControlPlaneContext();
  }

  private _buildPromptKey(id: string) {
    return `prompt:${id}`;
  }

  private _buildPromptLabel(request: Pick<AdminPromptRequest, "step" | "fieldLabel" | "fieldKey">) {
    const field = request.fieldLabel || request.fieldKey || "campo";
    return `Etapa ${request.step}: ${field}`;
  }

  private _buildPromptDetail(
    request: Pick<AdminPromptRequest, "kind" | "fieldType" | "options" | "suggestedAnswer">
  ) {
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

  private _formatError(error: unknown) {
    if (error instanceof Error) return error.message || error.name;
    if (typeof error === "string") return error;
    return "Erro desconhecido";
  }
}

export type { AdminPromptItem, AdminPromptRequest, AdminPromptResponse, AdminPromptSettings };
