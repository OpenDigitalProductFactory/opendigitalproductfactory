// apps/web/lib/routing/capability-probes/probe-codex-cli.test.ts
//
// Phase A5: Failing test for the codex CLI capability probe.
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A5)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1, §5.2
// Evidence: docs/superpowers/audits/evidence/2026-04-29-codex-jsonl-probe.md

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

import { probeCodexCli } from "./probe-codex-cli";

describe("probeCodexCli", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it("parses 'codex-cli X.Y.Z' stdout and returns the populated profile", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "codex-cli 0.125.0\n", stderr: "" });

    const profile = await probeCodexCli();

    expect(profile.adapterKind).toBe("codex-cli");
    expect(profile.adapterVersion).toBe("codex-cli/0.125.0");
    // Per audit Q1: Codex configures MCP statically — not per-invoke like Claude.
    expect(profile.supportsMcpAttach).toBe(true);
    expect(profile.supportsMcpAttachPerInvoke).toBe(false);
    // Codex has no Task-tool subagents and no hooks model.
    expect(profile.supportsSubagents).toBe(false);
    expect(profile.supportsHooks).toBe(false);
    // Codex DOES expose --output-schema (gpt-5 family).
    expect(profile.supportsOutputSchema).toBe(true);
    expect(profile.supportsExtendedThinking).toBe(true);
    expect(profile.supportsSessionResume).toBe(true);
    expect(profile.maxInteractiveLatencyMs).toBe(180_000);
    expect(profile.supportedAuthModes).toEqual(expect.arrayContaining(["oauth", "api-key"]));
  });

  it("carries knownDegradations for the --json+MCP silent failure (issue 15451)", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "codex-cli 0.125.0\n", stderr: "" });

    const profile = await probeCodexCli();

    expect(Array.isArray(profile.knownDegradations)).toBe(true);
    const degradations = profile.knownDegradations as Array<{
      trigger: string;
      behavior: string;
      source: string;
    }>;

    const mcpEntry = degradations.find((d) => /MCP/.test(d.trigger));
    expect(mcpEntry).toBeDefined();
    expect(mcpEntry?.source).toMatch(/15451/);
    expect(mcpEntry?.behavior).toMatch(/stream|silent|drop/i);

    // Schema-rename pattern (issue 4776)
    const schemaEntry = degradations.find((d) => /rename|schema/i.test(d.trigger));
    expect(schemaEntry).toBeDefined();
    expect(schemaEntry?.source).toMatch(/4776/);
  });

  it("invokes docker exec against the sandbox container", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "codex-cli 0.125.0\n", stderr: "" });

    await probeCodexCli();

    const cmd = mockExec.mock.calls[0]?.[0] as string;
    expect(cmd).toMatch(/docker exec/);
    expect(cmd).toMatch(/codex --version/);
  });

  it("throws when docker exec fails (does NOT return a stub)", async () => {
    mockExec.mockRejectedValueOnce(new Error("docker daemon not reachable"));

    await expect(probeCodexCli()).rejects.toThrow(/codex/i);
  });

  it("throws when stdout has no parseable version", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "no version here\n", stderr: "" });

    await expect(probeCodexCli()).rejects.toThrow();
  });
});
