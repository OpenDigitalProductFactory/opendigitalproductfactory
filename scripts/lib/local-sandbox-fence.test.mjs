import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireLocalSandboxFence,
  heartbeatLocalSandboxFence,
  releaseLocalSandboxFence,
} from "./local-sandbox-fence.mjs";

function fencePath() {
  return join(mkdtempSync(join(tmpdir(), "dpf-sandbox-fence-")), "owner.json");
}

test("a live owner blocks a competing claimant even beyond database TTL", () => {
  const path = fencePath();
  const first = acquireLocalSandboxFence({
    path,
    ownerSessionId: "owner-1",
    branch: "feat/one",
    pid: 101,
    processAlive: () => true,
    token: "token-1",
  });
  const second = acquireLocalSandboxFence({
    path,
    ownerSessionId: "owner-2",
    branch: "feat/two",
    pid: 202,
    processAlive: () => true,
    token: "token-2",
  });

  assert.equal(first.status, "acquired");
  assert.equal(second.status, "conflict");
  assert.equal(second.active.token, "token-1");
});

test("a dead orphan is reaped and replaced atomically", () => {
  const path = fencePath();
  writeFileSync(path, JSON.stringify({
    token: "orphan",
    pid: 303,
    ownerSessionId: "dead",
    branch: "feat/dead",
  }));

  const claimed = acquireLocalSandboxFence({
    path,
    ownerSessionId: "owner-new",
    branch: "feat/new",
    pid: 404,
    processAlive: () => false,
    token: "token-new",
  });

  assert.equal(claimed.status, "acquired");
  assert.equal(claimed.record.token, "token-new");
});

test("heartbeat and release are fenced by the owner token", () => {
  const path = fencePath();
  acquireLocalSandboxFence({
    path,
    ownerSessionId: "owner",
    branch: "feat/one",
    pid: 505,
    processAlive: () => true,
    token: "mine",
  });

  assert.equal(heartbeatLocalSandboxFence({ path, token: "intruder" }).status, "lost");
  assert.equal(releaseLocalSandboxFence({ path, token: "intruder" }).status, "not-owner");
  assert.equal(heartbeatLocalSandboxFence({ path, token: "mine" }).status, "renewed");
  assert.equal(releaseLocalSandboxFence({ path, token: "mine" }).status, "released");
  assert.equal(existsSync(path), false);
});
