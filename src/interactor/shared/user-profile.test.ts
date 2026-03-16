import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readUserProfile,
  resetUserProfileAsync,
  saveUserProfileAsync,
} from "./user-profile";
import { setBotControlPlaneContext } from "./utils/user-data-dir";

test("user profile local permanece isolado por BOT_USER_ID", async () => {
  const previousCwd = process.cwd();
  const previousUserId = process.env.BOT_USER_ID;
  const previousStorage = process.env.USER_PROFILE_STORAGE;
  const previousSummary = process.env.USER_PROFILE;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-bot-profile-"));

  try {
    process.chdir(tempDir);
    process.env.USER_PROFILE_STORAGE = "local";
    delete process.env.USER_PROFILE;

    process.env.BOT_USER_ID = "tenant-a";
    await resetUserProfileAsync();
    await saveUserProfileAsync({
      summary: "Resumo A",
      answers: { location: "Salvador" },
    });

    const tenantAPath = path.join(tempDir, "data", "profiles", "tenant-a.json");
    assert.equal(fs.existsSync(tenantAPath), true);
    assert.equal(JSON.parse(fs.readFileSync(tenantAPath, "utf-8")).summary, "Resumo A");

    process.env.BOT_USER_ID = "tenant-b";
    const tenantBProfile = readUserProfile();
    assert.equal(tenantBProfile.summary, "");
    assert.deepEqual(tenantBProfile.answers, {});

    await saveUserProfileAsync({
      summary: "Resumo B",
      answers: { stack: "Node.js" },
    });

    const tenantBPath = path.join(tempDir, "data", "profiles", "tenant-b.json");
    assert.equal(fs.existsSync(tenantBPath), true);
    assert.equal(JSON.parse(fs.readFileSync(tenantBPath, "utf-8")).summary, "Resumo B");

    process.env.BOT_USER_ID = "tenant-a";
    const reloadedTenantA = readUserProfile();
    assert.equal(reloadedTenantA.summary, "Resumo A");
    assert.deepEqual(reloadedTenantA.answers, { location: "Salvador" });
  } finally {
    process.chdir(previousCwd);
    restoreEnv("BOT_USER_ID", previousUserId);
    restoreEnv("USER_PROFILE_STORAGE", previousStorage);
    restoreEnv("USER_PROFILE", previousSummary);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("user profile local usa workspace como escopo preferencial quando há contexto SaaS", async () => {
  const previousCwd = process.cwd();
  const previousUserId = process.env.BOT_USER_ID;
  const previousTenantId = process.env.BOT_TENANT_ID;
  const previousWorkspaceId = process.env.BOT_WORKSPACE_ID;
  const previousStorage = process.env.USER_PROFILE_STORAGE;
  const previousSummary = process.env.USER_PROFILE;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-bot-workspace-profile-"));

  try {
    process.chdir(tempDir);
    process.env.USER_PROFILE_STORAGE = "local";
    delete process.env.USER_PROFILE;
    delete process.env.BOT_USER_ID;
    delete process.env.BOT_TENANT_ID;
    delete process.env.BOT_WORKSPACE_ID;

    setBotControlPlaneContext({
      tenant: { id: "tenant-a" },
      workspace: { id: "workspace-a" },
      user: { id: "user-a" },
    });

    await resetUserProfileAsync();
    await saveUserProfileAsync({
      summary: "Resumo Workspace",
      answers: { role: "operator" },
    });

    const workspacePath = path.join(tempDir, "data", "profiles", "workspace-a.json");
    assert.equal(fs.existsSync(workspacePath), true);
    assert.equal(JSON.parse(fs.readFileSync(workspacePath, "utf-8")).summary, "Resumo Workspace");

    process.env.BOT_USER_ID = "user-b";
    const reloaded = readUserProfile();
    assert.equal(reloaded.summary, "Resumo Workspace");
    assert.deepEqual(reloaded.answers, { role: "operator" });
  } finally {
    process.chdir(previousCwd);
    restoreEnv("BOT_USER_ID", previousUserId);
    restoreEnv("BOT_TENANT_ID", previousTenantId);
    restoreEnv("BOT_WORKSPACE_ID", previousWorkspaceId);
    restoreEnv("USER_PROFILE_STORAGE", previousStorage);
    restoreEnv("USER_PROFILE", previousSummary);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("user profile local usa linkedin_account_id como escopo preferencial quando disponível", async () => {
  const previousCwd = process.cwd();
  const previousUserId = process.env.BOT_USER_ID;
  const previousTenantId = process.env.BOT_TENANT_ID;
  const previousWorkspaceId = process.env.BOT_WORKSPACE_ID;
  const previousLinkedinAccountId = process.env.BOT_LINKEDIN_ACCOUNT_ID;
  const previousStorage = process.env.USER_PROFILE_STORAGE;
  const previousSummary = process.env.USER_PROFILE;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-bot-account-profile-"));

  try {
    process.chdir(tempDir);
    process.env.USER_PROFILE_STORAGE = "local";
    delete process.env.USER_PROFILE;
    delete process.env.BOT_USER_ID;
    delete process.env.BOT_TENANT_ID;
    delete process.env.BOT_WORKSPACE_ID;
    delete process.env.BOT_LINKEDIN_ACCOUNT_ID;

    setBotControlPlaneContext({
      tenant: { id: "tenant-a" },
      workspace: { id: "workspace-a" },
      user: { id: "user-a" },
    });
    process.env.BOT_LINKEDIN_ACCOUNT_ID = "account-a";

    await resetUserProfileAsync();
    await saveUserProfileAsync({
      summary: "Resumo Conta A",
      answers: { role: "account-a" },
    });

    const accountPath = path.join(tempDir, "data", "profiles", "account-a.json");
    assert.equal(fs.existsSync(accountPath), true);

    process.env.BOT_LINKEDIN_ACCOUNT_ID = "account-b";
    const reloaded = readUserProfile();
    assert.equal(reloaded.summary, "");
    assert.deepEqual(reloaded.answers, {});
  } finally {
    process.chdir(previousCwd);
    restoreEnv("BOT_USER_ID", previousUserId);
    restoreEnv("BOT_TENANT_ID", previousTenantId);
    restoreEnv("BOT_WORKSPACE_ID", previousWorkspaceId);
    restoreEnv("BOT_LINKEDIN_ACCOUNT_ID", previousLinkedinAccountId);
    restoreEnv("USER_PROFILE_STORAGE", previousStorage);
    restoreEnv("USER_PROFILE", previousSummary);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};
