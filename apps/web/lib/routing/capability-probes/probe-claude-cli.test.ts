// apps/web/lib/routing/capability-probes/probe-claude-cli.test.ts
//
// Phase A5: Failing test for the claude-code CLI capability probe.
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A5)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1, §5.2

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

import { probeClaudeCli } from "./probe-claude-cli";

describe("probeClaudeCli", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it("parses '<version> (Claude Code)' stdout and returns the populated profile", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "1.5.0 (Claude Code)\n", stderr: "" });

    const profile = await probeClaudeCli();

    expect(profile.adapterKind).toBe("claude-code-cli");
    expect(profile.adapterVersion).toBe("claude-code/1.5.0");
    expect(profile.supportsSubagents).toBe(true);
    expect(profile.supportsMcpAttachPerInvoke).toBe(true);
    expect(profile.supportsHooks).toBe(true);
    expect(profile.supportsOutputSchema).toBe(false);
    expect(profile.maxInteractiveLatencyMs).toBe(600_000);
    expect(profile.supportedAuthModes).toEqual(expect.arrayContaining(["oauth", "api-key"]));
    expect(profile.knownDegradations).toBeNull();
  });

  it("parses 'claude-code/X.Y.Z' style stdout via the version regex", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "claude-code/2.0.7\n", stderr: "" });

    const profile = await probeClaudeCli();

    expect(profile.adapterVersion).toBe("claude-code/2.0.7");
  });

  it("invokes docker exec against the sandbox container", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "1.0.0 (Claude Code)\n", stderr: "" });

    await probeClaudeCli();

    const cmd = mockExec.mock.calls[0]?.[0] as string;
    expect(cmd).toMatch(/docker exec/);
    expect(cmd).toMatch(/claude --version/);
  });

  it("throws when docker exec fails (does NOT return a stub)", async () => {
    mockExec.mockRejectedValueOnce(new Error("No such container: dpf-sandbox-1"));

    await expect(probeClaudeCli()).rejects.toThrow(/claude/i);
  });

  it("throws when stdout has no parseable version", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "garbage output\n", stderr: "" });

    await expect(probeClaudeCli()).rejects.toThrow();
  });
});
