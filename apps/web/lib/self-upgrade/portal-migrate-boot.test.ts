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

/** Fake `pnpm` (exit code configurable via PNPM_EXIT) and an instant `sleep`. */
function makeFakeBin(root: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "pnpm"),
    '#!/bin/sh\necho "[fake pnpm] $*"\nexit ${PNPM_EXIT:-0}\n',
  );
  writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n"); // instant — no real waits
  chmodSync(join(bin, "pnpm"), 0o755);
  chmodSync(join(bin, "sleep"), 0o755);
  return bin;
}

function run(opts: { appDir: string; fakeBin: string; pnpmExit: number }) {
  const exports = [
    `export PATH=${q(toBashPath(opts.fakeBin))}:"$PATH"`,
    `export DPF_APP_DIR=${q(toBashPath(opts.appDir))}`,
    `export PNPM_EXIT=${opts.pnpmExit}`,
  ].join("\n");
  // The server command is a marker echo — it only runs if migrate succeeds.
  const r = spawnSync(
    "bash",
    ["-lc", `${exports}\nbash ${q(toBashPath(SCRIPT))} sh -c 'echo BOOT_MARKER'`],
    { encoding: "utf8" },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
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
