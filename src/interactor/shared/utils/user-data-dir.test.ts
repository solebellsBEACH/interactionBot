import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareBrowserUserDataDir,
  resolveScopedPath,
} from "./user-data-dir";

test("resolveScopedPath usa a conta linkedin como escopo quando informada", () => {
  const resolved = resolveScopedPath("/tmp/interactionbot", "Workspace A/Account B");
  assert.equal(resolved, path.resolve("/tmp/interactionbot", "workspace-a-account-b"));
});

test("prepareBrowserUserDataDir mantém persistência quando sessionMode=persistent", async () => {
  const session = await prepareBrowserUserDataDir("/tmp/interactionbot", {
    scopeId: "workspace-a",
    sessionMode: "persistent",
  });

  assert.equal(session.path, path.resolve("/tmp/interactionbot", "workspace-a"));
  await session.cleanup();
  assert.equal(session.path, path.resolve("/tmp/interactionbot", "workspace-a"));
});

test("prepareBrowserUserDataDir cria e remove diretório efêmero por execução", async () => {
  const basePath = path.join(os.tmpdir(), "interactionbot-tests");
  const session = await prepareBrowserUserDataDir(basePath, {
    scopeId: "workspace-a-account-b",
    sessionMode: "ephemeral",
    runId: "run-123",
    jobId: "job-456",
  });

  assert.equal(fs.existsSync(session.path), true);
  assert.equal(session.path.includes("workspace-a-account-b-run-123-job-456"), true);

  await session.cleanup();

  assert.equal(fs.existsSync(session.path), false);
});
