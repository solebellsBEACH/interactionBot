import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

import { listGptInteractions } from "../api/controllers/gpt-interactions";
import {
  hydrateUserProfile,
  readUserProfile,
  sanitizeCompensationValue,
  saveUserProfile,
  saveUserProfileAsync,
} from "../interactor/shared/user-profile";
import { env } from "../interactor/shared/env";
import { logger } from "../interactor/shared/services/logger";
import { getBotTenantId, getBotWorkspaceId, hasBotControlPlaneContext } from "../interactor/shared/utils/user-data-dir";
import { adminRuntimeStore } from "./admin-runtime-store";
import { AdminPromptAction, AdminPromptBroker, AdminPromptError } from "./prompt-broker";
import {
  AdminProcessManager,
  ProcessBusyError,
  ProcessValidationError,
} from "./process-manager";

export type AdminServerOptions = {
  host: string;
  port: number;
  processManager: AdminProcessManager;
  promptBroker?: AdminPromptBroker;
};

const MAX_PORT_FALLBACK_ATTEMPTS = 20;

export class AdminServer {
  private readonly _host: string;
  private readonly _requestedPort: number;
  private readonly _processManager: AdminProcessManager;
  private readonly _promptBroker?: AdminPromptBroker;
  private readonly _adminPagePath: string;
  private readonly _adminAssetsPath: string;
  private _activePort?: number;
  private _server?: Server;

  constructor(options: AdminServerOptions) {
    this._host = options.host;
    this._requestedPort = options.port;
    this._processManager = options.processManager;
    this._promptBroker = options.promptBroker;
    this._adminPagePath = path.resolve(process.cwd(), "src", "admin", "web", "index.html");
    this._adminAssetsPath = path.resolve(process.cwd(), "src", "admin", "web");
  }

  private _resolvePagePath(name: string) {
    return path.resolve(this._adminAssetsPath, `${name}.html`);
  }

  async start(): Promise<void> {
    if (this._server) return;

    const server = createServer((req, res) => {
      void this._handleRequest(req, res);
    });

    this._server = server;

    try {
      this._activePort = await this._listenWithFallback(server, this._requestedPort);
    } catch (error) {
      this._server = undefined;
      throw error;
    }

    if (this._requestedPort !== 0 && this._activePort !== this._requestedPort) {
      logger.warn(
        `Porta admin ${this._requestedPort} ocupada; usando ${this._activePort}. Defina ADMIN_PORT para fixar outra porta.`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this._server) return;

    const server = this._server;
    this._server = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  get address() {
    return `http://${this._host}:${this.port}/admin`;
  }

  get port() {
    return this._activePort ?? this._requestedPort;
  }

  private async _listenWithFallback(server: Server, startingPort: number): Promise<number> {
    let attempt = 0;
    let port = startingPort;

    while (port <= 65535 && attempt <= MAX_PORT_FALLBACK_ATTEMPTS) {
      try {
        await this._listen(server, port);
        return this._resolveActivePort(server, port);
      } catch (error) {
        if (!this._isAddressInUseError(error) || startingPort === 0) {
          throw error;
        }

        attempt += 1;
        port += 1;
      }
    }

    throw new Error(
      `Nao foi possivel encontrar uma porta livre para o painel admin a partir de ${startingPort}. Defina ADMIN_PORT para outra porta.`,
    );
  }

  private _listen(server: Server, port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };

      const onListening = () => {
        server.off("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, this._host);
    });
  }

  private _resolveActivePort(server: Server, fallbackPort: number) {
    const address = server.address();
    if (!address || typeof address === "string") {
      return fallbackPort;
    }

    return address.port;
  }

  private _isAddressInUseError(error: unknown) {
    return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
  }

  private async _handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method || "GET";
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = requestUrl.pathname;

      if (method === "GET" && pathname === "/") {
        this._redirect(res, "/admin");
        return;
      }

      if (method === "GET" && (pathname === "/admin" || pathname === "/admin/")) {
        this._serveAdminPage(res);
        return;
      }

      // Sub-pages
      const subPages: Record<string, string> = {
        "/admin/dashboard": "dashboard",
        "/admin/dashboard/": "dashboard",
        "/admin/jobs": "jobs",
        "/admin/jobs/": "jobs",
        "/admin/profile": "profile",
        "/admin/profile/": "profile",
        "/admin/gpt": "gpt",
        "/admin/gpt/": "gpt",
        "/admin/settings": "settings",
        "/admin/settings/": "settings",
      };

      if (method === "GET" && subPages[pathname]) {
        this._servePageByName(res, subPages[pathname]);
        return;
      }

      // Static assets
      if (method === "GET" && pathname === "/admin/saas-dashboard.js") {
        this._serveAdminAsset(res, "saas-dashboard.js", "application/javascript; charset=utf-8");
        return;
      }

      if (method === "GET" && pathname === "/admin/nav.js") {
        this._serveAdminAsset(res, "nav.js", "application/javascript; charset=utf-8");
        return;
      }

      if (method === "GET" && pathname === "/admin/shared.css") {
        this._serveAdminAsset(res, "shared.css", "text/css; charset=utf-8");
        return;
      }

      if (method === "GET" && pathname === "/api/admin/processes") {
        this._sendJson(res, 200, this._processManager.getState());
        return;
      }

      if (method === "GET" && pathname === "/api/admin/stream") {
        await this._serveAdminStream(res);
        return;
      }

      if (method === "GET" && pathname === "/api/admin/config") {
        this._sendJson(res, 200, {
          apiBaseUrl: env.api.baseUrl,
          tenantId: getBotTenantId() || null,
          workspaceId: getBotWorkspaceId() || null,
          remoteAdminState: hasBotControlPlaneContext(),
        });
        return;
      }

      if (method === "GET" && pathname === "/api/admin/gpt-responses") {
        const limit = this._parseLimit(requestUrl.searchParams.get("limit"));
        const items = await listGptInteractions(limit);
        this._sendJson(res, 200, { items });
        return;
      }

      if (method === "GET" && pathname === "/api/admin/runtime") {
        this._sendJson(
          res,
          200,
          await adminRuntimeStore.getSnapshot({
            logsLimit: this._parseLimit(requestUrl.searchParams.get("logsLimit")),
            stepsLimit: this._parseLimit(requestUrl.searchParams.get("stepsLimit")),
          })
        );
        return;
      }

      if (method === "POST" && pathname === "/api/admin/runtime/clear") {
        await adminRuntimeStore.clear();
        this._sendJson(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && pathname === "/api/admin/profile") {
        await hydrateUserProfile();
        this._sendJson(res, 200, { profile: readUserProfile() });
        return;
      }

      if (method === "POST" && pathname === "/api/admin/profile") {
        await hydrateUserProfile();
        const body = await this._readJsonBody(req);
        const current = readUserProfile();
        const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
        const birthDate =
          hasOwn("birthDate") && typeof body.birthDate === "string"
            ? body.birthDate.trim()
            : current.birthDate;
        const compensation = {
          ...current.compensation,
          ...(hasOwn("hourlyUsd")
            ? { hourlyUsd: sanitizeCompensationValue(body.hourlyUsd) }
            : {}),
          ...(hasOwn("hourlyBrl")
            ? { hourlyBrl: sanitizeCompensationValue(body.hourlyBrl) }
            : {}),
          ...(hasOwn("clt") ? { clt: sanitizeCompensationValue(body.clt) } : {}),
          ...(hasOwn("pj") ? { pj: sanitizeCompensationValue(body.pj) } : {}),
        };

        const answers = { ...current.answers };
        [
          "data-de-nascimento",
          "data-nascimento",
          "date-of-birth",
          "birth-date",
          "birthdate",
          "dob",
          "valor-hora-dolar",
          "valor-hora-usd",
          "hourly-rate-usd",
          "hourly-rate-dollar",
          "valor-hora-reais",
          "valor-hora-brl",
          "hourly-rate-reais",
          "hourly-rate-brl",
          "pretensao-clt",
          "pretensao-salarial-clt",
          "salary-expectation-clt",
          "pretensao-pj",
          "pretensao-salarial-pj",
          "salary-expectation-pj",
        ].forEach((key) => {
          delete answers[key];
        });

        if (birthDate) {
          answers["data-de-nascimento"] = birthDate;
          answers["data-nascimento"] = birthDate;
          answers["date-of-birth"] = birthDate;
          answers["birth-date"] = birthDate;
          answers["birthdate"] = birthDate;
          answers["dob"] = birthDate;
        }

        if (compensation.hourlyUsd) {
          answers["valor-hora-dolar"] = compensation.hourlyUsd;
          answers["valor-hora-usd"] = compensation.hourlyUsd;
          answers["hourly-rate-usd"] = compensation.hourlyUsd;
          answers["hourly-rate-dollar"] = compensation.hourlyUsd;
        }

        if (compensation.hourlyBrl) {
          answers["valor-hora-reais"] = compensation.hourlyBrl;
          answers["valor-hora-brl"] = compensation.hourlyBrl;
          answers["hourly-rate-reais"] = compensation.hourlyBrl;
          answers["hourly-rate-brl"] = compensation.hourlyBrl;
        }

        if (compensation.clt) {
          answers["pretensao-clt"] = compensation.clt;
          answers["pretensao-salarial-clt"] = compensation.clt;
          answers["salary-expectation-clt"] = compensation.clt;
        }

        if (compensation.pj) {
          answers["pretensao-pj"] = compensation.pj;
          answers["pretensao-salarial-pj"] = compensation.pj;
          answers["salary-expectation-pj"] = compensation.pj;
        }

        const liEdit =
          hasOwn("linkedinProfileEdit") &&
          body.linkedinProfileEdit &&
          typeof body.linkedinProfileEdit === "object" &&
          !Array.isArray(body.linkedinProfileEdit)
            ? (body.linkedinProfileEdit as Record<string, unknown>)
            : null;

        const readStr = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);

        const linkedinProfile =
          liEdit && current.linkedinProfile
            ? {
                ...current.linkedinProfile,
                ...(readStr(liEdit.name) !== undefined ? { name: readStr(liEdit.name)! } : {}),
                ...(readStr(liEdit.headline) !== undefined ? { headline: readStr(liEdit.headline)! } : {}),
                ...(readStr(liEdit.location) !== undefined ? { location: readStr(liEdit.location)! } : {}),
                ...(readStr(liEdit.website) !== undefined ? { website: readStr(liEdit.website)! } : {}),
                ...(readStr(liEdit.about) !== undefined ? { about: readStr(liEdit.about)! } : {}),
                ...(readStr(liEdit.connections) !== undefined ? { connections: readStr(liEdit.connections)! } : {}),
                ...(readStr(liEdit.currentCompany) !== undefined ? { currentCompany: readStr(liEdit.currentCompany)! } : {}),
                ...(readStr(liEdit.topEducation) !== undefined ? { topEducation: readStr(liEdit.topEducation)! } : {}),
              }
            : undefined;

        const profile = await saveUserProfileAsync({
          birthDate,
          compensation,
          answers,
          ...(linkedinProfile !== undefined ? { linkedinProfile } : {}),
        });

        this._sendJson(res, 200, { profile });
        return;
      }

      if (method === "GET" && pathname === "/api/admin/prompts/current") {
        const promptBroker = this._promptBroker;
        const settings = promptBroker
          ? await promptBroker.getSettings()
          : {
              autoConfirmGpt: false,
              autoConfirmDelayMs: 1000,
            };

        this._sendJson(res, 200, {
          item: promptBroker ? await promptBroker.getPendingPrompt() : null,
          settings,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/admin/prompts/settings") {
        const body = await this._readJsonBody(req);
        const promptBroker = this._promptBroker;
        if (!promptBroker) {
          throw new ProcessValidationError("Prompt interativo do admin não está habilitado.");
        }

        const settings = await promptBroker.updateSettings({
          autoConfirmGpt: this._readBool(body.autoConfirmGpt),
          autoConfirmDelayMs: this._readNumber(body.autoConfirmDelayMs),
        });

        this._sendJson(res, 200, { settings });
        return;
      }

      if (method === "POST" && pathname === "/api/admin/prompts/respond") {
        const body = await this._readJsonBody(req);
        const promptBroker = this._promptBroker;
        if (!promptBroker) {
          throw new ProcessValidationError("Prompt interativo do admin não está habilitado.");
        }

        const id = this._readString(body.id);
        if (!id) {
          throw new ProcessValidationError("Informe o id do prompt.");
        }

        const action = this._readPromptAction(body.action);
        if (!action) {
          throw new ProcessValidationError("A ação do prompt é inválida.");
        }

        const item = await promptBroker.answerPrompt(id, {
          action,
          value: this._readString(body.value) || null,
        });

        this._sendJson(res, 200, { ok: true, item });
        return;
      }

      if (method === "POST" && pathname === "/api/admin/processes/easy-apply") {
        const body = await this._readJsonBody(req);
        const processRecord = this._processManager.startEasyApply({
          jobUrl: this._readString(body.jobUrl),
        });
        this._sendJson(res, 202, processRecord);
        return;
      }

      if (method === "POST" && pathname === "/api/admin/processes/search-jobs") {
        const body = await this._readJsonBody(req);
        const processRecord = this._processManager.startSearchJobs({
          tag: this._readString(body.tag) || "",
          apply: this._readBool(body.apply),
          maxApplies: this._readNumber(body.maxApplies),
          waitBetweenMs: this._readNumber(body.waitBetweenMs),
          options: {
            maxResults: this._readNumber(body.maxResults),
            location: this._readString(body.location),
            geoId: this._readString(body.geoId),
            maxPages: this._readNumber(body.maxPages),
            easyApplyOnly: this._readBool(body.easyApplyOnly),
            onlyNonPromoted: this._readBool(body.onlyNonPromoted),
            maxApplicants: this._readNumber(body.maxApplicants),
            includeDetails: this._readBool(body.includeDetails),
          },
        });
        this._sendJson(res, 202, processRecord);
        return;
      }

      if (method === "POST" && pathname === "/api/admin/processes/apply-jobs") {
        const body = await this._readJsonBody(req);
        const processRecord = this._processManager.startApplyJobs({
          jobUrls: this._readStringArray(body.jobUrls),
          waitBetweenMs: this._readNumber(body.waitBetweenMs),
        });
        this._sendJson(res, 202, processRecord);
        return;
      }

      if (method === "POST" && pathname === "/api/admin/processes/connect") {
        const body = await this._readJsonBody(req);
        const processRecord = this._processManager.startConnect({
          profileUrl: this._readString(body.profileUrl) || "",
          message: this._readString(body.message),
        });
        this._sendJson(res, 202, processRecord);
        return;
      }

      if (method === "POST" && pathname === "/api/admin/processes/upvote-posts") {
        const body = await this._readJsonBody(req);
        const processRecord = this._processManager.startUpvote({
          tag: this._readString(body.tag) || "",
          maxLikes: this._readNumber(body.maxLikes),
        });
        this._sendJson(res, 202, processRecord);
        return;
      }

      if (method === "POST" && pathname === "/api/admin/processes/scan-applied-jobs") {
        const body = await this._readJsonBody(req);
        const processRecord = this._processManager.startScanAppliedJobs({
          periodPreset: this._readString(body.periodPreset) as
            | "week"
            | "month"
            | "quarter"
            | "custom"
            | undefined,
          customDays: this._readNumber(body.customDays),
        });
        this._sendJson(res, 202, processRecord);
        return;
      }

      if (method === "POST" && pathname === "/api/admin/processes/profile-review") {
        const processRecord = this._processManager.startProfileReview();
        this._sendJson(res, 202, processRecord);
        return;
      }

      if (method === "POST" && pathname === "/api/admin/processes/reset-session") {
        const processRecord = this._processManager.startResetSession();
        this._sendJson(res, 202, processRecord);
        return;
      }

      this._sendJson(res, 404, { error: "Rota não encontrada." });
    } catch (error) {
      this._handleError(res, error);
    }
  }

  private _parseLimit(raw: string | null) {
    if (!raw) return 50;
    const parsed = Number(raw);
    if (Number.isNaN(parsed) || parsed <= 0) return 50;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private _readString(value: unknown) {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private _readNumber(value: unknown) {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return undefined;
    return parsed;
  }

  private _readBool(value: unknown) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return undefined;
  }

  private _readStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this._readString(item))
      .filter((item): item is string => Boolean(item));
  }

  private _readPromptAction(value: unknown): AdminPromptAction | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "confirm" ||
      normalized === "manual" ||
      normalized === "skip" ||
      normalized === "cancel" ||
      normalized === "timeout"
    ) {
      return normalized;
    }
    return undefined;
  }

  private _serveAdminPage(res: ServerResponse) {
    try {
      const html = fs.readFileSync(this._adminPagePath, "utf-8");
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    } catch {
      this._sendJson(res, 500, { error: "Não foi possível carregar o frontend admin." });
    }
  }

  private _servePageByName(res: ServerResponse, name: string) {
    try {
      const pagePath = this._resolvePagePath(name);
      const html = fs.readFileSync(pagePath, "utf-8");
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    } catch {
      this._sendJson(res, 404, { error: `Página '${name}' não encontrada.` });
    }
  }

  private _serveAdminAsset(res: ServerResponse, filename: string, contentType: string) {
    try {
      const assetPath = path.resolve(this._adminAssetsPath, filename);
      const contents = fs.readFileSync(assetPath, "utf-8");
      res.statusCode = 200;
      res.setHeader("content-type", contentType);
      res.end(contents);
    } catch {
      this._sendJson(res, 404, { error: "Asset admin não encontrado." });
    }
  }

  private _redirect(res: ServerResponse, location: string) {
    res.statusCode = 302;
    res.setHeader("location", location);
    res.end();
  }

  private async _serveAdminStream(res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");

    let closed = false;
    let lastPayload = "";
    let running = false;

    const buildPayload = async () => {
      const runtime = await adminRuntimeStore.getSnapshot({
        logsLimit: 200,
        stepsLimit: 24,
      });
      const promptBroker = this._promptBroker;
      const settings = promptBroker
        ? await promptBroker.getSettings()
        : {
            autoConfirmGpt: false,
            autoConfirmDelayMs: 1000,
          };

      return {
        runtime,
        prompt: {
          item: promptBroker ? await promptBroker.getPendingPrompt() : null,
          settings,
        },
      };
    };

    const pushSnapshot = async () => {
      if (closed || running) return;
      running = true;
      try {
        const payload = JSON.stringify(await buildPayload());
        if (payload !== lastPayload) {
          res.write(`event: snapshot\ndata: ${payload}\n\n`);
          lastPayload = payload;
        } else {
          res.write(": keep-alive\n\n");
        }
      } catch {
        res.write(": keep-alive\n\n");
      } finally {
        running = false;
      }
    };

    const intervalId = setInterval(() => {
      void pushSnapshot();
    }, 1000);

    res.on("close", () => {
      closed = true;
      clearInterval(intervalId);
    });

    await pushSnapshot();
  }

  private async _readJsonBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxSize = 1024 * 1024;

    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > maxSize) {
        throw new Error("Payload muito grande.");
      }
      chunks.push(part);
    }

    if (chunks.length === 0) return {} as Record<string, unknown>;

    const raw = Buffer.concat(chunks).toString("utf-8");
    if (!raw.trim()) return {} as Record<string, unknown>;

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ProcessValidationError("JSON inválido no corpo da requisição.");
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ProcessValidationError("O corpo JSON deve ser um objeto.");
    }

    return data as Record<string, unknown>;
  }

  private _handleError(res: ServerResponse, error: unknown) {
    if (error instanceof ProcessBusyError) {
      this._sendJson(res, 409, {
        error: error.message,
        running: error.running,
      });
      return;
    }

    if (error instanceof ProcessValidationError) {
      this._sendJson(res, 400, { error: error.message });
      return;
    }

    if (error instanceof AdminPromptError) {
      this._sendJson(res, 409, { error: error.message });
      return;
    }

    if (error instanceof Error) {
      this._sendJson(res, 500, { error: error.message || "Erro interno." });
      return;
    }

    this._sendJson(res, 500, { error: "Erro interno." });
  }

  private _sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }
}
