import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync as _probe } from "node:child_process";
// Skip entire suite on environments where bash is unavailable (e.g. Alpine sandbox)
const BASH_AVAILABLE = _probe("bash", ["--version"], { encoding: "utf8" }).status === 0;
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../../../scripts/promote.sh");

const BASE_ENV: Record<string, string> = {
  PROMOTE_SOURCE: "/opt/app/release",
  PROMOTE_TARGET_SHA: "a1b2c3d4e5f6",
  PROMOTE_BACKUP_PATH: "/opt/app/backup",
  PROMOTE_HEALTH_URL: "http://localhost:3000/api/health",
};

function runScript(env: Record<string, string | undefined>, extraArgs: string[] = []) {
  return spawnSync("bash", [SCRIPT, "--self-upgrade", ...extraArgs], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: process.env.NODE_ENV ?? "test", ...env } as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
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
      "step=docker-build",
      "step=docker-up",
      "step=health",
      "step=sha-verify",
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

    it("emits docker-build step", () => {
      expect(dryRunResult.stdout).toContain("step=docker-build");
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

    it("steps appear in order: prepare → backup → docker-build → docker-up → health → sha-verify", () => {
      const positions = STEPS.map((s) => dryRunResult.stdout.indexOf(s));
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });
  });
});
