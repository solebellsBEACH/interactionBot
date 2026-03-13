export type AdminPromptKind = "confirm-gpt" | "answer-field";
export type AdminPromptFieldType = "input" | "select";
export type AdminPromptAction = "confirm" | "manual" | "cancel" | "timeout";

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

      const timeoutId = setTimeout(() => {
        if (!this._pending || this._pending.request.id !== promptRequest.id) return;
        this._pending = null;
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
    pending.resolve(response);
    return pending.request;
  }

  private _createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
