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
const TIMEOUT_MS = 30_000;
const BOOT_SUBPROCESS_TIMEOUT_MS = 10_000;
// Probe once, with a hard deadline. The old converter started `bash -lc pwd`
// for every path in every case (28 extra synchronous Bash launches per file),
// which was the only command outside the per-case watchdog and let a delayed
// Git Bash startup move a 30s timeout/status 127 between otherwise unrelated
// cases under local-CI load.
const BASH_PROBE = spawnSync("bash", ["-lc", "printf '%s' \"$PWD\""], {
  encoding: "utf8",
  timeout: 2_000,
});
const BASH_OK = BASH_PROBE.status === 0;
const BASH_PWD = BASH_PROBE.stdout?.trim() ?? "";

// The portable process-group watchdog (used when GNU `timeout` is absent, e.g.
// stock macOS) times itself with its own `sleep`. But makeFakeBin() puts an
// instant fake `sleep` on PATH to neutralize the SCRIPT's retry `sleep 3`, and
// that fake shadows the watchdog's `sleep` too — so the watchdog fires at 0s and
// SIGTERMs a healthy boot before it can exit. Resolve the REAL `sleep` once (in
// an unmodified PATH) and invoke it by absolute path in the watchdog so the fake
// only affects the script it was meant for. On Linux/Git Bash the native
// `timeout` path runs instead, so this value is unused there.
const SLEEP_PROBE = spawnSync("sh", ["-lc", "command -v sleep"], {
  encoding: "utf8",
  timeout: 2_000,
});
const REAL_SLEEP =
  SLEEP_PROBE.status === 0 && SLEEP_PROBE.stdout?.trim() ? SLEEP_PROBE.stdout.trim() : "/bin/sleep";

function toBashPath(value: string): string {
  if (process.platform !== "win32") return value;
  const normalized = value.replace(/\\/g, "/");
  const m = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!m) return normalized;
  const cwdDrive = /^([A-Za-z]):/.exec(process.cwd())?.[1]?.toLowerCase();
  const prefix = cwdDrive && BASH_PWD.startsWith(`/mnt/${cwdDrive}/`) ? "/mnt" : "";
  return `${prefix}/${m[1].toLowerCase()}/${m[2]}`;
}

function q(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Fake `pnpm` (exit code/failure/hang configurable via env) and an instant retry `sleep`. */
function makeFakeBin(root: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "pnpm"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PNPM_LOG"\necho "[fake pnpm] $*"\nif [ -n "$PNPM_HANG_MATCH" ]; then\n  case "$*" in *"$PNPM_HANG_MATCH"*) /bin/sleep "${PNPM_HANG_SECONDS:-3}" ;; esac\nfi\nif [ -n "$PNPM_FAIL_MATCH" ]; then\n  case "$*" in *"$PNPM_FAIL_MATCH"*) exit 1 ;; esac\nfi\nexit ${PNPM_EXIT:-0}\n',
  );
  writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n"); // instant — no real waits
  chmodSync(join(bin, "pnpm"), 0o755);
  chmodSync(join(bin, "sleep"), 0o755);
  return bin;
}

function run(opts: {
  appDir: string;
  fakeBin: string;
  pnpmExit: number;
  pnpmFailMatch?: string;
  pnpmHangMatch?: string;
  subprocessTimeoutMs?: number;
  forcePortableWatchdog?: boolean;
}) {
  const pnpmLog = join(opts.appDir, "pnpm.log");
  const exports = [
    `export PATH=${q(toBashPath(opts.fakeBin))}:"$PATH"`,
    `export DPF_APP_DIR=${q(toBashPath(opts.appDir))}`,
    `export PNPM_EXIT=${opts.pnpmExit}`,
    `export PNPM_LOG=${q(toBashPath(pnpmLog))}`,
    `export PNPM_FAIL_MATCH=${q(opts.pnpmFailMatch ?? "")}`,
    `export PNPM_HANG_MATCH=${q(opts.pnpmHangMatch ?? "")}`,
    `export DPF_TEST_FORCE_PORTABLE_WATCHDOG=${opts.forcePortableWatchdog ? "1" : "0"}`,
  ].join("\n");
  // A synchronous child blocks Vitest's timer, so the shell owns the primary
  // deadline and kills the whole process group. The Node timeout is a secondary
  // fail-safe for a broken/missing `timeout` binary, not the normal path.
  const subprocessTimeoutMs = opts.subprocessTimeoutMs ?? BOOT_SUBPROCESS_TIMEOUT_MS;
  const timeoutSeconds = (subprocessTimeoutMs / 1_000).toFixed(3);
  const bootCommand = `bash ${q(toBashPath(SCRIPT))} sh -c 'echo BOOT_MARKER'`;
  // Git Bash and Linux have GNU timeout. Stock macOS does not, so retain a
  // process-group watchdog fallback rather than baking a GNU-only command into
  // a cross-platform test. Both paths normalize a deadline to status 124.
  const boundedCommand = [
    'if [ "$DPF_TEST_FORCE_PORTABLE_WATCHDOG" != "1" ] && command -v timeout >/dev/null 2>&1; then',
    `  timeout --signal=TERM --kill-after=1s ${timeoutSeconds}s ${bootCommand}`,
    "else",
    "  set -m",
    `  ${bootCommand} & boot_pid=$!`,
    `  ( ${q(toBashPath(REAL_SLEEP))} ${timeoutSeconds}; kill -TERM -$boot_pid 2>/dev/null || kill -TERM $boot_pid 2>/dev/null; ${q(toBashPath(REAL_SLEEP))} 1; kill -KILL -$boot_pid 2>/dev/null || true ) & watchdog_pid=$!`,
    "  wait $boot_pid; boot_status=$?",
    // Kill the watchdog's whole process group (set -m gave it its own), not just
    // the subshell: otherwise its real `sleep` is orphaned, keeps the stdout pipe
    // open, and stalls spawnSync for the full timeout after a healthy boot exits.
    "  kill -TERM -$watchdog_pid 2>/dev/null || kill -TERM $watchdog_pid 2>/dev/null || true",
    "  wait $watchdog_pid 2>/dev/null || true",
    '  [ "$boot_status" -ge 128 ] && exit 124',
    '  exit "$boot_status"',
    "fi",
  ].join("\n");
  const startedAt = Date.now();
  const r = spawnSync(
    "bash",
    ["-lc", `${exports}\n${boundedCommand}`],
    { encoding: "utf8", timeout: subprocessTimeoutMs + 2_000 },
  );
  return {
    status: r.status,
    signal: r.signal,
    error: r.error?.message ?? "",
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    pnpmLog,
    command: boundedCommand,
    timedOut:
      r.status === 124
      || r.status === 137
      || (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
    durationMs: Date.now() - startedAt,
  };
}

function bootDiagnostics(r: ReturnType<typeof run>): string {
  return [
    `command: ${r.command}`,
    `status: ${String(r.status)} signal: ${String(r.signal)} timedOut: ${String(r.timedOut)}`,
    `error: ${r.error || "<none>"}`,
    `stdout:\n${r.stdout || "<empty>"}`,
    `stderr:\n${r.stderr || "<empty>"}`,
  ].join("\n");
}

describe.skipIf(!BASH_OK)("portal-migrate-boot.sh (BI-5322D025)", () => {
  it("applies migrations then execs the server command", () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({ appDir, fakeBin: makeFakeBin(root), pnpmExit: 0 });
      expect(r.status, bootDiagnostics(r)).toBe(0);
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
      expect(r.status, bootDiagnostics(r)).toBe(0);
      const log = r.stdout;
      expect(log.indexOf("prisma migrate deploy")).toBeLessThan(log.indexOf("scripts/sync-provider-registry.ts"));
      expect(log.indexOf("scripts/sync-provider-registry.ts")).toBeLessThan(log.indexOf("scripts/reconcile-catalog-capabilities.ts"));
      // BI-D4C1E05E: the wiki embedding self-heal runs after the catalog reconcile
      // and before the server starts.
      expect(log.indexOf("scripts/reconcile-catalog-capabilities.ts")).toBeLessThan(log.indexOf("scripts/reembed-wiki-store.ts"));
      expect(log.indexOf("scripts/reembed-wiki-store.ts")).toBeLessThan(log.indexOf("BOOT_MARKER"));
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
      expect(r.status, bootDiagnostics(r)).not.toBe(0);
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
      expect(r.status, bootDiagnostics(r)).toBe(0); // boot still succeeds
      expect(r.stderr).toContain("catalog capability reconciliation failed");
      expect(r.stdout).toContain("BOOT_MARKER"); // server WAS started despite the failure
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  it("DEGRADES OPEN — still starts the server when wiki embedding self-heal fails", () => {
    // BI-D4C1E05E: a drifted wiki vector index is a degraded retrieval state, not a
    // correctness hazard for serving the portal, and the embedding provider may be
    // legitimately unreachable at boot (the reembed script exits 1 in that case). So
    // reembed-wiki-store.ts failing must NOT block boot — same degrade-open contract
    // as the model-catalog reconcile, and the write-path embed keeps new publishes
    // covered in the meantime.
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({
        appDir,
        fakeBin: makeFakeBin(root),
        pnpmExit: 0,
        pnpmFailMatch: "scripts/reembed-wiki-store.ts",
      });
      expect(r.status, bootDiagnostics(r)).toBe(0); // boot still succeeds
      expect(r.stderr).toContain("wiki embedding self-heal did not reach full coverage");
      expect(r.stdout).toContain("BOOT_MARKER"); // server WAS started despite the failure
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  // (Removed: the BET-5 boot backfill degrade-open test — the one-time Neo4j/Qdrant→Postgres
  // boot backfill was retired once the fleet finished migrating, BI-2A3BE4D7. Boot no longer
  // runs it, so there is nothing to degrade open around.)

  it("FAILS CLOSED — does not start the server when migrations cannot apply", () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({ appDir, fakeBin: makeFakeBin(root), pnpmExit: 1 });
      expect(r.status, bootDiagnostics(r)).not.toBe(0);
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
      expect(r.status, bootDiagnostics(r)).not.toBe(0);
      expect(r.stderr).toContain("app dir");
      expect(r.stdout).not.toContain("BOOT_MARKER");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);

  it.each([
    { watchdog: "native timeout", forcePortableWatchdog: false },
    { watchdog: "portable process group", forcePortableWatchdog: true },
  ])("terminates a hung boot subprocess with the $watchdog watchdog", ({ forcePortableWatchdog }) => {
    const root = mkdtempSync(join(tmpdir(), "dpf-pmb-"));
    try {
      const appDir = join(root, "app");
      mkdirSync(appDir, { recursive: true });
      const r = run({
        appDir,
        fakeBin: makeFakeBin(root),
        pnpmExit: 0,
        pnpmHangMatch: "prisma migrate deploy",
        subprocessTimeoutMs: 1_000,
        forcePortableWatchdog,
      });
      // Status 124 IS the watchdog's deadline signal — both the GNU `timeout`
      // path and the portable process-group path normalize to it (see
      // boundedCommand above), and nothing else in this harness produces it. If
      // the watchdog never fired, the spawnSync backstop at
      // `subprocessTimeoutMs + 2_000` kills the process instead and the status
      // is not 124, so these two assertions already prove prompt termination.
      //
      // A wall-clock ceiling used to sit here as a third check: `durationMs`
      // under a bare 2_500 against a 1s deadline plus a 1s kill grace, leaving
      // ~500ms for Git Bash startup, process spawn and teardown. Under local-CI
      // load at --initial-workers 4 it went red twice in one evening, at 2559ms
      // and 2554ms, failing whole gate runs of ~25,400 otherwise-passing tests.
      // It was removed rather than widened: the signal it chased (did the
      // watchdog fire at its deadline?) and the noise it measured (host
      // scheduling) are the same order of magnitude, so no threshold separates
      // them — and any ceiling loose enough to be stable sits above the
      // spawnSync backstop, where it can never trip at all. BI-0F2A4137.
      expect(r.timedOut, bootDiagnostics(r)).toBe(true);
      expect(r.status, bootDiagnostics(r)).toBe(124);
      expect(r.command).toContain("portal-migrate-boot.sh");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT_MS);
});
