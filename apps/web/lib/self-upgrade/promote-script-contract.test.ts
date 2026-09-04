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

// BI-72AEDE8B: under full Windows local-CI load, every resolveBashPath used to
// spawn up to three `bash -lc test -f` probes — and used -f even for temp
// *directories*, so all probes failed and still cost ~0.5–2s each. Cache the
// first successful Git-Bash path style per drive, prefer `test -e`, and skip
// probing for paths that do not exist on the Windows side yet.
const bashPathCache = new Map<string, string>();
/** Once known: which candidate prefix works for drive-letter paths on this host. */
let preferredWinBashDriveForm: "mnt" | "root" | "normalized" | null = null;

function resolveBashPath(path: string) {
  if (process.platform !== "win32") {
    return path;
  }

  const cached = bashPathCache.get(path);
  if (cached) return cached;

  const normalized = path.replace(/\\/g, "/");
  const driveMatch = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!driveMatch) {
    bashPathCache.set(path, normalized);
    return normalized;
  }

  const [, drive, rest] = driveMatch;
  const byForm = {
    mnt: `/mnt/${drive.toLowerCase()}/${rest}`,
    root: `/${drive.toLowerCase()}/${rest}`,
    normalized,
  } as const;

  // Nothing on disk yet (e.g. backup dir before promote creates it) — do not pay
  // for three failing bash probes; Git Bash accepts /d/... style for new paths.
  if (!existsSync(path)) {
    const guess = preferredWinBashDriveForm
      ? byForm[preferredWinBashDriveForm]
      : byForm.root;
    bashPathCache.set(path, guess);
    return guess;
  }

  const order: Array<keyof typeof byForm> = preferredWinBashDriveForm
    ? [preferredWinBashDriveForm, "mnt", "root", "normalized"]
    : ["mnt", "root", "normalized"];
  const seen = new Set<string>();
  for (const form of order) {
    const candidate = byForm[form];
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const probe = _probe(BASH_COMMAND, ["-lc", `test -e ${quoteForBash(candidate)}`], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (probe.status === 0) {
      preferredWinBashDriveForm = form;
      bashPathCache.set(path, candidate);
      return candidate;
    }
  }

  bashPathCache.set(path, normalized);
  return normalized;
}

const SCRIPT = resolveBashPath(resolve(__dirname, "../../../../scripts/promote.sh"));
const REPO_ROOT = resolve(__dirname, "../../../..");

it("verifies the signed install-state handoff before reading the promotion projection", () => {
  const source = readFileSync(join(REPO_ROOT, "scripts", "promote.sh"), "utf8");
  // The handoff is resolved by the promoter-only entrypoint (BI-76651B7B); the
  // signing primitives stay in lib/transition-signing.mjs, which the portal
  // bundles and therefore must not reach promoter-only code.
  expect(source.indexOf('promoter-migration-envelope.mjs')).toBeGreaterThan(0);
  expect(source.indexOf('promoter-migration-envelope.mjs')).toBeLessThan(source.indexOf('_capability_projection='));
});

it("projects legacy install state through valid dynamic ESM before readiness", () => {
  const source = readFileSync(join(REPO_ROOT, "scripts", "promote.sh"), "utf8");
  expect(source.match(/--overlay promote --migrate/g)).toHaveLength(2);
  // Dynamic import, and via a file:// URL — a bare absolute path is not a legal ESM
  // specifier on Windows, which silently sank the whole readiness projection there.
  expect(source).toContain('await import(pathToFileURL(process.env.PROMOTER_DIR + "/installer/migrate-install-state.mjs").href)');
  expect(source).not.toContain('from process.env.PROMOTER_DIR');
});

const BASE_ENV: Record<string, string> = {
  PROMOTE_SOURCE: "/opt/app/release",
  PROMOTE_TARGET_SHA: "a1b2c3d4e5f6",
  PROMOTE_BACKUP_PATH: "/opt/app/backup",
  PROMOTE_HEALTH_URL: "http://localhost:3000/api/health",
};
/**
 * Child wall-clock for a single promote.sh invocation under contract tests.
 * BI-72AEDE8B: must stay below the Vitest per-test timeout so a hung bash is
 * reported as a timed-out child (signal/error), not a silent suite stall.
 * Not a global vitest.config timeout change.
 */
const CONTRACT_CHILD_TIMEOUT_MS = 25_000;
/** Vitest per-test budget: child bound + fixture overhead on loaded Windows hosts. */
const CONTRACT_TEST_TIMEOUT_MS = 40_000;
/** @deprecated alias kept for readiness describe block readability */
const READINESS_SCRIPT_TIMEOUT_MS = CONTRACT_TEST_TIMEOUT_MS;

function runScript(
  env: Record<string, string | undefined>,
  extraArgs: string[] = [],
  stateOverrides: Record<string, unknown> = {},
  options: {
    recoveryPathMode?: "canonical-missing-parent" | "outside-recovery-root";
    sourceProfileAdapter?: boolean;
  } = {},
) {
  const marker = basename(env.PROMOTE_SOURCE ?? "source").replace(/[^A-Za-z0-9-]/g, "-");
  const root = mkdtempSync(join(tmpdir(), `dpf-promote-contract-${marker}-`));
  try {
    const source = join(root, marker);
    const stateDir = join(root, "state");
    mkdirSync(join(source, "scripts", "lib"), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    if (options.sourceProfileAdapter !== false) {
      copyFileSync(join(REPO_ROOT, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), join(source, "scripts", "lib", "resolve-capability-compose-profiles.mjs"));
    }
    copyFileSync(join(REPO_ROOT, "scripts", "lib", "govern-capability-compose-args.mjs"), join(source, "scripts", "lib", "govern-capability-compose-args.mjs"));
    copyFileSync(join(REPO_ROOT, "scripts", "lib", "capability-state-hash.mjs"), join(source, "scripts", "lib", "capability-state-hash.mjs"));
    copyFileSync(join(REPO_ROOT, "scripts", "capability-service-catalog.generated.json"), join(source, "scripts", "capability-service-catalog.generated.json"));
    const catalog = JSON.parse(readFileSync(join(REPO_ROOT, "scripts", "capability-service-catalog.generated.json"), "utf8")) as { catalogHash: string; capabilities: Array<{ capabilityId: string }> };
    const enabledRuntimeCapabilities = ["runtime:core"];
    const stateLines = catalog.capabilities.map(({ capabilityId }) => `${capabilityId}=${enabledRuntimeCapabilities.includes(capabilityId) ? "active" : "disabled"}`).sort().join("\n");
    const capabilityStateVersion = createHash("sha256").update(`${catalog.catalogHash}\n${stateLines}`).digest("hex");
    writeFileSync(join(stateDir, "install-state.json"), JSON.stringify({ platform: "linux", enabledRuntimeCapabilities, capabilityCatalogHash: catalog.catalogHash, capabilityStateVersion, ...stateOverrides }));

    const mapped = { ...env };
    if (mapped.PROMOTE_SOURCE !== undefined) mapped.PROMOTE_SOURCE = resolveBashPath(source);
    if (mapped.PROMOTE_BACKUP_PATH !== undefined) {
      if (options.recoveryPathMode) {
        const recoveryRoot = join(root, "backups");
        mkdirSync(recoveryRoot, { recursive: true });
        mapped.DPF_PROMOTER_RECOVERY_ROOT = resolveBashPath(recoveryRoot);
        mapped.PROMOTE_BACKUP_PATH = resolveBashPath(join(
          options.recoveryPathMode === "canonical-missing-parent" ? recoveryRoot : root,
          "self-upgrade",
          "SUR-contract",
        ));
      } else {
        mapped.PROMOTE_BACKUP_PATH = resolveBashPath(join(root, basename(mapped.PROMOTE_BACKUP_PATH)));
      }
    }
    const envSource: Record<string, string | undefined> = { NODE_ENV: process.env.NODE_ENV ?? "test", DPF_PROMOTER_STATE_DIR: resolveBashPath(stateDir), ...mapped };
    const envAssignments = Object.entries(envSource).flatMap(([key, value]) => value === undefined ? [] : [`${key}=${quoteForBash(value)}`]);
    const command = ["env", "-i", 'PATH="$PATH"', ...envAssignments, "bash", quoteForBash(SCRIPT), "--self-upgrade", ...extraArgs.map(quoteForBash)].join(" ");
    return spawnSync(BASH_COMMAND, ["-lc", command], {
      encoding: "utf8",
      // Kill hung promote.sh; vitest timeout is higher so we can assert on signal.
      timeout: CONTRACT_CHILD_TIMEOUT_MS,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertChildDidNotTimeOut(result: ReturnType<typeof spawnSync>, label: string) {
  const timedOut =
    result.signal === "SIGTERM"
    || result.error?.message?.includes("ETIMEDOUT")
    || (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  expect(timedOut, `${label}: promote child hit CONTRACT_CHILD_TIMEOUT_MS (${CONTRACT_CHILD_TIMEOUT_MS}ms) — hung promoter, not slow host budget`).toBe(false);
}

// BI-D47955AF. The promoter is candidate-owned but launched by the DEPLOYED portal, so an
// N-1 caller (any portal built before the host-identity contract landed) sends no DPF_HOST_*
// env and never can. Readiness must derive identity from the install-state it already mounts
// — demanding it from the caller wedges every pre-existing install, because the upgrade that
// teaches the caller to send it IS the blocked upgrade.
describe.skipIf(!BASH_AVAILABLE)("promote.sh --readiness host identity", () => {
  it("projects release-artifact capability state from the immutable promoter when the consumer install has no source adapter", () => {
    const result = runScript(
      { ...BASE_ENV, DPF_PROMOTION_MODE: "release" },
      ["--readiness"],
      { platform: "linux", arch: "amd64" },
      { sourceProfileAdapter: false },
    );
    expect(result.stdout).not.toContain("capability_projection_failed");
  }, READINESS_SCRIPT_TIMEOUT_MS);

  it("still fails closed when source-backed readiness has no candidate source adapter", () => {
    const result = runScript(
      BASE_ENV,
      ["--readiness"],
      { platform: "linux", arch: "amd64" },
      { sourceProfileAdapter: false },
    );
    expect(result.stdout).toContain("capability_projection_failed");
    expect(result.stdout).toContain("candidate source has no profile adapter");
  }, READINESS_SCRIPT_TIMEOUT_MS);

  it("accepts a run-specific recovery path whose canonical mounted root exists", () => {
    const result = runScript(
      BASE_ENV,
      ["--readiness"],
      { platform: "linux", arch: "amd64" },
      { recoveryPathMode: "canonical-missing-parent" },
    );
    expect(result.stdout).not.toContain("recovery_parent_unavailable");
  }, READINESS_SCRIPT_TIMEOUT_MS);

  it("still rejects a missing recovery parent outside the canonical mounted root", () => {
    const result = runScript(
      BASE_ENV,
      ["--readiness"],
      { platform: "linux", arch: "amd64" },
      { recoveryPathMode: "outside-recovery-root" },
    );
    expect(result.stdout).toContain("recovery_parent_unavailable");
  }, READINESS_SCRIPT_TIMEOUT_MS);

  it("resolves installer-owned identity when the N-1 caller sends no DPF_HOST_* env", () => {
    const result = runScript(BASE_ENV, ["--readiness"], { platform: "linux", arch: "amd64" });
    expect(result.stdout).toContain('"stage":"preflight"');
    expect(result.stdout).not.toContain("host_identity_missing");
  }, READINESS_SCRIPT_TIMEOUT_MS);

  it("fails closed when install-state carries no resolvable identity", () => {
    const result = runScript(BASE_ENV, ["--readiness"], { platform: "unsupported", arch: "unknown" });
    expect(result.stdout).toContain("host_identity_missing");
  }, READINESS_SCRIPT_TIMEOUT_MS);
});

describe.skipIf(!BASH_AVAILABLE)("promote contract child timeout boundary (BI-72AEDE8B)", () => {
  it("kills a hung bash child well under the vitest wall clock", () => {
    const started = Date.now();
    const result = spawnSync(BASH_COMMAND, ["-lc", "sleep 120"], {
      encoding: "utf8",
      timeout: 1_500,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(10_000);
    const timedOut =
      result.signal === "SIGTERM"
      || result.error?.message?.includes("ETIMEDOUT")
      || (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    expect(timedOut).toBe(true);
  }, 15_000);
});

describe.skipIf(!BASH_AVAILABLE)("promote.sh --self-upgrade contract", () => {
  describe("required variables", () => {
    it("exits non-zero and names PROMOTE_SOURCE when missing", () => {
      const { PROMOTE_SOURCE: _omit, ...env } = BASE_ENV;
      const result = runScript(env);
      assertChildDidNotTimeOut(result, "missing PROMOTE_SOURCE");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PROMOTE_SOURCE");
    }, CONTRACT_TEST_TIMEOUT_MS);

    it("exits non-zero and names PROMOTE_TARGET_SHA when missing", () => {
      const { PROMOTE_TARGET_SHA: _omit, ...env } = BASE_ENV;
      const result = runScript(env);
      assertChildDidNotTimeOut(result, "missing PROMOTE_TARGET_SHA");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PROMOTE_TARGET_SHA");
    }, CONTRACT_TEST_TIMEOUT_MS);

    it("exits non-zero and names PROMOTE_BACKUP_PATH when missing", () => {
      const { PROMOTE_BACKUP_PATH: _omit, ...env } = BASE_ENV;
      const result = runScript(env);
      assertChildDidNotTimeOut(result, "missing PROMOTE_BACKUP_PATH");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PROMOTE_BACKUP_PATH");
    }, CONTRACT_TEST_TIMEOUT_MS);

    it("exits non-zero and names PROMOTE_HEALTH_URL when missing", () => {
      const { PROMOTE_HEALTH_URL: _omit, ...env } = BASE_ENV;
      const result = runScript(env);
      assertChildDidNotTimeOut(result, "missing PROMOTE_HEALTH_URL");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PROMOTE_HEALTH_URL");
    }, CONTRACT_TEST_TIMEOUT_MS);
  });

  describe("dry-run output", () => {
    it("exits zero when all required vars are present", () => {
      const result = runScript(BASE_ENV, ["--dry-run"]);
      assertChildDidNotTimeOut(result, "dry-run success");
      expect(result.status).toBe(0);
    }, CONTRACT_TEST_TIMEOUT_MS);

    it("redacts source path", () => {
      const result = runScript(
        { ...BASE_ENV, PROMOTE_SOURCE: "/internal/source-sentinel-xyz" },
        ["--dry-run"],
      );
      assertChildDidNotTimeOut(result, "redact source");
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("source-sentinel-xyz");
    }, CONTRACT_TEST_TIMEOUT_MS);

    it("redacts backup path", () => {
      const result = runScript(
        { ...BASE_ENV, PROMOTE_BACKUP_PATH: "/internal/backup-sentinel-xyz" },
        ["--dry-run"],
      );
      assertChildDidNotTimeOut(result, "redact backup");
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("backup-sentinel-xyz");
    }, CONTRACT_TEST_TIMEOUT_MS);

    it("redacts health URL", () => {
      const result = runScript(
        { ...BASE_ENV, PROMOTE_HEALTH_URL: "http://internal/health?token=sentinel-token-xyz" },
        ["--dry-run"],
      );
      assertChildDidNotTimeOut(result, "redact health");
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("sentinel-token-xyz");
    }, CONTRACT_TEST_TIMEOUT_MS);

    it("includes target SHA unredacted", () => {
      const result = runScript(
        { ...BASE_ENV, PROMOTE_TARGET_SHA: "deadbeef12345678" },
        ["--dry-run"],
      );
      assertChildDidNotTimeOut(result, "sha unredacted");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("deadbeef12345678");
    }, CONTRACT_TEST_TIMEOUT_MS);
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
      assertChildDidNotTimeOut(dryRunResult, "beforeAll dry-run");
    }, CONTRACT_TEST_TIMEOUT_MS);

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

    it("keeps rollback fault injection outside the privileged production promoter", () => {
      const source = readFileSync(join(REPO_ROOT, "scripts", "promote.sh"), "utf8");
      expect(source).toContain("_restore_capability_snapshot");
      expect(source).not.toContain("DPF_PROMOTE_TEST_FAIL_AT");
      expect(source).not.toContain("DPF_PROMOTE_TEST_EVENT_LOG");
      const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/self-upgrade-acceptance.yml"), "utf8");
      expect(workflow).toContain("node --test scripts/promote-install-state-rollback.test.mjs");
      expect(workflow).toContain("signed-promotion-rollback.tap");
    });

    it("emits docker-build step", () => {
      expect(dryRunResult.stdout).toContain("step=docker-build");
    });

    // BI-D9BAB4FA: migrations must run on the new image before the swap.
    it("emits migrate step", () => {
      expect(dryRunResult.stdout).toContain("step=migrate");
    });

    it("guards the known inventory snapshot failure before normal migration deploy", () => {
      const scriptSource = readFileSync(join(REPO_ROOT, "scripts", "promote.sh"), "utf8");
      const recoveryCommand =
        "node packages/db/scripts/recover-inventory-snapshot-migration.mjs";
      const resolveCommand =
        "prisma migrate resolve --rolled-back 20260728115900_snapshot_inventory_observation_facts";
      const verifyCommand =
        "recover-inventory-snapshot-migration.mjs --verify-rolled-back";
      const deployCommand =
        "-c 'cd /app && pnpm --filter @dpf/db exec prisma migrate deploy'";

      expect(scriptSource).toContain(recoveryCommand);
      expect(scriptSource).toContain(resolveCommand);
      expect(scriptSource.indexOf(recoveryCommand)).toBeLessThan(
        scriptSource.indexOf(resolveCommand),
      );
      expect(scriptSource.indexOf(resolveCommand)).toBeLessThan(
        scriptSource.indexOf(verifyCommand),
      );
      expect(scriptSource.indexOf(verifyCommand)).toBeLessThan(
        scriptSource.indexOf(deployCommand),
      );
      expect(scriptSource).not.toContain(`${resolveCommand}' >/dev/null 2>&1 || true`);
      expect(scriptSource).not.toContain(`${verifyCommand}' || true`);
    });

    it("guards the exact human-principal alias collision before normal migration deploy", () => {
      const scriptSource = readFileSync(join(REPO_ROOT, "scripts", "promote.sh"), "utf8");
      const recoveryCommand =
        "node packages/db/scripts/recover-human-principal-backfill-migration.mjs";
      const resolveCommand =
        "prisma migrate resolve --rolled-back 20260812110000_backfill_missing_human_principals";
      const verifyCommand =
        "recover-human-principal-backfill-migration.mjs --verify-rolled-back";
      const deployCommand =
        "-c 'cd /app && pnpm --filter @dpf/db exec prisma migrate deploy'";

      expect(scriptSource).toContain(recoveryCommand);
      expect(scriptSource).toContain(resolveCommand);
      expect(scriptSource.indexOf(recoveryCommand)).toBeLessThan(
        scriptSource.indexOf(resolveCommand),
      );
      expect(scriptSource.indexOf(resolveCommand)).toBeLessThan(
        scriptSource.indexOf(verifyCommand),
      );
      expect(scriptSource.indexOf(verifyCommand)).toBeLessThan(
        scriptSource.indexOf(deployCommand),
      );
      expect(scriptSource).not.toContain(`${resolveCommand}' >/dev/null 2>&1 || true`);
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
