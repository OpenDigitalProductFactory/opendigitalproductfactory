import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertLocalCiCleanupTarget,
  createLocalCiSlotManifest,
} from "./local-ci-slot-manifest.mjs";
import {
  acquireLocalSandboxFence,
  releaseLocalSandboxFence,
} from "./local-sandbox-fence.mjs";

test("fencing, output, and cleanup in one synthetic slot cannot affect its peer", (t) => {
  const hostRoot = mkdtempSync(join(tmpdir(), "dpf-local-ci-slot-processes-"));
  const rootClone = join(hostRoot, "DPF");
  const gitCommonDir = join(rootClone, ".git");
  const candidateGitDir = join(gitCommonDir, "worktrees", "candidate");
  mkdirSync(candidateGitDir, { recursive: true });
  const slot0 = createLocalCiSlotManifest({
    slotKey: "slot-0",
    rootClone,
    gitCommonDir,
    candidateGitDir,
  });
  const slot1 = createLocalCiSlotManifest({
    slotKey: "slot-1",
    rootClone,
    gitCommonDir,
    candidateGitDir,
  });
  mkdirSync(slot0.scratch.workspace, { recursive: true });
  mkdirSync(slot1.scratch.workspace, { recursive: true });

  const owner0 = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const owner1 = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  t.after(() => {
    owner0.kill();
    owner1.kill();
    rmSync(hostRoot, { recursive: true, force: true });
  });

  const fence0 = acquireLocalSandboxFence({
    path: slot0.fence.path,
    ownerSessionId: "synthetic-slot-0",
    branch: "feat/slot-0",
    pid: owner0.pid,
    token: "slot-0-token",
  });
  const fence1 = acquireLocalSandboxFence({
    path: slot1.fence.path,
    ownerSessionId: "synthetic-slot-1",
    branch: "feat/slot-1",
    pid: owner1.pid,
    token: "slot-1-token",
  });
  assert.equal(fence0.status, "acquired");
  assert.equal(fence1.status, "acquired");

  writeFileSync(slot0.output.log, "slot 0 output\n");
  writeFileSync(slot1.output.log, "slot 1 output\n");
  writeFileSync(join(slot0.scratch.workspace, "slot-0.tmp"), "owned by slot 0\n");
  writeFileSync(join(slot1.scratch.workspace, "slot-1.tmp"), "owned by slot 1\n");

  assert.equal(
    releaseLocalSandboxFence({ path: slot0.fence.path, token: "slot-0-token" }).status,
    "released",
  );
  rmSync(assertLocalCiCleanupTarget(slot0, slot0.scratch.workspace), {
    recursive: true,
    force: true,
  });
  rmSync(slot0.output.log, { force: true });

  assert.equal(existsSync(slot0.fence.path), false);
  assert.equal(existsSync(slot0.scratch.workspace), false);
  assert.equal(existsSync(slot0.output.log), false);
  assert.equal(existsSync(slot1.fence.path), true);
  assert.equal(existsSync(slot1.scratch.workspace), true);
  assert.equal(existsSync(slot1.output.log), true);
  assert.equal(owner1.killed, false);

  assert.equal(
    releaseLocalSandboxFence({ path: slot1.fence.path, token: "slot-1-token" }).status,
    "released",
  );
});
