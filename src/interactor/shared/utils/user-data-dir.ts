import fs from "fs/promises";
import os from "os";
import path from "path";

const normalizeSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";

export const getBotUserId = () => {
  const value = (process.env.BOT_USER_ID || "").trim();
  return value || undefined;
};

export const getBotActorUserId = () => {
  const value = (process.env.BOT_USER_ID || "").trim();
  return value || undefined;
};

export const getBotTenantId = () => {
  const value = (process.env.BOT_TENANT_ID || "").trim();
  if (value) return value;
  return getBotActorUserId();
};

export const getBotWorkspaceId = () => {
  const value = (process.env.BOT_WORKSPACE_ID || "").trim();
  return value || undefined;
};

export const getBotLinkedinAccountId = () => {
  const value = (process.env.BOT_LINKEDIN_ACCOUNT_ID || "").trim();
  return value || undefined;
};

export type BotSessionMode = "persistent" | "ephemeral";

export const getBotSessionMode = (): BotSessionMode => {
  const value = (process.env.BOT_SESSION_MODE || "").trim().toLowerCase();
  return value === "ephemeral" ? "ephemeral" : "persistent";
};

export const getBotScopeId = () => {
  return getBotLinkedinAccountId() || getBotWorkspaceId() || getBotTenantId() || getBotActorUserId();
};

export const hasBotControlPlaneAuthToken = () => {
  const value = (process.env.API_AUTH_TOKEN || process.env.BOT_API_TOKEN || "").trim();
  return Boolean(value);
};

export const hasBotControlPlaneContext = () => {
  return Boolean(getBotTenantId() || hasBotControlPlaneAuthToken());
};

export const setBotControlPlaneContext = (context: {
  tenant: { id: string };
  workspace: { id: string };
  user?: { id: string } | null;
}) => {
  process.env.BOT_TENANT_ID = context.tenant.id;
  process.env.BOT_WORKSPACE_ID = context.workspace.id;
  if (context.user?.id) {
    process.env.BOT_USER_ID = context.user.id;
  }
};

export const resolveScopedPath = (basePath: string, scopeId = getBotScopeId()) => {
  if (!scopeId) return basePath;
  return path.resolve(basePath, normalizeSegment(scopeId));
};

export const prepareBrowserUserDataDir = async (
  basePath: string,
  options?: {
    scopeId?: string;
    sessionMode?: BotSessionMode;
    runId?: string;
    jobId?: string;
  }
) => {
  const sessionMode = options?.sessionMode ?? getBotSessionMode();
  const scopeId = options?.scopeId ?? getBotScopeId();

  if (sessionMode !== "ephemeral") {
    return {
      path: resolveScopedPath(basePath, scopeId),
      sessionMode,
      cleanup: async () => undefined,
    };
  }

  const rootDir = path.resolve(os.tmpdir(), "interactionbot-worker-sessions");
  await fs.mkdir(rootDir, { recursive: true });

  const seed = [scopeId, options?.runId, options?.jobId].filter(Boolean).join("-") || "session";
  const prefix = `${normalizeSegment(seed)}-`;
  const sessionPath = await fs.mkdtemp(path.join(rootDir, prefix));

  return {
    path: sessionPath,
    sessionMode,
    cleanup: async () => {
      await fs.rm(sessionPath, {
        recursive: true,
        force: true,
      });
    },
  };
};
