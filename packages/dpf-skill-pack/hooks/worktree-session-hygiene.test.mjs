import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "worktree-session-hygiene.mjs");

describe("worktree-session-hygiene", () => {
  it("no-ops outside DPF workspace and with skip env", () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        DPF_SKIP_WORKTREE_SESSION_HYGIENE: "1",
      },
      input: JSON.stringify({ hookEventName: "SessionStart", cwd: process.cwd() }),
      windowsHide: true,
    });
    assert.equal(r.status, 0);
    assert.equal((r.stdout || "").trim(), "");
  });

  it("SessionStart in DPF workspace exits 0 (may emit context)", () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: join(here, "../../.."),
      env: {
        ...process.env,
        DPF_SKIP_WORKTREE_SESSION_HYGIENE: "0",
      },
      input: JSON.stringify({
        hookEventName: "SessionStart",
        cwd: join(here, "../../.."),
      }),
      windowsHide: true,
      timeout: 60_000,
    });
    assert.equal(r.status, 0);
  });
});
