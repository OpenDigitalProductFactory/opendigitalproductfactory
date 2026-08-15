import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "root-clone-freshness.mjs");

function hookCommandsFor(eventName) {
  const wiring = JSON.parse(readFileSync(join(here, "hooks.json"), "utf8"));
  const events = wiring.hooks ?? wiring;
  return (events[eventName] ?? []).flatMap((entry) =>
    (entry.hooks ?? []).map((h) => String(h.command ?? "")),
  );
}

describe("root-clone-freshness wiring", () => {
  it("is wired on SessionStart via the plugin root", () => {
    const cmds = hookCommandsFor("SessionStart").filter((c) => c.includes("root-clone-freshness.mjs"));
    assert.ok(cmds.length > 0, "root-clone-freshness must run on SessionStart");
    for (const c of cmds) {
      assert.ok(c.includes("CLAUDE_PLUGIN_ROOT"), `command must use CLAUDE_PLUGIN_ROOT: ${c}`);
    }
  });

  it("is NOT wired to Stop or SessionEnd — root freshness is a session-start concern only", () => {
    for (const event of ["Stop", "SessionEnd"]) {
      assert.ok(
        !hookCommandsFor(event).some((c) => c.includes("root-clone-freshness.mjs")),
        `root-clone-freshness must not run on ${event}`,
      );
    }
  });
});

describe("root-clone-freshness behavior", () => {
  it("no-ops with the skip env and emits nothing", () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, DPF_SKIP_ROOT_CLONE_REFRESH: "1" },
      input: JSON.stringify({ hookEventName: "SessionStart", cwd: process.cwd() }),
      windowsHide: true,
      timeout: 15_000,
    });
    assert.equal(r.status, 0);
    assert.equal((r.stdout || "").trim(), "");
  });

  it("no-ops outside a DPF workspace", () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env },
      input: JSON.stringify({ hookEventName: "SessionStart", cwd: dirname(process.cwd()) + "/definitely-not-dpf-xyz" }),
      windowsHide: true,
      timeout: 15_000,
    });
    assert.equal(r.status, 0);
  });

  it("exits 0 fast on a SessionStart against the current checkout (never blocks a session)", () => {
    // A clean root or an unmeasurable state must resolve to exit 0 with at most an
    // advisory on stdout — it must never throw or hang session startup.
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: join(here, "../../.."),
      // Do not fetch in the test — avoid any network dependency / latency.
      env: { ...process.env, DPF_SKIP_ROOT_CLONE_REFRESH: "1" },
      input: JSON.stringify({ hookEventName: "SessionStart", cwd: join(here, "../../..") }),
      windowsHide: true,
      timeout: 15_000,
    });
    assert.equal(r.status, 0);
  });
});
