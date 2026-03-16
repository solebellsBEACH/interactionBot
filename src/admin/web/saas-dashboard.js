(() => {
  const UI_STORAGE_KEY = "interactionbot.controlPlane.ui.v1";
  const TOKEN_STORAGE_KEY = "interactionbot.controlPlane.token.v1";
  const POLL_INTERVAL_MS = 15000;
  const RUNTIME_LOG_LIMIT = 80;
  const RUNTIME_STEP_LIMIT = 10;
  const WORKSPACE_ROLES = ["owner", "admin", "operator", "viewer"];
  const BILLING_LIMIT_FIELDS = [
    { key: "maxActiveCampaigns", label: "Campanhas ativas" },
    { key: "maxRunsPerDay", label: "Runs por dia" },
    { key: "maxApplyJobsPerDay", label: "Applies por dia" },
    { key: "maxApplyJobsPerRun", label: "Applies por run" },
    { key: "minIntervalMinutes", label: "Intervalo mínimo (min)" },
    { key: "maxLinkedinAccountsPerWorkspace", label: "Contas LinkedIn" },
    { key: "maxWorkerJobsPerDay", label: "Worker jobs por dia" },
    { key: "maxWorkerConcurrency", label: "Concorrência máxima" },
  ];

  const state = {
    mounted: false,
    pollTimerId: null,
    eventSource: null,
    isRefreshing: false,
    config: null,
    apiBaseUrl: "",
    accessToken: "",
    auth: null,
    permissions: new Set(),
    workspaces: [],
    selectedLinkedinAccountId: "",
    overview: null,
    activity: null,
    memberships: [],
    linkedinAccounts: [],
    billingPlans: null,
    billingSnapshot: null,
    quotaOverrides: null,
    quotaRejections: [],
    campaigns: [],
    campaignRuns: [],
    workerJobs: [],
    deadLetters: [],
    workerRuns: [],
    failures: null,
    health: null,
    workerPlaneHealth: null,
    metricsPreview: "",
    remoteRuntime: {
      status: "idle",
      runtime: null,
      prompt: null,
      error: "",
      updatedAt: null,
    },
  };

  const refs = {};

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const formatDateTime = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "medium",
    });
  };

  const formatCompactNumber = (value) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return "0";
    return new Intl.NumberFormat("pt-BR").format(numeric);
  };

  const truncate = (value, max = 160) => {
    const text = String(value ?? "");
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  };

  const tryParseJson = (value) => {
    if (!value || typeof value !== "string") return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const prettyJson = (value) => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string") {
      const parsed = tryParseJson(value);
      return parsed ? JSON.stringify(parsed, null, 2) : value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

  const readNumberInput = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : undefined;
  };

  const readUiState = () => {
    try {
      return JSON.parse(window.localStorage.getItem(UI_STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  };

  const saveUiState = () => {
    window.localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        apiBaseUrl: state.apiBaseUrl,
        selectedLinkedinAccountId: state.selectedLinkedinAccountId,
      })
    );
  };

  const readSessionToken = () => window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";

  const saveSessionToken = (value) => {
    if (!value) {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
  };

  const can = (permission) => state.permissions.has(permission);

  const accountScopedQuery = (query = {}) => {
    if (state.selectedLinkedinAccountId) {
      return {
        ...query,
        linkedinAccountId: state.selectedLinkedinAccountId,
      };
    }
    return query;
  };

  const buildUrl = (baseUrl, path, query) => {
    const url = new URL(path, `${baseUrl}/`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });
    return url;
  };

  const request = async (path, options = {}) => {
    const baseUrl = options.baseUrl || state.apiBaseUrl;
    if (!baseUrl) {
      throw new Error("Informe a URL base da API.");
    }

    const url = buildUrl(baseUrl, path, options.query);
    const headers = {};

    if (options.accessToken || state.accessToken) {
      headers.authorization = `Bearer ${options.accessToken || state.accessToken}`;
    }

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(url.toString(), {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const raw = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const payload =
      contentType.includes("application/json") && raw
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return raw;
            }
          })()
        : raw;

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && payload.message
          ? payload.message
          : typeof payload === "string" && payload
            ? payload
            : `HTTP ${response.status}`;
      throw new Error(message);
    }

    return payload;
  };

  const requestText = async (path, options = {}) => {
    const baseUrl = options.baseUrl || state.apiBaseUrl;
    if (!baseUrl) {
      throw new Error("Informe a URL base da API.");
    }

    const url = buildUrl(baseUrl, path, options.query);
    const headers = {};
    if (options.accessToken || state.accessToken) {
      headers.authorization = `Bearer ${options.accessToken || state.accessToken}`;
    }

    const response = await fetch(url.toString(), {
      method: options.method || "GET",
      headers,
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(raw || `HTTP ${response.status}`);
    }

    return raw;
  };

  const requestLocalConfig = async () => {
    const response = await fetch("/api/admin/config");
    if (!response.ok) {
      throw new Error("Falha ao carregar a configuração local do admin.");
    }
    return response.json();
  };

  const injectStyles = () => {
    if (document.getElementById("saas-dashboard-style")) return;

    const style = document.createElement("style");
    style.id = "saas-dashboard-style";
    style.textContent = `
      .saas-shell {
        margin-top: 20px;
      }
      .saas-section-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .saas-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
        margin-top: 18px;
      }
      .saas-grid--single {
        grid-template-columns: 1fr;
      }
      .saas-note {
        margin: 0;
        color: rgba(236, 239, 248, 0.72);
      }
      .saas-status {
        margin-top: 12px;
      }
      .saas-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      .saas-badge {
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        background: rgba(123, 167, 255, 0.18);
        color: #d9e7ff;
        border: 1px solid rgba(123, 167, 255, 0.25);
      }
      .saas-metrics-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      .saas-stat {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.03);
      }
      .saas-stat__label {
        font-size: 12px;
        color: rgba(236, 239, 248, 0.68);
      }
      .saas-stat__value {
        font-size: 22px;
        font-weight: 700;
        margin-top: 6px;
      }
      .saas-table-wrap {
        max-height: 320px;
        overflow: auto;
      }
      .saas-table-wrap table {
        width: 100%;
      }
      .saas-table-wrap td,
      .saas-table-wrap th {
        vertical-align: top;
        font-size: 13px;
      }
      .saas-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .saas-actions button,
      .saas-actions select {
        width: auto;
      }
      .saas-kv {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 14px;
        margin-top: 12px;
      }
      .saas-kv__item {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 8px;
      }
      .saas-kv__key {
        font-size: 12px;
        color: rgba(236, 239, 248, 0.64);
      }
      .saas-kv__value {
        margin-top: 4px;
        font-weight: 600;
        word-break: break-word;
      }
      .saas-activity-list {
        display: grid;
        gap: 10px;
        max-height: 360px;
        overflow: auto;
      }
      .saas-activity-item {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.03);
      }
      .saas-activity-item__top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: baseline;
      }
      .saas-activity-item__title {
        font-weight: 700;
      }
      .saas-activity-item__meta {
        font-size: 12px;
        color: rgba(236, 239, 248, 0.64);
      }
      .saas-code {
        max-height: 280px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .saas-runtime-feed {
        display: grid;
        gap: 8px;
        max-height: 300px;
        overflow: auto;
      }
      .saas-runtime-item {
        border-radius: 12px;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .saas-runtime-item small {
        display: block;
        color: rgba(236, 239, 248, 0.64);
        margin-bottom: 4px;
      }
      .saas-inline-form {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .saas-inline-form--two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .saas-muted {
        color: rgba(236, 239, 248, 0.64);
      }
      @media (max-width: 1100px) {
        .saas-grid,
        .saas-inline-form,
        .saas-inline-form--two,
        .saas-kv,
        .saas-metrics-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  };

  const statCard = (label, value, note) => `
    <div class="saas-stat">
      <div class="saas-stat__label">${escapeHtml(label)}</div>
      <div class="saas-stat__value">${escapeHtml(formatCompactNumber(value))}</div>
      ${note ? `<div class="saas-muted" style="margin-top: 4px; font-size: 12px">${escapeHtml(note)}</div>` : ""}
    </div>
  `;

  const renderTable = (columns, items, emptyMessage) => {
    const headers = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    const rows = items.length
      ? items
          .map(
            (item) =>
              `<tr>${columns
                .map((column) => `<td>${column.render ? column.render(item) : escapeHtml(item[column.key])}</td>`)
                .join("")}</tr>`
          )
          .join("")
      : `<tr><td colspan="${columns.length}" class="muted">${escapeHtml(emptyMessage)}</td></tr>`;

    return `
      <div class="table-wrap saas-table-wrap">
        <table>
          <thead><tr>${headers}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  };

  const setStatus = (element, message, isError = false) => {
    if (!element) return;
    element.textContent = message || "";
    element.style.color = isError ? "#ff9d9d" : "";
  };

  const mount = () => {
    if (state.mounted) return;
    const main = document.querySelector("main.page");
    if (!main) return;

    injectStyles();

    const shell = document.createElement("section");
    shell.id = "saas-control-plane";
    shell.className = "panel saas-shell";
    shell.innerHTML = `
      <article class="card">
        <div class="saas-section-title">
          <div>
            <h2 style="margin: 0">Control Plane SaaS</h2>
            <p class="saas-note">Workspaces, memberships, contas LinkedIn, campanhas, jobs, runs, falhas, métricas e auditoria em uma visão operacional única.</p>
          </div>
          <div class="saas-actions">
            <button id="saas-refresh-all" type="button">Atualizar painel</button>
          </div>
        </div>
        <p id="saas-global-status" class="status saas-status"></p>
      </article>

      <section class="saas-grid">
        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Conexão e Contexto</h2>
              <div class="meta">Use um bearer token de usuário do <code>interactionBot-api</code>.</div>
            </div>
          </div>

          <form id="saas-connect-form" class="stack" style="margin-top: 12px">
            <div>
              <label for="saas-api-base-url">API base URL</label>
              <input id="saas-api-base-url" placeholder="http://127.0.0.1:3301" />
            </div>
            <div>
              <label for="saas-access-token">Bearer token</label>
              <textarea id="saas-access-token" rows="3" placeholder="ibu_..." style="min-height: 92px"></textarea>
            </div>
            <div class="saas-actions">
              <button id="saas-connect-button" type="submit">Conectar</button>
              <button id="saas-disconnect-button" class="secondary" type="button">Desconectar</button>
            </div>
          </form>

          <div id="saas-auth-meta" class="meta" style="margin-top: 12px">Sem sessão SaaS conectada.</div>
          <div id="saas-permissions" class="saas-badges"></div>

          <div class="saas-inline-form saas-inline-form--two" style="margin-top: 16px">
            <div>
              <label for="saas-workspace-select">Workspace atual</label>
              <select id="saas-workspace-select"></select>
            </div>
            <div>
              <label for="saas-linkedin-account-select">Conta LinkedIn</label>
              <select id="saas-linkedin-account-select"></select>
            </div>
          </div>

          <div class="saas-actions" style="margin-top: 10px">
            <button id="saas-switch-workspace" class="secondary" type="button">Trocar workspace</button>
          </div>

          <form id="saas-create-workspace-form" class="stack" style="margin-top: 16px" hidden>
            <div class="saas-inline-form saas-inline-form--two">
              <div>
                <label for="saas-workspace-name">Nova workspace</label>
                <input id="saas-workspace-name" placeholder="Growth Ops" />
              </div>
              <div>
                <label for="saas-workspace-slug">Slug opcional</label>
                <input id="saas-workspace-slug" placeholder="growth-ops" />
              </div>
            </div>
            <button id="saas-create-workspace-button" type="submit">Criar workspace</button>
          </form>
        </article>

        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Resumo Operacional</h2>
              <div id="saas-overview-meta" class="meta">Conecte-se para carregar.</div>
            </div>
          </div>
          <div id="saas-overview" class="saas-metrics-grid" style="margin-top: 12px">
            ${statCard("Workspaces", 0, "Sem sessão")}
          </div>
        </article>
      </section>

      <section class="saas-grid">
        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Memberships</h2>
              <div class="meta">RBAC por workspace.</div>
            </div>
          </div>
          <div id="saas-memberships-meta" class="meta" style="margin-top: 10px">Sem dados.</div>
          <div id="saas-memberships-table" style="margin-top: 12px"></div>
          <form id="saas-membership-form" class="stack" style="margin-top: 14px" hidden>
            <div class="saas-inline-form">
              <div>
                <label for="saas-membership-email">Email</label>
                <input id="saas-membership-email" type="email" placeholder="ops@empresa.com" />
              </div>
              <div>
                <label for="saas-membership-full-name">Nome</label>
                <input id="saas-membership-full-name" placeholder="Pessoa Operadora" />
              </div>
              <div>
                <label for="saas-membership-role">Role</label>
                <select id="saas-membership-role">
                  ${WORKSPACE_ROLES.map((role) => `<option value="${role}">${role}</option>`).join("")}
                </select>
              </div>
              <div style="display: flex; align-items: end">
                <button id="saas-membership-submit" type="submit">Salvar membership</button>
              </div>
            </div>
          </form>
        </article>

        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Contas LinkedIn</h2>
              <div class="meta">Escopo operacional por workspace + account.</div>
            </div>
          </div>
          <div id="saas-accounts-meta" class="meta" style="margin-top: 10px">Sem dados.</div>
          <div id="saas-accounts-table" style="margin-top: 12px"></div>
          <form id="saas-account-form" class="stack" style="margin-top: 14px" hidden>
            <div class="saas-inline-form">
              <div>
                <label for="saas-account-label">Label</label>
                <input id="saas-account-label" placeholder="Conta SDR Brasil" />
              </div>
              <div>
                <label for="saas-account-email">Login email</label>
                <input id="saas-account-email" type="email" placeholder="linkedin@empresa.com" />
              </div>
              <div>
                <label for="saas-account-password">Senha</label>
                <input id="saas-account-password" type="password" placeholder="••••••••" />
              </div>
              <div>
                <label for="saas-account-status">Status</label>
                <select id="saas-account-status">
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                </select>
              </div>
            </div>
            <div class="saas-inline-form saas-inline-form--two">
              <div>
                <label for="saas-account-profile-url">Profile URL</label>
                <input id="saas-account-profile-url" placeholder="https://www.linkedin.com/in/..." />
              </div>
              <label class="check" style="margin-top: 24px">
                <input id="saas-account-default" type="checkbox" /> Definir como padrão
              </label>
            </div>
            <button id="saas-account-submit" type="submit">Criar conta</button>
          </form>
        </article>
      </section>

      <section class="saas-grid">
        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Billing e Quotas</h2>
              <div class="meta">Plano efetivo, overrides, uso e rejeições.</div>
            </div>
          </div>
          <div id="saas-billing-summary" class="saas-kv"></div>
          <div id="saas-billing-warnings" class="meta" style="margin-top: 10px"></div>

          <form id="saas-plan-form" class="stack" style="margin-top: 16px" hidden>
            <div>
              <label for="saas-plan-select">Plano do tenant</label>
              <select id="saas-plan-select"></select>
            </div>
            <button id="saas-plan-submit" type="submit">Atualizar plano</button>
          </form>

          <form id="saas-overrides-form" class="stack" style="margin-top: 16px" hidden>
            <div class="saas-inline-form">
              ${BILLING_LIMIT_FIELDS.map(
                (field) => `
                  <div>
                    <label for="saas-limit-${field.key}">${field.label}</label>
                    <input id="saas-limit-${field.key}" type="number" min="0" placeholder="vazio = sem override" />
                  </div>
                `
              ).join("")}
            </div>
            <button id="saas-overrides-submit" type="submit">Salvar overrides</button>
          </form>

          <div id="saas-quota-rejections" style="margin-top: 14px"></div>
        </article>

        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Health e Métricas</h2>
              <div class="meta">Readiness, worker plane e Prometheus.</div>
            </div>
          </div>
          <div id="saas-health-summary" class="saas-kv"></div>
          <pre id="saas-metrics-preview" class="code-block code-block--compact saas-code" style="margin-top: 12px">Sem métricas.</pre>
        </article>
      </section>

      <section class="saas-grid">
        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Campanhas</h2>
              <div class="meta">Definições, runs e scheduler manual.</div>
            </div>
            <div class="saas-actions">
              <button id="saas-scheduler-tick" class="secondary" type="button">Rodar scheduler tick</button>
            </div>
          </div>
          <div id="saas-campaigns-table" style="margin-top: 12px"></div>
          <div id="saas-campaign-runs-table" style="margin-top: 14px"></div>
        </article>

        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Worker Jobs</h2>
              <div class="meta">Fila, dead-letters e cancelamento.</div>
            </div>
          </div>
          <div id="saas-worker-jobs-table" style="margin-top: 12px"></div>
          <div id="saas-dead-letters-table" style="margin-top: 14px"></div>
        </article>
      </section>

      <section class="saas-grid">
        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Worker Runs</h2>
              <div class="meta">Execuções do bot por runId.</div>
            </div>
          </div>
          <div id="saas-worker-runs-table" style="margin-top: 12px"></div>
        </article>

        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Falhas</h2>
              <div class="meta">Queue + worker runs por tipo.</div>
            </div>
          </div>
          <div id="saas-failures" style="margin-top: 12px"></div>
        </article>
      </section>

      <section class="saas-grid">
        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Auditoria</h2>
              <div class="meta">Feed recente de atividade do control plane.</div>
            </div>
          </div>
          <div id="saas-activity" class="saas-activity-list" style="margin-top: 12px"></div>
        </article>

        <article class="card">
          <div class="toolbar">
            <div>
              <h2 style="margin: 0">Runtime Remoto</h2>
              <div class="meta">SSE do admin runtime persistido na API.</div>
            </div>
          </div>
          <div id="saas-runtime-meta" class="meta" style="margin-top: 10px">Sem stream conectado.</div>
          <div id="saas-runtime-prompt" class="saas-runtime-item" style="margin-top: 12px">Sem prompt pendente.</div>
          <div id="saas-runtime-steps" class="saas-runtime-feed" style="margin-top: 12px"></div>
          <div id="saas-runtime-logs" class="saas-runtime-feed" style="margin-top: 12px"></div>
        </article>
      </section>
    `;

    main.appendChild(shell);

    [
      "global-status",
      "connect-form",
      "api-base-url",
      "access-token",
      "disconnect-button",
      "auth-meta",
      "permissions",
      "workspace-select",
      "linkedin-account-select",
      "switch-workspace",
      "create-workspace-form",
      "workspace-name",
      "workspace-slug",
      "overview",
      "overview-meta",
      "memberships-meta",
      "memberships-table",
      "membership-form",
      "membership-email",
      "membership-full-name",
      "membership-role",
      "accounts-meta",
      "accounts-table",
      "account-form",
      "account-label",
      "account-email",
      "account-password",
      "account-status",
      "account-profile-url",
      "account-default",
      "billing-summary",
      "billing-warnings",
      "plan-form",
      "plan-select",
      "overrides-form",
      "quota-rejections",
      "health-summary",
      "metrics-preview",
      "campaigns-table",
      "campaign-runs-table",
      "scheduler-tick",
      "worker-jobs-table",
      "dead-letters-table",
      "worker-runs-table",
      "failures",
      "activity",
      "runtime-meta",
      "runtime-prompt",
      "runtime-steps",
      "runtime-logs",
      "refresh-all",
    ].forEach((suffix) => {
      refs[suffix] = document.getElementById(`saas-${suffix}`);
    });

    BILLING_LIMIT_FIELDS.forEach((field) => {
      refs[`limit-${field.key}`] = document.getElementById(`saas-limit-${field.key}`);
    });

    refs["connect-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      void connect();
    });

    refs["disconnect-button"].addEventListener("click", () => {
      disconnect();
    });

    refs["refresh-all"].addEventListener("click", () => {
      void refreshAll({ showStatus: true });
    });

    refs["switch-workspace"].addEventListener("click", () => {
      void switchWorkspace();
    });

    refs["create-workspace-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      void createWorkspace();
    });

    refs["membership-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      void upsertMembership();
    });

    refs["accounts-table"].addEventListener("click", (event) => {
      const button = event.target.closest("button[data-account-action]");
      if (!button) return;
      const action = button.dataset.accountAction;
      const accountId = button.dataset.accountId;
      if (!action || !accountId) return;
      void updateAccountAction(action, accountId);
    });

    refs["account-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      void createAccount();
    });

    refs["plan-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      void updatePlan();
    });

    refs["overrides-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      void updateOverrides();
    });

    refs["campaigns-table"].addEventListener("click", (event) => {
      const button = event.target.closest("button[data-campaign-action]");
      if (!button) return;
      void updateCampaignStatus(button.dataset.campaignId, button.dataset.campaignAction);
    });

    refs["scheduler-tick"].addEventListener("click", () => {
      void runSchedulerTick();
    });

    refs["worker-jobs-table"].addEventListener("click", (event) => {
      const button = event.target.closest("button[data-job-id]");
      if (!button) return;
      void cancelWorkerJob(button.dataset.jobId);
    });

    refs["memberships-table"].addEventListener("click", (event) => {
      const button = event.target.closest("button[data-membership-user-id]");
      if (!button) return;
      const userId = button.dataset.membershipUserId;
      const select = refs["memberships-table"].querySelector(`select[data-membership-role="${userId}"]`);
      if (!userId || !select) return;
      void updateMembershipRole(userId, select.value);
    });

    refs["linkedin-account-select"].addEventListener("change", () => {
      state.selectedLinkedinAccountId = refs["linkedin-account-select"].value || "";
      saveUiState();
      renderRuntime();
      void refreshAll({ showStatus: false });
    });

    state.mounted = true;
  };

  const closeRuntimeStream = () => {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
  };

  const connectRuntimeStream = () => {
    closeRuntimeStream();

    if (!state.accessToken || !state.apiBaseUrl || !can("admin.read")) {
      renderRuntime();
      return;
    }

    if (!state.selectedLinkedinAccountId) {
      state.remoteRuntime = {
        status: "idle",
        runtime: null,
        prompt: null,
        error: "Selecione uma conta LinkedIn específica para o stream remoto.",
        updatedAt: null,
      };
      renderRuntime();
      return;
    }

    const url = buildUrl(state.apiBaseUrl, "/admin/runtime/stream", {
      accessToken: state.accessToken,
      linkedinAccountId: state.selectedLinkedinAccountId,
      logsLimit: RUNTIME_LOG_LIMIT,
      stepsLimit: RUNTIME_STEP_LIMIT,
    });

    state.remoteRuntime.status = "connecting";
    state.remoteRuntime.error = "";
    renderRuntime();

    const eventSource = new EventSource(url.toString());
    state.eventSource = eventSource;

    eventSource.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse(event.data);
        state.remoteRuntime = {
          status: "connected",
          runtime: payload.runtime || null,
          prompt: payload.prompt || null,
          error: "",
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        state.remoteRuntime = {
          status: "error",
          runtime: null,
          prompt: null,
          error: error instanceof Error ? error.message : "Falha ao processar o stream remoto.",
          updatedAt: null,
        };
      }
      renderRuntime();
    });

    eventSource.onopen = () => {
      state.remoteRuntime.status = "connected";
      state.remoteRuntime.error = "";
      renderRuntime();
    };

    eventSource.onerror = () => {
      state.remoteRuntime.status = "reconnecting";
      state.remoteRuntime.error = "Tentando reconectar o stream remoto.";
      renderRuntime();
    };
  };

  const startPolling = () => {
    if (state.pollTimerId) {
      window.clearInterval(state.pollTimerId);
    }

    state.pollTimerId = window.setInterval(() => {
      if (!state.accessToken || state.isRefreshing) return;
      void refreshAll({ showStatus: false, reconnectRuntime: false });
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (state.pollTimerId) {
      window.clearInterval(state.pollTimerId);
      state.pollTimerId = null;
    }
  };

  const disconnect = () => {
    state.accessToken = "";
    state.auth = null;
    state.permissions = new Set();
    state.workspaces = [];
    state.selectedLinkedinAccountId = "";
    state.overview = null;
    state.activity = null;
    state.memberships = [];
    state.linkedinAccounts = [];
    state.billingPlans = null;
    state.billingSnapshot = null;
    state.quotaOverrides = null;
    state.quotaRejections = [];
    state.campaigns = [];
    state.campaignRuns = [];
    state.workerJobs = [];
    state.deadLetters = [];
    state.workerRuns = [];
    state.failures = null;
    state.health = null;
    state.workerPlaneHealth = null;
    state.metricsPreview = "";
    state.remoteRuntime = {
      status: "idle",
      runtime: null,
      prompt: null,
      error: "",
      updatedAt: null,
    };

    saveSessionToken("");
    closeRuntimeStream();
    stopPolling();
    renderAll();
    setStatus(refs["global-status"], "Sessão SaaS desconectada.");
  };

  const connect = async () => {
    const apiBaseUrl = normalizeBaseUrl(refs["api-base-url"].value);
    const accessToken = refs["access-token"].value.trim();

    if (!apiBaseUrl || !accessToken) {
      setStatus(refs["global-status"], "Informe a URL da API e um bearer token.", true);
      return;
    }

    state.apiBaseUrl = apiBaseUrl;
    state.accessToken = accessToken;
    saveUiState();
    saveSessionToken(accessToken);

    try {
      await refreshAll({ showStatus: true });
      startPolling();
      connectRuntimeStream();
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao conectar no control plane.", true);
    }
  };

  const loadAuth = async () => {
    state.auth = await request("/auth/me");
    state.permissions = new Set(state.auth.permissions || []);
  };

  const loadWorkspaces = async () => {
    if (!state.auth) return;

    if (!can("workspace.read")) {
      state.workspaces = [
        {
          workspace: state.auth.workspace,
          role: state.auth.role,
        },
      ];
      return;
    }

    const payload = await request("/auth/workspaces");
    state.workspaces = Array.isArray(payload.items) ? payload.items : [];
  };

  const loadLinkedinAccounts = async () => {
    if (!can("workspace.read")) {
      state.linkedinAccounts = [];
      state.selectedLinkedinAccountId = "";
      return;
    }

    const payload = await request("/linkedin-accounts");
    state.linkedinAccounts = Array.isArray(payload.items) ? payload.items : [];

    const selectedStillExists = state.linkedinAccounts.some((item) => item.id === state.selectedLinkedinAccountId);
    if (selectedStillExists) {
      return;
    }

    const preferred =
      state.linkedinAccounts.find((item) => item.isDefault) ||
      state.linkedinAccounts[0] ||
      null;
    state.selectedLinkedinAccountId = preferred ? preferred.id : "";
    saveUiState();
  };

  const refreshAll = async (options = {}) => {
    if (!state.accessToken || !state.apiBaseUrl) {
      renderAll();
      return;
    }

    if (state.isRefreshing) return;
    state.isRefreshing = true;
    if (options.showStatus) {
      setStatus(refs["global-status"], "Atualizando control plane...");
    }

    try {
      await loadAuth();
      await loadWorkspaces();
      await loadLinkedinAccounts();

      const tasks = [
        can("workspace.read")
          ? request("/control-plane/overview", {
              query: accountScopedQuery({ windowHours: 24 }),
            }).then((payload) => {
              state.overview = payload;
            })
          : Promise.resolve(),
        can("workspace.read")
          ? request("/control-plane/activity", {
              query: accountScopedQuery({ windowHours: 24, limit: 30 }),
            }).then((payload) => {
              state.activity = payload;
            })
          : Promise.resolve(),
        can("workspace.members.manage")
          ? request("/auth/workspace/memberships").then((payload) => {
              state.memberships = Array.isArray(payload.items) ? payload.items : [];
            })
          : Promise.resolve(),
        can("workspace.read")
          ? Promise.all([
              request("/billing/plans").then((payload) => {
                state.billingPlans = payload;
              }),
              request("/billing/plan").then((payload) => {
                state.billingSnapshot = payload;
              }),
              request("/billing/workspace-limits").then((payload) => {
                state.quotaOverrides = payload;
              }),
              request("/billing/rejections", {
                query: { limit: 12 },
              }).then((payload) => {
                state.quotaRejections = Array.isArray(payload.items) ? payload.items : [];
              }),
            ])
          : Promise.resolve(),
        can("campaigns.read")
          ? Promise.all([
              request("/campaigns", {
                query: accountScopedQuery(),
              }).then((payload) => {
                state.campaigns = Array.isArray(payload.items) ? payload.items : [];
              }),
              request("/campaigns/runs", {
                query: accountScopedQuery({ limit: 12 }),
              }).then((payload) => {
                state.campaignRuns = Array.isArray(payload.items) ? payload.items : [];
              }),
            ])
          : Promise.resolve(),
        can("worker_queue.read")
          ? Promise.all([
              request("/worker-jobs", {
                query: accountScopedQuery({ limit: 12 }),
              }).then((payload) => {
                state.workerJobs = Array.isArray(payload.items) ? payload.items : [];
              }),
              request("/worker-jobs/dead-letters", {
                query: accountScopedQuery({ limit: 8 }),
              }).then((payload) => {
                state.deadLetters = Array.isArray(payload) ? payload : payload.items || [];
              }),
            ])
          : Promise.resolve(),
        can("worker_runs.read")
          ? request("/worker-runs", {
              query: accountScopedQuery({ limit: 12 }),
            }).then((payload) => {
              state.workerRuns = Array.isArray(payload) ? payload : [];
            })
          : Promise.resolve(),
        can("workspace.read")
          ? request("/observability/failures", {
              query: { windowHours: 24 },
            }).then((payload) => {
              state.failures = payload;
            })
          : Promise.resolve(),
        request("/health").then((payload) => {
          state.health = payload;
        }),
        request("/health/worker-plane").then((payload) => {
          state.workerPlaneHealth = payload;
        }),
        requestText("/metrics").then((payload) => {
          state.metricsPreview = payload
            .split("\n")
            .filter((line) => line.startsWith("interactionbot_api_"))
            .slice(0, 80)
            .join("\n");
        }),
      ];

      const results = await Promise.allSettled(tasks);
      const failed = results.find((item) => item.status === "rejected");
      renderAll();

      if (options.reconnectRuntime !== false) {
        connectRuntimeStream();
      }

      if (failed && failed.status === "rejected") {
        setStatus(refs["global-status"], failed.reason?.message || "Parte do painel falhou ao carregar.", true);
      } else if (options.showStatus) {
        setStatus(refs["global-status"], `Control plane atualizado em ${formatDateTime(new Date().toISOString())}.`);
      }
    } finally {
      state.isRefreshing = false;
    }
  };

  const switchWorkspace = async () => {
    const workspaceId = refs["workspace-select"].value;
    if (!workspaceId || !state.auth || workspaceId === state.auth.workspace.id) {
      setStatus(refs["global-status"], "Selecione outra workspace para trocar o contexto.");
      return;
    }

    try {
      const payload = await request(`/auth/workspaces/${workspaceId}/tokens/user`, {
        method: "POST",
        body: {
          label: "local-admin-control-plane",
          expiresInHours: 24,
        },
      });

      const nextToken = payload?.token?.value;
      if (!nextToken) {
        throw new Error("A API não retornou um token de workspace.");
      }

      state.accessToken = nextToken;
      refs["access-token"].value = nextToken;
      saveSessionToken(nextToken);
      state.selectedLinkedinAccountId = "";
      await refreshAll({ showStatus: true });
      connectRuntimeStream();
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao trocar de workspace.", true);
    }
  };

  const createWorkspace = async () => {
    try {
      const payload = await request("/auth/workspaces", {
        method: "POST",
        body: {
          workspaceName: refs["workspace-name"].value.trim(),
          workspaceSlug: refs["workspace-slug"].value.trim() || undefined,
        },
      });

      const nextToken = payload?.token?.value;
      if (!nextToken) {
        throw new Error("Workspace criada sem token de contexto.");
      }

      state.accessToken = nextToken;
      refs["access-token"].value = nextToken;
      refs["workspace-name"].value = "";
      refs["workspace-slug"].value = "";
      saveSessionToken(nextToken);
      state.selectedLinkedinAccountId = "";
      await refreshAll({ showStatus: true });
      connectRuntimeStream();
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao criar a workspace.", true);
    }
  };

  const upsertMembership = async () => {
    try {
      await request("/auth/workspace/memberships", {
        method: "POST",
        body: {
          email: refs["membership-email"].value.trim(),
          fullName: refs["membership-full-name"].value.trim() || undefined,
          role: refs["membership-role"].value,
        },
      });

      refs["membership-email"].value = "";
      refs["membership-full-name"].value = "";
      await refreshAll({ showStatus: true, reconnectRuntime: false });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao salvar a membership.", true);
    }
  };

  const updateMembershipRole = async (userId, role) => {
    try {
      await request(`/auth/workspace/memberships/${userId}`, {
        method: "PATCH",
        body: { role },
      });
      await refreshAll({ showStatus: true, reconnectRuntime: false });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao atualizar a role.", true);
    }
  };

  const createAccount = async () => {
    try {
      await request("/linkedin-accounts", {
        method: "POST",
        body: {
          label: refs["account-label"].value.trim(),
          loginEmail: refs["account-email"].value.trim() || undefined,
          loginPassword: refs["account-password"].value || undefined,
          profileUrl: refs["account-profile-url"].value.trim() || undefined,
          status: refs["account-status"].value,
          isDefault: refs["account-default"].checked,
        },
      });

      refs["account-form"].reset();
      refs["account-status"].value = "active";
      await refreshAll({ showStatus: true });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao criar a conta LinkedIn.", true);
    }
  };

  const updateAccountAction = async (action, accountId) => {
    const account = state.linkedinAccounts.find((item) => item.id === accountId);
    if (!account) return;

    const body =
      action === "default"
        ? { isDefault: true }
        : action === "pause"
          ? { status: "paused" }
          : action === "activate"
            ? { status: "active" }
            : null;

    if (!body) return;

    try {
      await request(`/linkedin-accounts/${accountId}`, {
        method: "PATCH",
        body,
      });
      await refreshAll({ showStatus: true });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao atualizar a conta LinkedIn.", true);
    }
  };

  const updatePlan = async () => {
    try {
      await request("/billing/plan", {
        method: "PUT",
        body: {
          planId: refs["plan-select"].value,
        },
      });
      await refreshAll({ showStatus: true, reconnectRuntime: false });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao atualizar o plano.", true);
    }
  };

  const updateOverrides = async () => {
    try {
      const body = {};
      BILLING_LIMIT_FIELDS.forEach((field) => {
        const input = refs[`limit-${field.key}`];
        const numeric = readNumberInput(input.value);
        body[field.key] = numeric === undefined ? null : numeric;
      });

      await request("/billing/workspace-limits", {
        method: "PUT",
        body,
      });
      await refreshAll({ showStatus: true, reconnectRuntime: false });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao atualizar overrides.", true);
    }
  };

  const updateCampaignStatus = async (campaignId, action) => {
    const campaign = state.campaigns.find((item) => item.id === campaignId);
    if (!campaign) return;

    try {
      await request(`/campaigns/${campaignId}`, {
        method: "PATCH",
        query: {
          linkedinAccountId: campaign.linkedinAccountId,
        },
        body: {
          status: action === "pause" ? "paused" : "active",
        },
      });
      await refreshAll({ showStatus: true, reconnectRuntime: false });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao atualizar a campanha.", true);
    }
  };

  const runSchedulerTick = async () => {
    try {
      await request("/campaigns/scheduler/tick", {
        method: "POST",
        query: accountScopedQuery({ limit: 10 }),
      });
      await refreshAll({ showStatus: true, reconnectRuntime: false });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao executar o scheduler.", true);
    }
  };

  const cancelWorkerJob = async (jobId) => {
    try {
      await request(`/worker-jobs/${jobId}/cancel`, {
        method: "POST",
        body: {
          reason: "Cancelado manualmente pelo painel SaaS.",
          ...(state.selectedLinkedinAccountId ? { linkedinAccountId: state.selectedLinkedinAccountId } : {}),
        },
      });
      await refreshAll({ showStatus: true, reconnectRuntime: false });
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao cancelar o job.", true);
    }
  };

  const renderConnection = () => {
    refs["api-base-url"].value = state.apiBaseUrl;
    refs["access-token"].value = state.accessToken;

    if (!state.auth) {
      refs["auth-meta"].textContent = "Sem sessão SaaS conectada.";
      refs["permissions"].innerHTML = `<span class="saas-badge">desconectado</span>`;
      refs["workspace-select"].innerHTML = `<option value="">Sem workspace</option>`;
      refs["linkedin-account-select"].innerHTML = `<option value="">Sem conta</option>`;
      refs["create-workspace-form"].hidden = true;
      refs["membership-form"].hidden = true;
      refs["account-form"].hidden = true;
      refs["plan-form"].hidden = true;
      refs["overrides-form"].hidden = true;
      return;
    }

    refs["auth-meta"].textContent = [
      `${state.auth.user ? state.auth.user.fullName : state.auth.label}`,
      `${state.auth.tenant.name}`,
      `${state.auth.workspace.name}`,
      `role=${state.auth.role}`,
      state.auth.expiresAt ? `expira ${formatDateTime(state.auth.expiresAt)}` : "sem expiração",
    ].join(" • ");

    refs["permissions"].innerHTML = (state.auth.permissions || [])
      .map((permission) => `<span class="saas-badge">${escapeHtml(permission)}</span>`)
      .join("");

    const workspaceOptions = state.workspaces.length
      ? state.workspaces
          .map(
            (item) => `
              <option value="${escapeHtml(item.workspace.id)}" ${
                item.workspace.id === state.auth.workspace.id ? "selected" : ""
              }>
                ${escapeHtml(item.workspace.name)} (${escapeHtml(item.role || "member")})
              </option>
            `
          )
          .join("")
      : `<option value="${escapeHtml(state.auth.workspace.id)}">${escapeHtml(state.auth.workspace.name)}</option>`;
    refs["workspace-select"].innerHTML = workspaceOptions;

    const accountOptions = [
      `<option value="">Todas as contas da workspace</option>`,
      ...state.linkedinAccounts.map(
        (item) => `
          <option value="${escapeHtml(item.id)}" ${item.id === state.selectedLinkedinAccountId ? "selected" : ""}>
            ${escapeHtml(item.label)}${item.isDefault ? " • default" : ""}${item.status !== "active" ? ` • ${escapeHtml(item.status)}` : ""}
          </option>
        `
      ),
    ].join("");
    refs["linkedin-account-select"].innerHTML = accountOptions;
    refs["linkedin-account-select"].value = state.selectedLinkedinAccountId || "";

    refs["create-workspace-form"].hidden = !can("workspace.manage");
    refs["membership-form"].hidden = !can("workspace.members.manage");
    refs["account-form"].hidden = !can("workspace.manage");
    refs["plan-form"].hidden = !can("workspace.manage");
    refs["overrides-form"].hidden = !can("workspace.manage");
  };

  const renderOverview = () => {
    const overview = state.overview;
    if (!overview) {
      refs["overview-meta"].textContent = "Conecte-se para carregar o resumo.";
      refs["overview"].innerHTML = statCard("Control plane", 0, "Sem dados");
      return;
    }

    refs["overview-meta"].textContent = `Janela ${overview.windowHours}h • workspace ${state.auth.workspace.name}${
      state.selectedLinkedinAccountId ? " • conta filtrada" : ""
    }`;

    refs["overview"].innerHTML = [
      statCard("Memberships", overview.counts.memberships.total, `${overview.counts.memberships.admins} admins`),
      statCard("Contas LinkedIn", overview.counts.linkedinAccounts.total, `${overview.counts.linkedinAccounts.active} ativas`),
      statCard("Campanhas", overview.counts.campaigns.total, `${overview.counts.campaigns.active} ativas`),
      statCard("Campaign runs", overview.counts.campaignRuns.recentTotal, `${overview.counts.campaignRuns.failed} falhas`),
      statCard("Worker jobs", overview.counts.workerJobs.active + overview.counts.workerJobs.retrying, `${overview.counts.workerJobs.deadLetters24h} dead-letters`),
      statCard("Worker runs", overview.counts.workerRuns.running, `${overview.counts.workerRuns.failed} falhas`),
      statCard("Quota rejections", overview.counts.quotaRejections24h, "últimas 24h"),
      statCard("Admin logs", overview.counts.adminLogs24h, "últimas 24h"),
      statCard("Processos saudáveis", overview.workerPlane.healthyProcesses || 0, `${overview.workerPlane.totalProcesses || 0} visíveis`),
    ].join("");
  };

  const renderMemberships = () => {
    if (!can("workspace.members.manage")) {
      refs["memberships-meta"].textContent = "RBAC: token sem permissão para memberships.";
      refs["memberships-table"].innerHTML = "";
      return;
    }

    refs["memberships-meta"].textContent = `${state.memberships.length} membership(s) na workspace.`;
    refs["memberships-table"].innerHTML = renderTable(
      [
        {
          label: "Usuário",
          render: (item) =>
            `<strong>${escapeHtml(item.user?.fullName || item.user?.email || item.userId)}</strong><br /><span class="saas-muted">${escapeHtml(item.user?.email || "")}</span>`,
        },
        {
          label: "Role",
          render: (item) =>
            can("workspace.members.manage")
              ? `
                  <div class="saas-actions">
                    <select data-membership-role="${escapeHtml(item.userId)}">
                      ${WORKSPACE_ROLES.map(
                        (role) => `<option value="${role}" ${role === item.role ? "selected" : ""}>${role}</option>`
                      ).join("")}
                    </select>
                    <button type="button" data-membership-user-id="${escapeHtml(item.userId)}">Atualizar</button>
                  </div>
                `
              : escapeHtml(item.role),
        },
        {
          label: "Atualizada em",
          render: (item) => escapeHtml(formatDateTime(item.updatedAt)),
        },
      ],
      state.memberships,
      "Nenhuma membership encontrada."
    );
  };

  const renderAccounts = () => {
    if (!can("workspace.read")) {
      refs["accounts-meta"].textContent = "RBAC: token sem permissão para listar contas LinkedIn.";
      refs["accounts-table"].innerHTML = "";
      return;
    }

    refs["accounts-meta"].textContent = `${state.linkedinAccounts.length} conta(s) cadastrada(s).`;
    refs["accounts-table"].innerHTML = renderTable(
      [
        {
          label: "Conta",
          render: (item) =>
            `<strong>${escapeHtml(item.label)}</strong>${item.isDefault ? ' <span class="saas-badge">default</span>' : ""}<br /><span class="saas-muted">${escapeHtml(item.loginEmail || "sem email")}</span>`,
        },
        {
          label: "Status",
          render: (item) => escapeHtml(item.status),
        },
        {
          label: "Sessão",
          render: (item) =>
            `${item.hasPassword ? "senha salva" : "sem senha"}<br /><span class="saas-muted">lastUsed ${escapeHtml(
              formatDateTime(item.lastUsedAt)
            )}</span>`,
        },
        {
          label: "Ações",
          render: (item) => {
            if (!can("workspace.manage")) return "—";
            const actions = [
              !item.isDefault
                ? `<button type="button" data-account-action="default" data-account-id="${escapeHtml(item.id)}">Default</button>`
                : "",
              item.status === "active"
                ? `<button type="button" data-account-action="pause" data-account-id="${escapeHtml(item.id)}">Pausar</button>`
                : `<button type="button" data-account-action="activate" data-account-id="${escapeHtml(item.id)}">Ativar</button>`,
            ]
              .filter(Boolean)
              .join("");
            return `<div class="saas-actions">${actions || "—"}</div>`;
          },
        },
      ],
      state.linkedinAccounts,
      "Nenhuma conta LinkedIn cadastrada."
    );
  };

  const renderBilling = () => {
    if (!can("workspace.read") || !state.billingSnapshot) {
      refs["billing-summary"].innerHTML = `<div class="saas-kv__item"><div class="saas-kv__key">Billing</div><div class="saas-kv__value">Sem dados.</div></div>`;
      refs["billing-warnings"].textContent = "";
      refs["quota-rejections"].innerHTML = "";
      return;
    }

    const usage = state.billingSnapshot.usage || {};
    const limits = state.billingSnapshot.effectiveLimits || {};
    const warnings = state.billingSnapshot.warnings || [];

    refs["billing-summary"].innerHTML = [
      ["Plano", state.billingSnapshot.plan?.id || "default"],
      ["Campanhas ativas", `${usage.activeCampaigns ?? 0} / ${limits.maxActiveCampaigns ?? "—"}`],
      ["Runs hoje", `${usage.campaignRunsToday ?? 0} / ${limits.maxRunsPerDay ?? "—"}`],
      ["Applies hoje", `${usage.applyJobsToday ?? 0} / ${limits.maxApplyJobsPerDay ?? "—"}`],
      ["Worker jobs hoje", `${usage.workerJobsToday ?? 0} / ${limits.maxWorkerJobsPerDay ?? "—"}`],
      ["Contas LinkedIn", `${usage.linkedinAccounts ?? 0} / ${limits.maxLinkedinAccountsPerWorkspace ?? "—"}`],
      ["Workers ativos", `${usage.activeWorkers ?? 0} / ${limits.maxWorkerConcurrency ?? "—"}`],
      ["Intervalo mínimo", `${limits.minIntervalMinutes ?? "—"} min`],
    ]
      .map(
        ([key, value]) => `
          <div class="saas-kv__item">
            <div class="saas-kv__key">${escapeHtml(key)}</div>
            <div class="saas-kv__value">${escapeHtml(value)}</div>
          </div>
        `
      )
      .join("");

    refs["billing-warnings"].textContent = warnings.length ? warnings.join(" • ") : "Sem alertas de quota.";

    if (state.billingPlans?.items) {
      refs["plan-select"].innerHTML = state.billingPlans.items
        .map(
          (item) => `
            <option value="${escapeHtml(item.id)}" ${item.id === state.billingSnapshot.plan?.id ? "selected" : ""}>
              ${escapeHtml(item.id)}
            </option>
          `
        )
        .join("");
    }

    const overrides = state.quotaOverrides?.item || {};
    BILLING_LIMIT_FIELDS.forEach((field) => {
      refs[`limit-${field.key}`].value =
        overrides[field.key] === undefined || overrides[field.key] === null ? "" : String(overrides[field.key]);
    });

    refs["quota-rejections"].innerHTML = renderTable(
      [
        { label: "Quota", render: (item) => escapeHtml(item.quotaKey) },
        { label: "Uso", render: (item) => `${escapeHtml(item.currentUsage)} / ${escapeHtml(item.limitValue)}` },
        { label: "Fonte", render: (item) => escapeHtml(`${item.sourceType}${item.sourceId ? `:${item.sourceId}` : ""}`) },
        { label: "Quando", render: (item) => escapeHtml(formatDateTime(item.createdAt)) },
      ],
      state.quotaRejections,
      "Nenhuma rejeição de quota recente."
    );
  };

  const renderCampaigns = () => {
    if (!can("campaigns.read")) {
      refs["campaigns-table"].innerHTML = "";
      refs["campaign-runs-table"].innerHTML = `<div class="muted">Token sem permissão para campanhas.</div>`;
      refs["scheduler-tick"].disabled = true;
      return;
    }

    refs["scheduler-tick"].disabled = !can("campaigns.manage");

    refs["campaigns-table"].innerHTML = renderTable(
      [
        {
          label: "Campanha",
          render: (item) =>
            `<strong>${escapeHtml(item.name)}</strong><br /><span class="saas-muted">${escapeHtml(item.searchTag)}</span>`,
        },
        { label: "Status", render: (item) => escapeHtml(item.status) },
        { label: "Janela", render: (item) => escapeHtml(`${item.windowStart}-${item.windowEnd} ${item.timezone}`) },
        { label: "Próxima run", render: (item) => escapeHtml(formatDateTime(item.nextRunAt)) },
        {
          label: "Ações",
          render: (item) =>
            can("campaigns.manage")
              ? `<div class="saas-actions"><button type="button" data-campaign-action="${
                  item.status === "active" ? "pause" : "activate"
                }" data-campaign-id="${escapeHtml(item.id)}">${
                  item.status === "active" ? "Pausar" : "Ativar"
                }</button></div>`
              : "—",
        },
      ],
      state.campaigns,
      "Nenhuma campanha para o filtro atual."
    );

    refs["campaign-runs-table"].innerHTML = renderTable(
      [
        { label: "Run", render: (item) => escapeHtml(item.id) },
        { label: "Status", render: (item) => escapeHtml(item.status) },
        { label: "Resultado", render: (item) => escapeHtml(item.summary || item.error || "—") },
        {
          label: "Aplicações",
          render: (item) =>
            escapeHtml(`${item.appliedJobsCount ?? 0}/${item.queuedApplyJobsCount ?? 0} (${item.failedApplyJobsCount ?? 0} falhas)`),
        },
        { label: "Criada em", render: (item) => escapeHtml(formatDateTime(item.createdAt)) },
      ],
      state.campaignRuns,
      "Nenhum campaign run recente."
    );
  };

  const renderWorkerJobs = () => {
    if (!can("worker_queue.read")) {
      refs["worker-jobs-table"].innerHTML = "";
      refs["dead-letters-table"].innerHTML = `<div class="muted">Token sem permissão para worker queue.</div>`;
      return;
    }

    refs["worker-jobs-table"].innerHTML = renderTable(
      [
        {
          label: "Job",
          render: (item) =>
            `<strong>${escapeHtml(item.type)}</strong><br /><span class="saas-muted">${escapeHtml(item.jobKey)}</span>`,
        },
        { label: "Status", render: (item) => escapeHtml(item.status) },
        { label: "Tentativas", render: (item) => escapeHtml(`${item.attemptsMade}/${item.maxAttempts}`) },
        { label: "runId", render: (item) => escapeHtml(item.runId || "—") },
        {
          label: "Ações",
          render: (item) =>
            can("worker_queue.enqueue") && ["queued", "active", "retrying"].includes(item.status)
              ? `<button type="button" data-job-id="${escapeHtml(item.id)}">Cancelar</button>`
              : "—",
        },
      ],
      state.workerJobs,
      "Nenhum worker job recente."
    );

    refs["dead-letters-table"].innerHTML = renderTable(
      [
        { label: "Type", render: (item) => escapeHtml(item.type || item.jobType || "—") },
        { label: "Status final", render: (item) => escapeHtml(item.finalStatus || "—") },
        { label: "Motivo", render: (item) => escapeHtml(truncate(item.reason || item.error || "—", 90)) },
        { label: "Quando", render: (item) => escapeHtml(formatDateTime(item.createdAt)) },
      ],
      state.deadLetters,
      "Nenhum dead-letter recente."
    );
  };

  const renderWorkerRuns = () => {
    if (!can("worker_runs.read")) {
      refs["worker-runs-table"].innerHTML = `<div class="muted">Token sem permissão para worker runs.</div>`;
      return;
    }

    refs["worker-runs-table"].innerHTML = renderTable(
      [
        { label: "runId", render: (item) => escapeHtml(item.runId) },
        { label: "Tipo", render: (item) => escapeHtml(item.type) },
        { label: "Status", render: (item) => escapeHtml(item.status) },
        { label: "Resumo", render: (item) => escapeHtml(truncate(item.summary || item.error || "—", 100)) },
        { label: "Último evento", render: (item) => escapeHtml(formatDateTime(item.lastEventAt || item.finishedAt || item.startedAt)) },
      ],
      state.workerRuns,
      "Nenhum worker run recente."
    );
  };

  const renderFailures = () => {
    if (!state.failures) {
      refs["failures"].innerHTML = `<div class="muted">Sem dados de falhas.</div>`;
      return;
    }

    const queueTable = renderTable(
      [
        { label: "Job type", render: (item) => escapeHtml(item.type) },
        { label: "Failed", render: (item) => escapeHtml(item.failedCount) },
        { label: "Retrying", render: (item) => escapeHtml(item.retryingCount) },
        { label: "Última falha", render: (item) => escapeHtml(formatDateTime(item.lastFailedAt || item.lastRetriedAt)) },
      ],
      state.failures.queue?.byType || [],
      "Nenhuma falha de queue."
    );

    const runTable = renderTable(
      [
        { label: "Run type", render: (item) => escapeHtml(item.type) },
        { label: "Failed", render: (item) => escapeHtml(item.failedCount) },
        { label: "Running", render: (item) => escapeHtml(item.runningCount) },
        { label: "Última falha", render: (item) => escapeHtml(formatDateTime(item.lastFailedAt)) },
      ],
      state.failures.runs?.byType || [],
      "Nenhuma falha de worker run."
    );

    refs["failures"].innerHTML = `<div class="stack">${queueTable}${runTable}</div>`;
  };

  const renderActivity = () => {
    if (!state.activity?.items?.length) {
      refs["activity"].innerHTML = `<div class="muted">Nenhuma atividade recente.</div>`;
      return;
    }

    refs["activity"].innerHTML = state.activity.items
      .map(
        (item) => `
          <article class="saas-activity-item">
            <div class="saas-activity-item__top">
              <div class="saas-activity-item__title">${escapeHtml(item.title)}</div>
              <div class="saas-activity-item__meta">${escapeHtml(formatDateTime(item.createdAt))}</div>
            </div>
            <div class="saas-activity-item__meta" style="margin-top: 6px">
              ${escapeHtml(item.kind)}${item.status ? ` • ${escapeHtml(item.status)}` : ""}${item.reference ? ` • ${escapeHtml(item.reference)}` : ""}
            </div>
            ${
              item.detail
                ? `<div style="margin-top: 8px">${escapeHtml(truncate(prettyJson(item.detail), 220))}</div>`
                : ""
            }
          </article>
        `
      )
      .join("");
  };

  const renderHealth = () => {
    const healthBlocks = [];
    if (state.health) {
      healthBlocks.push(["API", state.health.ready?.status || "unknown"]);
      healthBlocks.push(["Database", state.health.ready?.checks?.database?.status || "unknown"]);
      healthBlocks.push(["Redis", state.health.ready?.checks?.redis?.status || "unknown"]);
    }
    if (state.workerPlaneHealth) {
      healthBlocks.push(["Worker plane", state.workerPlaneHealth.status || "unknown"]);
      healthBlocks.push(["Processos", `${state.workerPlaneHealth.healthyProcesses || 0}/${state.workerPlaneHealth.totalProcesses || 0}`]);
      healthBlocks.push(["Dead letters 24h", state.workerPlaneHealth.deadLetters24h || 0]);
    }

    refs["health-summary"].innerHTML = healthBlocks.length
      ? healthBlocks
          .map(
            ([key, value]) => `
              <div class="saas-kv__item">
                <div class="saas-kv__key">${escapeHtml(key)}</div>
                <div class="saas-kv__value">${escapeHtml(value)}</div>
              </div>
            `
          )
          .join("")
      : `<div class="saas-kv__item"><div class="saas-kv__key">Health</div><div class="saas-kv__value">Sem dados.</div></div>`;

    refs["metrics-preview"].textContent = state.metricsPreview || "Sem métricas carregadas.";
  };

  const renderRuntime = () => {
    const runtime = state.remoteRuntime.runtime || {};
    const prompt = state.remoteRuntime.prompt || {};
    const logs = Array.isArray(runtime.logs) ? runtime.logs : [];
    const steps = Array.isArray(runtime.steps) ? runtime.steps : [];
    const activeStep = runtime.activeStep || null;
    const promptItem = prompt.item || null;

    refs["runtime-meta"].textContent = [
      `status=${state.remoteRuntime.status}`,
      state.remoteRuntime.updatedAt ? `snapshot ${formatDateTime(state.remoteRuntime.updatedAt)}` : "",
      state.remoteRuntime.error || "",
    ]
      .filter(Boolean)
      .join(" • ");

    refs["runtime-prompt"].innerHTML = promptItem
      ? `
          <small>Prompt pendente</small>
          <strong>${escapeHtml(promptItem.fieldLabel || promptItem.fieldName || promptItem.id)}</strong>
          <div style="margin-top: 6px">${escapeHtml(promptItem.message || "Sem mensagem.")}</div>
          ${promptItem.suggestedValue ? `<div class="saas-muted" style="margin-top: 6px">Sugestão: ${escapeHtml(promptItem.suggestedValue)}</div>` : ""}
        `
      : `Sem prompt pendente.`;

    refs["runtime-steps"].innerHTML = [
      activeStep
        ? `
            <div class="saas-runtime-item">
              <small>Etapa ativa</small>
              <strong>${escapeHtml(activeStep.label || activeStep.id || "step")}</strong>
              <div style="margin-top: 4px">${escapeHtml(activeStep.status || "running")}</div>
            </div>
          `
        : "",
      ...steps.slice(0, 8).map(
        (item) => `
          <div class="saas-runtime-item">
            <small>${escapeHtml(formatDateTime(item.createdAt || item.updatedAt))}</small>
            <strong>${escapeHtml(item.label || item.id || "step")}</strong>
            <div style="margin-top: 4px">${escapeHtml(item.status || "unknown")}</div>
          </div>
        `
      ),
    ]
      .filter(Boolean)
      .join("");

    refs["runtime-logs"].innerHTML = logs.length
      ? logs.slice(0, 12).map(
          (item) => `
            <div class="saas-runtime-item">
              <small>${escapeHtml(formatDateTime(item.createdAt))} • ${escapeHtml(item.level || "info")} • ${escapeHtml(
                item.scope || "runtime"
              )}</small>
              <strong>${escapeHtml(item.message || "log")}</strong>
              ${
                item.data
                  ? `<div style="margin-top: 6px" class="saas-muted">${escapeHtml(truncate(prettyJson(item.data), 220))}</div>`
                  : ""
              }
            </div>
          `
        ).join("")
      : `<div class="muted">Nenhum log remoto disponível.</div>`;
  };

  const renderAll = () => {
    if (!state.mounted) return;
    renderConnection();
    renderOverview();
    renderMemberships();
    renderAccounts();
    renderBilling();
    renderCampaigns();
    renderWorkerJobs();
    renderWorkerRuns();
    renderFailures();
    renderActivity();
    renderHealth();
    renderRuntime();
  };

  const bootstrap = async () => {
    mount();
    if (!state.mounted) return;

    const uiState = readUiState();
    state.apiBaseUrl = normalizeBaseUrl(uiState.apiBaseUrl);
    state.selectedLinkedinAccountId = uiState.selectedLinkedinAccountId || "";
    state.accessToken = readSessionToken();

    try {
      state.config = await requestLocalConfig();
      if (!state.apiBaseUrl && state.config?.apiBaseUrl) {
        state.apiBaseUrl = normalizeBaseUrl(state.config.apiBaseUrl);
        saveUiState();
      }
    } catch (error) {
      setStatus(refs["global-status"], error.message || "Falha ao carregar a configuração local.", true);
    }

    renderAll();

    if (state.accessToken && state.apiBaseUrl) {
      refs["access-token"].value = state.accessToken;
      refs["api-base-url"].value = state.apiBaseUrl;
      try {
        await refreshAll({ showStatus: true });
        startPolling();
        connectRuntimeStream();
      } catch (error) {
        setStatus(refs["global-status"], error.message || "Falha ao restaurar a sessão SaaS.", true);
      }
    }
  };

  void bootstrap();
})();
