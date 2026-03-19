import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import path from "path";
import fs from "fs";

import { listGptInteractions } from "../api/controllers/gpt-interactions";
import {
  hydrateUserProfile,
  readUserProfile,
  sanitizeCompensationValue,
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

export type FastifyServerOptions = {
  host: string;
  port: number;
  processManager: AdminProcessManager;
  promptBroker?: AdminPromptBroker;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function readStr(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readStr(item))
    .filter((item): item is string => Boolean(item));
}

function readPromptAction(value: unknown): AdminPromptAction | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "confirm" || v === "manual" || v === "skip" || v === "cancel" || v === "timeout") {
    return v as AdminPromptAction;
  }
  return undefined;
}

function parseLimit(raw: string | null | undefined): number {
  if (!raw) return 50;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) return 50;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

// ── Server factory ────────────────────────────────────────────────────────────

export async function createFastifyServer(options: FastifyServerOptions): Promise<{
  start: () => Promise<string>;
  stop: () => Promise<void>;
  address: string;
}> {
  const vanillaAssetsPath = path.resolve(process.cwd(), "src", "admin", "web");
  const reactBuildPath = path.resolve(process.cwd(), "packages", "web", "dist");
  const useReactBuild = fs.existsSync(reactBuildPath);

  const adminAssetsPath = useReactBuild ? reactBuildPath : vanillaAssetsPath;

  const app: FastifyInstance = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });

  // Static admin assets (React build or vanilla HTML files)
  await app.register(fastifyStatic, {
    root: adminAssetsPath,
    prefix: "/admin/",
    decorateReply: true,
    wildcard: false,
  });

  if (useReactBuild) {
    // React SPA: serve index.html for all /admin/* routes (client-side routing)
    const indexHtml = path.join(reactBuildPath, "index.html");
    app.get("/", (_, reply) => { reply.redirect("/admin"); });
    app.get("/admin", (_, reply) => { reply.type("text/html; charset=utf-8").sendFile("index.html"); });
    app.get("/admin/*", (_, reply) => {
      // Only serve index.html for non-asset paths
      const reqPath = (_ as { url: string }).url;
      if (reqPath.match(/\.\w+$/)) return reply.callNotFound();
      reply.type("text/html; charset=utf-8").sendFile("index.html");
    });
  } else {
    // Vanilla HTML pages
    const serveHtml = (name: string) => (_: unknown, reply: { type: (t: string) => void; sendFile: (f: string) => void }) => {
      reply.type("text/html; charset=utf-8");
      reply.sendFile(`${name}.html`);
    };

    app.get("/", (_, reply) => { reply.redirect("/admin"); });
    app.get("/admin", serveHtml("index"));
    app.get("/admin/", serveHtml("index"));
    app.get("/admin/dashboard", serveHtml("dashboard"));
    app.get("/admin/dashboard/", serveHtml("dashboard"));
    app.get("/admin/jobs", serveHtml("jobs"));
    app.get("/admin/jobs/", serveHtml("jobs"));
    app.get("/admin/profile", serveHtml("profile"));
    app.get("/admin/profile/", serveHtml("profile"));
    app.get("/admin/gpt", serveHtml("gpt"));
    app.get("/admin/gpt/", serveHtml("gpt"));
    app.get("/admin/settings", serveHtml("settings"));
    app.get("/admin/settings/", serveHtml("settings"));

    // Vanilla static assets (nav.js, shared.css, saas-dashboard.js served automatically by @fastify/static)
  }

  // ── API: processes ──────────────────────────────────────────────────────────

  app.get("/api/admin/processes", async (_, reply) => {
    reply.send(options.processManager.getState());
  });

  app.get("/api/admin/config", async (_, reply) => {
    reply.send({
      apiBaseUrl: env.api.baseUrl,
      tenantId: getBotTenantId() || null,
      workspaceId: getBotWorkspaceId() || null,
      remoteAdminState: hasBotControlPlaneContext(),
    });
  });

  app.get("/api/admin/gpt-responses", async (req, reply) => {
    const limit = parseLimit((req.query as Record<string, string>).limit);
    const items = await listGptInteractions(limit);
    reply.send({ items });
  });

  app.get("/api/admin/runtime", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const snapshot = await adminRuntimeStore.getSnapshot({
      logsLimit: parseLimit(q.logsLimit),
      stepsLimit: parseLimit(q.stepsLimit),
    });
    reply.send(snapshot);
  });

  app.post("/api/admin/runtime/clear", async (_, reply) => {
    await adminRuntimeStore.clear();
    reply.send({ ok: true });
  });

  // ── API: profile ────────────────────────────────────────────────────────────

  app.get("/api/admin/profile", async (_, reply) => {
    await hydrateUserProfile();
    reply.send({ profile: readUserProfile() });
  });

  app.post("/api/admin/profile", async (req, reply) => {
    await hydrateUserProfile();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const current = readUserProfile();
    const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    const birthDate =
      hasOwn("birthDate") && typeof body.birthDate === "string"
        ? body.birthDate.trim()
        : current.birthDate;

    const compensation = {
      ...current.compensation,
      ...(hasOwn("hourlyUsd") ? { hourlyUsd: sanitizeCompensationValue(body.hourlyUsd) } : {}),
      ...(hasOwn("hourlyBrl") ? { hourlyBrl: sanitizeCompensationValue(body.hourlyBrl) } : {}),
      ...(hasOwn("clt") ? { clt: sanitizeCompensationValue(body.clt) } : {}),
      ...(hasOwn("pj") ? { pj: sanitizeCompensationValue(body.pj) } : {}),
    };

    const answers = { ...current.answers };
    [
      "data-de-nascimento", "data-nascimento", "date-of-birth", "birth-date", "birthdate", "dob",
      "valor-hora-dolar", "valor-hora-usd", "hourly-rate-usd", "hourly-rate-dollar",
      "valor-hora-reais", "valor-hora-brl", "hourly-rate-reais", "hourly-rate-brl",
      "pretensao-clt", "pretensao-salarial-clt", "salary-expectation-clt",
      "pretensao-pj", "pretensao-salarial-pj", "salary-expectation-pj",
    ].forEach((key) => { delete answers[key]; });

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

    reply.send({ profile });
  });

  // ── API: prompts ────────────────────────────────────────────────────────────

  app.get("/api/admin/prompts/current", async (_, reply) => {
    const pb = options.promptBroker;
    const settings = pb
      ? await pb.getSettings()
      : { autoConfirmGpt: false, autoConfirmDelayMs: 1000 };

    reply.send({
      item: pb ? await pb.getPendingPrompt() : null,
      settings,
    });
  });

  app.post("/api/admin/prompts/settings", async (req, reply) => {
    const pb = options.promptBroker;
    if (!pb) throw new ProcessValidationError("Prompt interativo do admin não está habilitado.");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const settings = await pb.updateSettings({
      autoConfirmGpt: readBool(body.autoConfirmGpt),
      autoConfirmDelayMs: readNum(body.autoConfirmDelayMs),
    });
    reply.send({ settings });
  });

  app.post("/api/admin/prompts/respond", async (req, reply) => {
    const pb = options.promptBroker;
    if (!pb) throw new ProcessValidationError("Prompt interativo do admin não está habilitado.");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = readStr(body.id);
    if (!id) throw new ProcessValidationError("Informe o id do prompt.");
    const action = readPromptAction(body.action);
    if (!action) throw new ProcessValidationError("A ação do prompt é inválida.");
    const item = await pb.answerPrompt(id, { action, value: readStr(body.value) ?? null });
    reply.send({ ok: true, item });
  });

  // ── API: process triggers ────────────────────────────────────────────────────

  app.post("/api/admin/processes/easy-apply", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const processRecord = options.processManager.startEasyApply({ jobUrl: readStr(body.jobUrl) });
    reply.code(202).send(processRecord);
  });

  app.post("/api/admin/processes/search-jobs", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const processRecord = options.processManager.startSearchJobs({
      tag: readStr(body.tag) || "",
      apply: readBool(body.apply),
      maxApplies: readNum(body.maxApplies),
      waitBetweenMs: readNum(body.waitBetweenMs),
      options: {
        maxResults: readNum(body.maxResults),
        location: readStr(body.location),
        geoId: readStr(body.geoId),
        maxPages: readNum(body.maxPages),
        easyApplyOnly: readBool(body.easyApplyOnly),
        onlyNonPromoted: readBool(body.onlyNonPromoted),
        maxApplicants: readNum(body.maxApplicants),
        includeDetails: readBool(body.includeDetails),
      },
    });
    reply.code(202).send(processRecord);
  });

  app.post("/api/admin/processes/apply-jobs", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const processRecord = options.processManager.startApplyJobs({
      jobUrls: readStringArray(body.jobUrls),
      waitBetweenMs: readNum(body.waitBetweenMs),
    });
    reply.code(202).send(processRecord);
  });

  app.post("/api/admin/processes/connect", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const processRecord = options.processManager.startConnect({
      profileUrl: readStr(body.profileUrl) || "",
      message: readStr(body.message),
    });
    reply.code(202).send(processRecord);
  });

  app.post("/api/admin/processes/upvote-posts", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const processRecord = options.processManager.startUpvote({
      tag: readStr(body.tag) || "",
      maxLikes: readNum(body.maxLikes),
    });
    reply.code(202).send(processRecord);
  });

  app.post("/api/admin/processes/scan-applied-jobs", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const processRecord = options.processManager.startScanAppliedJobs({
      periodPreset: readStr(body.periodPreset) as
        | "week" | "month" | "quarter" | "custom" | undefined,
      customDays: readNum(body.customDays),
    });
    reply.code(202).send(processRecord);
  });

  app.post("/api/admin/processes/profile-review", async (_, reply) => {
    const processRecord = options.processManager.startProfileReview();
    reply.code(202).send(processRecord);
  });

  app.post("/api/admin/processes/reset-session", async (_, reply) => {
    const processRecord = options.processManager.startResetSession();
    reply.code(202).send(processRecord);
  });

  // ── SSE stream ──────────────────────────────────────────────────────────────

  app.get("/api/admin/stream", async (req, reply) => {
    const res = reply.raw;
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");

    let closed = false;
    let lastPayload = "";
    let running = false;

    const buildPayload = async () => {
      const runtime = await adminRuntimeStore.getSnapshot({ logsLimit: 200, stepsLimit: 24 });
      const pb = options.promptBroker;
      const settings = pb
        ? await pb.getSettings()
        : { autoConfirmGpt: false, autoConfirmDelayMs: 1000 };
      return { runtime, prompt: { item: pb ? await pb.getPendingPrompt() : null, settings } };
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

    const intervalId = setInterval(() => { void pushSnapshot(); }, 1000);
    req.raw.on("close", () => { closed = true; clearInterval(intervalId); });

    await pushSnapshot();
  });

  // ── Error handler ───────────────────────────────────────────────────────────

  app.setErrorHandler((error: Error, _, reply) => {
    if (error instanceof ProcessBusyError) {
      reply.code(409).send({ error: error.message, running: error.running });
      return;
    }
    if (error instanceof ProcessValidationError) {
      reply.code(400).send({ error: error.message });
      return;
    }
    if (error instanceof AdminPromptError) {
      reply.code(409).send({ error: error.message });
      return;
    }
    reply.code(500).send({ error: error.message || "Erro interno." });
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  let activeAddress = "";

  return {
    async start() {
      await app.listen({ host: options.host, port: options.port });
      activeAddress = `http://${options.host}:${options.port}/admin`;
      logger.info(`Fastify admin disponível em ${activeAddress}`);
      return activeAddress;
    },
    async stop() {
      await app.close();
    },
    get address() {
      return activeAddress;
    },
  };
}
