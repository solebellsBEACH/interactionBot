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

type PendingPrompt = {
  request: AdminPromptRequest;
  resolve: (response: AdminPromptResponse) => void;
  timeoutId: NodeJS.Timeout;
};

export class AdminPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminPromptError";
  }
}

export class AdminPromptBroker {
  private _pending: PendingPrompt | null = null;

  getPendingPrompt() {
    return this._pending?.request || null;
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
          resolve(response);
        },
        timeoutId,
      };
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
    pending.resolve(response);
    return pending.request;
  }

  private _createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
