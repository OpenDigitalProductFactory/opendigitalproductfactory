import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync as _probe } from "node:child_process";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const BASH_COMMAND = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
// Skip entire suite on environments where bash is unavailable (e.g. Alpine sandbox)
const BASH_AVAILABLE = _probe(BASH_COMMAND, ["--version"], { encoding: "utf8" }).status === 0;

function quoteForBash(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveBashPath(path: string) {
  if (process.platform !== "win32") {
    return path;
  }

  const normalized = path.replace(/\\/g, "/");
  const driveMatch = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!driveMatch) {
    return normalized;
  }

  const [, drive, rest] = driveMatch;
  const candidates = [`/mnt/${drive.toLowerCase()}/${rest}`, `/${drive.toLowerCase()}/${rest}`, normalized];
  return (
    candidates.find((candidate) => {
      const probe = _probe(BASH_COMMAND, ["-lc", `test -f ${quoteForBash(candidate)}`], {
        encoding: "utf8",
      });
      return probe.status === 0;
    }) ?? normalized
  );
}

const SCRIPT = resolveBashPath(resolve(__dirname, "../../../../scripts/promote.sh"));
const REPO_ROOT = resolve(__dirname, "../../../..");

it("verifies the signed install-state handoff before reading the promotion projection", () => {
  const source = readFileSync(join(REPO_ROOT, "scripts", "promote.sh"), "utf8");
  expect(source.indexOf('lib/transition-signing.mjs')).toBeGreaterThan(0);
  expect(source.indexOf('lib/transition-signing.mjs')).toBeLessThan(source.indexOf('_capability_projection='));
});

const BASE_ENV: Record<string, string> = {
  PROMOTE_SOURCE: "/opt/app/release",
  PROMOTE_TARGET_SHA: "a1b2c3d4e5f6",
  PROMOTE_BACKUP_PATH: "/opt/app/backup",
  PROMOTE_HEALTH_URL: "http://localhost:3000/api/health",
};

function runScript(env: Record<string, string | undefined>, extraArgs: string[] = []) {
  const marker = basename(env.PROMOTE_SOURCE ?? "source").replace(/[^A-Za-z0-9-]/g, "-");
  const root = mkdtempSync(join(tmpdir(), `dpf-promote-contract-${marker}-`));
  try {
    const source = join(root, marker);
    const stateDir = join(root, "state");
    mkdirSync(join(source, "scripts", "lib"), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    copyFileSync(join(REPO_ROOT, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), join(source, "scripts", "lib", "resolve-capability-compose-profiles.mjs"));
    copyFileSync(join(REPO_ROOT, "scripts", "lib", "govern-capability-compose-args.mjs"), join(source, "scripts", "lib", "govern-capability-compose-args.mjs"));
    copyFileSync(join(REPO_ROOT, "scripts", "capability-service-catalog.generated.json"), join(source, "scripts", "capability-service-catalog.generated.json"));
    const catalog = JSON.parse(readFileSync(join(REPO_ROOT, "scripts", "capability-service-catalog.generated.json"), "utf8")) as { catalogHash: string; capabilities: Array<{ capabilityId: string }> };
    const enabledRuntimeCapabilities = ["runtime:core"];
    const stateLines = catalog.capabilities.map(({ capabilityId }) => `${capabilityId}=${enabledRuntimeCapabilities.includes(capabilityId) ? "active" : "disabled"}`).sort().join("\n");
    const capabilityStateVersion = createHash("sha256").update(`${catalog.catalogHash}\n${stateLines}`).digest("hex");
    writeFileSync(join(stateDir, "install-state.json"), JSON.stringify({ platform: "linux", enabledRuntimeCapabilities, capabilityCatalogHash: catalog.catalogHash, capabilityStateVersion }));

    const mapped = { ...env };
    if (mapped.PROMOTE_SOURCE !== undefined) mapped.PROMOTE_SOURCE = resolveBashPath(source);
    if (mapped.PROMOTE_BACKUP_PATH !== undefined) mapped.PROMOTE_BACKUP_PATH = resolveBashPath(join(root, basename(mapped.PROMOTE_BACKUP_PATH)));
    const envSource: Record<string, string | undefined> = { NODE_ENV: process.env.NODE_ENV ?? "test", DPF_PROMOTER_STATE_DIR: resolveBashPath(stateDir), ...mapped };
    const envAssignments = Object.entries(envSource).flatMap(([key, value]) => value === undefined ? [] : [`${key}=${quoteForBash(value)}`]);
    const command = ["env", "-i", 'PATH="$PATH"', ...envAssignments, "bash", quoteForBash(SCRIPT), "--self-upgrade", ...extraArgs.map(quoteForBash)].join(" ");
    return spawnSync(BASH_COMMAND, ["-lc", command], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe.skipIf(!BASH_AVAILABLE)("promote.sh --self-upgrade contract", () => {
  describe("required variables", () => {
    it("exits non-zero and names PROMOTE_SOURCE when missing", () => {
      const { PROMOTE_SOURCE: _omit, ...env } = BASE_ENV;
      const result = runScript(env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PROMOTE_SOURCE");
    });

    it("exits non-zero and names PROMOTE_TARGET_SHA when missing", () => {
      const { PROMOTE_TARGET_SHA: _omit, ...env } = BASE_ENV;
      const result = runScript(env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PROMOTE_TARGET_SHA");
    });

    it("exits non-zero and names PROMOTE_BACKUP_PATH when missing", () => {
      const { PROMOTE_BACKUP_PATH: _omit, ...env } = BASE_ENV;
      const result = runScript(env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PROMOTE_BACKUP_PATH");
    });

    it("exits non-zero and names PROMOTE_HEALTH_URL when missing", () => {
      const { PROMOTE_HEALTH_URL: _omit, ...env } = BASE_ENV;
      const result = runScript(env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PROMOTE_HEALTH_URL");
    });
  });

  describe("dry-run output", () => {
    it("exits zero when all required vars are present", () => {
      const result = runScript(BASE_ENV, ["--dry-run"]);
      expect(result.status).toBe(0);
    });

    it("redacts source path", () => {
      const result = runScript(
        { ...BASE_ENV, PROMOTE_SOURCE: "/internal/source-sentinel-xyz" },
        ["--dry-run"],
      );
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("source-sentinel-xyz");
    });

    it("redacts backup path", () => {
      const result = runScript(
        { ...BASE_ENV, PROMOTE_BACKUP_PATH: "/internal/backup-sentinel-xyz" },
        ["--dry-run"],
      );
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("backup-sentinel-xyz");
    });

    it("redacts health URL", () => {
      const result = runScript(
        { ...BASE_ENV, PROMOTE_HEALTH_URL: "http://internal/health?token=sentinel-token-xyz" },
        ["--dry-run"],
      );
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("sentinel-token-xyz");
    });

    it("includes target SHA unredacted", () => {
      const result = runScript(
        { ...BASE_ENV, PROMOTE_TARGET_SHA: "deadbeef12345678" },
        ["--dry-run"],
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("deadbeef12345678");
    });
  });

  describe("step order in dry-run", () => {
    const STEPS = [
      "step=prepare",
      "step=backup",
      "step=install-state-migrate",
      "step=docker-build",
      "step=migrate",
      "step=docker-up",
      "step=health",
      "step=sha-verify",
      "step=content-verify",
      "step=sandbox-refresh",
      "step=cleanup",
    ] as const;

    let dryRunResult: ReturnType<typeof runScript>;

    beforeAll(() => {
      dryRunResult = runScript(BASE_ENV, ["--dry-run"]);
    });

    it("exits zero", () => {
      expect(dryRunResult.status).toBe(0);
    });

    it("emits prepare step", () => {
      expect(dryRunResult.stdout).toContain("step=prepare");
    });

    it("emits backup step", () => {
      expect(dryRunResult.stdout).toContain("step=backup");
    });

    it("migrates install state only after the governed recovery copy and before swap work", () => {
      const scriptSource = readFileSync(join(REPO_ROOT, "scripts", "promote.sh"), "utf8");
      expect(dryRunResult.stdout).toContain("step=install-state-migrate");
      expect(scriptSource.indexOf('cp "$_install_state" "$_capability_recovery"')).toBeLessThan(
        scriptSource.indexOf('emit_step install-state-migrate'),
      );
      expect(scriptSource.indexOf('emit_step install-state-migrate')).toBeLessThan(
        scriptSource.indexOf('emit_step docker-build'),
      );
      expect(scriptSource).toContain('--expected-source-hash "$(_migration_field sourceHash)"');
      expect(scriptSource).toContain('--expected-projection-hash "$(_migration_field projectionHash)"');
      expect(scriptSource).toContain('--recovery-path "$_capability_recovery"');
    });

    it("provides deterministic post-migration build, swap, and health fault boundaries", () => {
      const source = readFileSync(join(REPO_ROOT, "scripts", "promote.sh"), "utf8");
      for (const stage of ["build", "swap", "health"]) expect(source).toContain(`DPF_PROMOTE_TEST_FAIL_AT:-}\" != \"${stage}`);
      expect(source).toContain("_restore_capability_snapshot");
    });

    it("emits docker-build step", () => {
      expect(dryRunResult.stdout).toContain("step=docker-build");
    });

    // BI-D9BAB4FA: migrations must run on the new image before the swap.
    it("emits migrate step", () => {
      expect(dryRunResult.stdout).toContain("step=migrate");
    });

    it("emits docker-up step", () => {
      expect(dryRunResult.stdout).toContain("step=docker-up");
    });

    it("emits health step", () => {
      expect(dryRunResult.stdout).toContain("step=health");
    });

    it("emits sha-verify step", () => {
      expect(dryRunResult.stdout).toContain("step=sha-verify");
    });

    it("emits content-verify step", () => {
      expect(dryRunResult.stdout).toContain("step=content-verify");
    });

    // BI-A8686CFC: the sandbox image must be rebuilt+recreated on every upgrade
    // too, or Dockerfile.sandbox improvements (opencode agent, TTS env) never
    // reach installed sandboxes and Build Studio builds break at the coding phase.
    it("emits sandbox-refresh step", () => {
      expect(dryRunResult.stdout).toContain("step=sandbox-refresh");
    });

    // Post-success disk hygiene: dangling portal images + build cache are swept
    // after all verifies pass, so upgrades stop piling up tens of GB of dead disk.
    it("emits cleanup step", () => {
      expect(dryRunResult.stdout).toContain("step=cleanup");
    });

    // sandbox-refresh runs AFTER the portal is fully verified (content-verify)
    // and BEFORE cleanup, so a sandbox failure never reverts a promoted portal
    // and cleanup still sweeps any dangling sandbox image last.
    it("steps appear in order: prepare → backup → docker-build → migrate → docker-up → health → sha-verify → content-verify → sandbox-refresh → cleanup", () => {
      const positions = STEPS.map((s) => dryRunResult.stdout.indexOf(s));
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });
  });
});
