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

export const getBotScopeId = () => {
  return getBotWorkspaceId() || getBotTenantId() || getBotActorUserId();
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
