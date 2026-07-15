import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Functional proof of scripts/portal-migrate-boot.sh (BI-5322D025): the portal's
// boot wrapper applies migrations from its own bytes, then execs the server —
// fail-closed if migrations can't apply. We run the REAL script with a fake
// `pnpm` (success/fail) + instant `sleep` on PATH and a scratch DPF_APP_DIR.

const SCRIPT = resolve(__dirname, "../../../../scripts/portal-migrate-boot.sh");
const BASH_OK = spawnSync("bash", ["--version"], { encoding: "utf8" }).status === 0;
const TIMEOUT_MS = 30_000;

function toBashPath(value: string): string {
  if (process.platform !== "win32") return value;
  const normalized = value.replace(/\\/g, "/");
  const m = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!m) return normalized;
  const cwdDrive = /^([A-Za-z]):/.exec(process.cwd())?.[1]?.toLowerCase();
  const pwd = spawnSync("bash", ["-lc", "pwd"], { encoding: "utf8" }).stdout.trim();
  const prefix = cwdDrive && pwd.startsWith(`/mnt/${cwdDrive}/`) ? "/mnt" : "";
  return `${prefix}/${m[1].toLowerCase()}/${m[2]}`;
}

function q(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Fake `pnpm` (exit code configurable via PNPM_EXIT/PNPM_FAIL_MATCH) and an instant `sleep`. */
function makeFakeBin(root: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "pnpm"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PNPM_LOG"\necho "[fake pnpm] $*"\ncase "$*" in\n  *"$PNPM_FAIL_MATCH"*) [ -n "$PNPM_FAIL_MATCH" ] && exit 1 ;;\nesac\nexit ${PNPM_EXIT:-0}\n',
  );
  writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n"); // instant — no real waits
  chmodSync(join(bin, "pnpm"), 0o755);
  chmodSync(join(bin, "sleep"), 0o755);
  return bin;
}

function run(opts: { appDir: string; fakeBin: string; pnpmExit: number; pnpmFailMatch?: string }) {
  const pnpmLog = join(opts.appDir, "pnpm.log");
  const exports = [
    `export PATH=${q(toBashPath(opts.fakeBin))}:"$PATH"`,
    `export DPF_APP_DIR=${q(toBashPath(opts.appDir))}`,
    `export PNPM_EXIT=${opts.pnpmExit}`,
    `export PNPM_LOG=${q(toBashPath(pnpmLog))}`,
    `export PNPM_FAIL_MATCH=${q(opts.pnpmFailMatch ?? "")}`,
  ].join("\n");
  // The server command is a marker echo — it only runs if migrate succeeds.
  const r = spawnSync(
    "bash",
    ["-lc", `${exports}\nbash ${q(toBashPath(SCRIPT))} sh -c 'echo BOOT_MARKER'`],
    { encoding: "utf8" },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", pnpmLog };
}

describe.skipIf(!BASH_OK)("portal-migrate-boot.sh (BI-5322D025)", () => {
  it("applies migrations then execs the server command", () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({ appDir, fakeBin: makeFakeBin(root), pnpmExit: 0 });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("prisma migrate deploy"); // the fake pnpm echoed its args
      expect(r.stdout).toContain("migrations applied");
      expect(r.stdout).toContain("BOOT_MARKER"); // server command was exec'd
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  it("syncs provider registry and catalog capabilities before starting the server", () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({ appDir, fakeBin: makeFakeBin(root), pnpmExit: 0 });
      expect(r.status).toBe(0);
      const log = r.stdout;
      expect(log.indexOf("prisma migrate deploy")).toBeLessThan(log.indexOf("scripts/sync-provider-registry.ts"));
      expect(log.indexOf("scripts/sync-provider-registry.ts")).toBeLessThan(log.indexOf("scripts/reconcile-catalog-capabilities.ts"));
      expect(log.indexOf("scripts/reconcile-catalog-capabilities.ts")).toBeLessThan(log.indexOf("BOOT_MARKER"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  it("FAILS CLOSED - does not start the server when provider registry sync fails", () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({
        appDir,
        fakeBin: makeFakeBin(root),
        pnpmExit: 0,
        pnpmFailMatch: "scripts/sync-provider-registry.ts",
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("provider registry sync failed");
      expect(r.stdout).not.toContain("BOOT_MARKER");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  it("DEGRADES OPEN — still starts the server when model-capability reconciliation fails", () => {
    // Regression guard for the portal boot-loop: a stale/partial model catalog is a
    // degraded state, not a correctness hazard, so reconcile-catalog-capabilities.ts
    // failing (e.g. a new/renamed model the reconciler can't write) must NOT block boot.
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({
        appDir,
        fakeBin: makeFakeBin(root),
        pnpmExit: 0,
        pnpmFailMatch: "scripts/reconcile-catalog-capabilities.ts",
      });
      expect(r.status).toBe(0); // boot still succeeds
      expect(r.stderr).toContain("catalog capability reconciliation failed");
      expect(r.stdout).toContain("BOOT_MARKER"); // server WAS started despite the failure
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  it("DEGRADES OPEN — still starts the server when the BET-5 datastore backfill fails", () => {
    // BI-A1E864A5: the Neo4j/Qdrant→Postgres backfill is best-effort and idempotent (the
    // separately-gated teardown enforces data safety), so it must never block boot. Observed
    // live: a backfill that hung after its work left the portal wedged before `exec server`,
    // never serving. The script force-exits when done and the boot line is timeout-guarded;
    // this proves a NON-zero backfill result still degrades open to the server start.
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({
        appDir,
        fakeBin: makeFakeBin(root),
        pnpmExit: 0,
        pnpmFailMatch: "scripts/bet5-decommission-backfill.ts",
      });
      expect(r.status).toBe(0); // boot still succeeds
      expect(r.stderr).toContain("BET-5 datastore backfill reported an error");
      expect(r.stdout).toContain("BOOT_MARKER"); // server WAS started despite the failure
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  it("FAILS CLOSED — does not start the server when migrations cannot apply", () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({ appDir, fakeBin: makeFakeBin(root), pnpmExit: 1 });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("failed after 5 attempts");
      expect(r.stdout).not.toContain("BOOT_MARKER"); // server never started
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  it("FAILS LOUD when the app dir is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const r = run({ appDir: join(root, "does-not-exist"), fakeBin: makeFakeBin(root), pnpmExit: 0 });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("app dir");
      expect(r.stdout).not.toContain("BOOT_MARKER");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);
});
