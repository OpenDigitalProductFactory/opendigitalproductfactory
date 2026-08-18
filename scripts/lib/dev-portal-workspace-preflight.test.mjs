/**
 * BI-0DF1F354 — unit + integration-style contract tests for preflight + boot plan.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  assessDevPortalWorkspace,
  formatPreflightFailure,
  planDevPortalBoot,
  preflightExitCode,
  PREFLIGHT_FAIL_EXIT,
  simulateDevPortalEntrypoint,
} from "./dev-portal-workspace-preflight.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const preflightPath = join(here, "dev-portal-workspace-preflight.mjs");
const entrypointPath = join(here, "dev-portal-entrypoint.sh");

describe("assessDevPortalWorkspace (BI-0DF1F354)", () => {
  it("fails when root is empty", () => {
    const r = assessDevPortalWorkspace("", {
      existsSync: () => false,
      statSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      readFileSync: () => "",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "missing-root");
  });

  it("fails when root path does not exist (worktree removed)", () => {
    const r = assessDevPortalWorkspace("/gone/worktree", {
      existsSync: () => false,
      statSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      readFileSync: () => "",
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "root-missing");
      assert.match(r.detail, /removed|exist/i);
    }
  });

  it("fails when package.json is missing (empty bind mount)", () => {
    const io = {
      existsSync: (p) => p === "/workspace",
      statSync: (p) => {
        if (p === "/workspace") return { isDirectory: () => true };
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      readFileSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    };
    const r = assessDevPortalWorkspace("/workspace", io);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "package-json-missing");
  });

  it("fails when apps/web/package.json is missing", () => {
    const root = "/workspace";
    const map = new Map([
      [`${root}/package.json`, JSON.stringify({ name: "dpf" })],
    ]);
    const io = {
      existsSync: (p) => map.has(p),
      statSync: (p) => {
        if (p === root) return { isDirectory: () => true };
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      readFileSync: (p) => map.get(p),
    };
    const r = assessDevPortalWorkspace(root, io);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "web-package-missing");
  });

  it("passes for a full DPF monorepo layout", () => {
    const root = "/workspace";
    const map = new Map([
      [`${root}/package.json`, JSON.stringify({ name: "dpf", private: true })],
      [`${root}/apps/web/package.json`, JSON.stringify({ name: "web" })],
    ]);
    const io = {
      existsSync: (p) => map.has(p),
      statSync: (p) => {
        if (p === root) return { isDirectory: () => true };
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      readFileSync: (p) => map.get(p),
    };
    const r = assessDevPortalWorkspace(root, io);
    assert.equal(r.ok, true);
  });
});

describe("boot plan / entrypoint contract (BI-0DF1F354)", () => {
  it("preflight CLI exits non-zero on fail so entrypoint can gate pnpm", () => {
    const fail = /** @type {const} */ ({
      ok: false,
      reason: "package-json-missing",
      detail: "gone",
    });
    assert.equal(preflightExitCode(fail), PREFLIGHT_FAIL_EXIT);
    assert.notEqual(preflightExitCode(fail), 0);
    assert.equal(preflightExitCode({ ok: true }), 0);
  });

  it("missing workspace must not run pnpm and container exits 0 (no thrash)", () => {
    const fail = /** @type {const} */ ({
      ok: false,
      reason: "package-json-missing",
      detail: "empty mount",
    });
    const plan = planDevPortalBoot(fail);
    assert.equal(plan.runInstallAndDev, false);
    assert.equal(plan.processExitCode, 0);
    assert.equal(plan.action, "stop-clean");

    const sim = simulateDevPortalEntrypoint(fail);
    assert.equal(sim.ranPnpm, false);
    assert.equal(sim.finalExit, 0);
  });

  it("healthy workspace runs install+dev", () => {
    const plan = planDevPortalBoot({ ok: true });
    assert.equal(plan.runInstallAndDev, true);
    assert.equal(plan.preflightCliExitCode, 0);
    const sim = simulateDevPortalEntrypoint({ ok: true });
    assert.equal(sim.ranPnpm, true);
  });

  it("formats a clear BI-tagged failure banner", () => {
    const msg = formatPreflightFailure({
      ok: false,
      reason: "root-missing",
      detail: "worktree deleted",
    });
    assert.match(msg, /BI-0DF1F354/);
    assert.match(msg, /crash-loop/i);
    assert.match(msg, /worktree deleted/);
  });
});

describe("integration-style: real preflight + entrypoint shell (BI-0DF1F354)", () => {
  it("empty mount: preflight fails non-zero; entrypoint exits 0 and never invokes pnpm", () => {
    const empty = mkdtempSync(join(tmpdir(), "dpf-empty-ws-"));
    // Preflight alone against empty dir
    const pre = spawnSync(process.execPath, [preflightPath], {
      env: { ...process.env, DPF_DEV_PORTAL_WORKSPACE_ROOT: empty },
      encoding: "utf8",
    });
    assert.notEqual(pre.status, 0, "preflight must fail non-zero on empty mount");
    assert.match(pre.stderr || "", /BI-0DF1F354|package-json-missing|STOPPING/i);

    // Entrypoint with a stub preflight that fails + a pnpm marker that must stay empty
    const sandbox = mkdtempSync(join(tmpdir(), "dpf-entry-"));
    const marker = join(sandbox, "pnpm-ran");
    const stubPreflight = join(sandbox, "preflight-stub.mjs");
    writeFileSync(
      stubPreflight,
      `process.stderr.write("stub-fail\\n"); process.exit(${PREFLIGHT_FAIL_EXIT});\n`,
    );
    const entry = join(sandbox, "entry.sh");
    // Mirror production entrypoint: if ! preflight; then exit 0; fi; else run pnpm marker
    writeFileSync(
      entry,
      `#!/bin/sh
set -eu
if ! node "${stubPreflight}"; then
  exit 0
fi
echo ran > "${marker}"
exit 99
`,
    );
    chmodSync(entry, 0o755);

    const run = spawnSync("sh", [entry], { encoding: "utf8" });
    assert.equal(run.status, 0, "entrypoint must exit 0 on missing workspace");
    assert.equal(
      existsSafe(marker),
      false,
      "pnpm/dev chain must not run when preflight fails",
    );
  });

  // BI-FFFEFBCC: this file is baked ALONE into the image (no lib/entry-module.mjs
  // beside it), so its entry guard is a self-contained realpath mirror. Pin that
  // the guard still fires — main() runs and reports the empty workspace — when
  // the script is invoked through a symlinked directory (macOS /var tmpdir shape).
  it("still runs main() when invoked through a symlinked path", (t) => {
    const temp = mkdtempSync(join(tmpdir(), "dpf-preflight-symlink-"));
    const link = join(temp, "lib-link");
    try {
      // "junction" keeps this runnable on Windows hosts without symlink privilege.
      symlinkSync(here, link, "junction");
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      t.skip(`cannot create a directory symlink on this host: ${error.code}`);
      return;
    }
    try {
      const empty = mkdtempSync(join(tmpdir(), "dpf-empty-ws-"));
      const run = spawnSync(process.execPath, [join(link, "dev-portal-workspace-preflight.mjs")], {
        env: { ...process.env, DPF_DEV_PORTAL_WORKSPACE_ROOT: empty },
        encoding: "utf8",
      });
      assert.notEqual(run.status, 0, "main() must run under a symlinked argv[1], not silently exit 0");
      assert.match(run.stderr || "", /BI-0DF1F354|package-json-missing|STOPPING/i);
      rmSync(empty, { recursive: true, force: true });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("Dockerfile bakes preflight into the image path (structural)", () => {
    const dockerfile = readFileSync(join(here, "../../Dockerfile"), "utf8");
    assert.match(dockerfile, /COPY.*dev-portal-workspace-preflight\.mjs.*\/usr\/local\/bin/);
    assert.match(dockerfile, /dev-portal-entrypoint\.sh/);
    assert.match(dockerfile, /CMD\s*\[\s*"\/usr\/local\/bin\/dev-portal-entrypoint\.sh"/);
    // Must NOT be bare `preflight && pnpm` with worktree-relative path only
    assert.doesNotMatch(
      dockerfile,
      /CMD\s*\[\s*"sh",\s*"-c",\s*"node scripts\/lib\/dev-portal-workspace-preflight/,
    );
    const entryBody = readFileSync(entrypointPath, "utf8");
    assert.match(entryBody, /if ! node/);
    assert.match(entryBody, /exit 0/);
    assert.match(entryBody, /pnpm install/);
  });
});

function existsSafe(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
