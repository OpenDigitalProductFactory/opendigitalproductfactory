// apps/web/lib/routing/capability-probes/probe-engine-readiness.test.ts
//
// Test-first spec for the non-throwing engine readiness probe.
// Spec: docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md (Phase 1a, slice B)

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockExec = vi.fn();
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: () => ({
    exec: (
      cmd: string,
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const result = mockExec(cmd);
      if (result instanceof Promise) {
        result
          .then((resolved: { stdout: string; stderr: string }) => cb(null, resolved))
          .catch((err: Error) => cb(err, { stdout: "", stderr: "" }));
      } else {
        cb(new Error("mockExec must return a Promise"), { stdout: "", stderr: "" });
      }
    },
  }),
  lazyUtil: () => ({
    promisify:
      (fn: Function) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, result: unknown) => {
            if (err) reject(err);
            else resolve(result);
          });
        }),
  }),
}));

import { probeEngineReadiness, type EngineProbeConfig } from "./probe-engine-readiness";
import { extractEngineVersion } from "./engine-version-parser";

const GROK: EngineProbeConfig = {
  engineId: "grok",
  binary: "grok",
  verifyCommand: "grok --version",
  versionRegex: /(\d+\.\d+\.\d+)/,
};

const CLAUDE_WITH_STALE_REGISTRY_REGEX: EngineProbeConfig = {
  engineId: "claude",
  binary: "claude",
  verifyCommand: "claude --version",
  versionRegex: "claude[- ]cli[/ ]([0-9.]+)",
};

describe("probeEngineReadiness", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it("returns present=false WITHOUT throwing when the binary is absent (docker exec rejects)", async () => {
    mockExec.mockRejectedValueOnce(new Error("OCI runtime exec failed: grok: executable file not found"));

    const result = await probeEngineReadiness(GROK);

    expect(result.present).toBe(false);
    expect(result.version).toBeNull();
    expect(result.engineId).toBe("grok");
    expect(result.error).toBeTruthy();
    expect(typeof result.probedAt).toBe("string");
  });

  it("returns present=true with the parsed version when the binary responds", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "grok 1.2.3\n", stderr: "" });

    const result = await probeEngineReadiness(GROK);

    expect(result.present).toBe(true);
    expect(result.version).toBe("1.2.3");
    expect(result.error).toBeUndefined();
  });

  it("returns present=false with an error when stdout has no parseable version (does NOT throw)", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "no version here\n", stderr: "" });

    const result = await probeEngineReadiness(GROK);

    expect(result.present).toBe(false);
    expect(result.version).toBeNull();
    expect(result.error).toMatch(/parse/i);
  });

  it("runs docker exec against the sandbox with the engine's verify command", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "grok 1.2.3\n", stderr: "" });

    await probeEngineReadiness(GROK);

    const cmd = mockExec.mock.calls[0]?.[0] as string;
    expect(cmd).toMatch(/docker exec/);
    expect(cmd).toMatch(/grok --version/);
  });

  it("accepts a string versionRegex", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "v0.4.1\n", stderr: "" });

    const result = await probeEngineReadiness({ ...GROK, versionRegex: "([0-9.]+)" });

    expect(result.present).toBe(true);
    expect(result.version).toBe("0.4.1");
  });

  it("recognizes current Claude Code stdout even when the persisted registry regex is stale", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "2.1.215 (Claude Code)\n", stderr: "" });

    const result = await probeEngineReadiness(CLAUDE_WITH_STALE_REGISTRY_REGEX);

    expect(result.present).toBe(true);
    expect(result.version).toBe("2.1.215");
    expect(result.error).toBeUndefined();
  });

  it("keeps malformed Claude stdout unparseable", () => {
    expect(
      extractEngineVersion(CLAUDE_WITH_STALE_REGISTRY_REGEX, "Claude Code\n"),
    ).toBeNull();
  });
});
