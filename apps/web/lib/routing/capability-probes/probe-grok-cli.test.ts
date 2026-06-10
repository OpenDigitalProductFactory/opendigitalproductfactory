// apps/web/lib/routing/capability-probes/probe-grok-cli.test.ts
//
// Test-first spec for the grok CLI capability probe.
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

import { probeGrokCli } from "./probe-grok-cli";

describe("probeGrokCli", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it("throws when the grok binary is absent (preserves throw-on-missing routing contract)", async () => {
    mockExec.mockRejectedValueOnce(new Error("OCI runtime exec failed: grok: not found"));

    await expect(probeGrokCli()).rejects.toThrow(/grok/i);
  });

  it("throws when stdout has no parseable version", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "no version here\n", stderr: "" });

    await expect(probeGrokCli()).rejects.toThrow();
  });

  it("parses the version and returns the grok-cli profile when present", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "grok 1.2.3\n", stderr: "" });

    const profile = await probeGrokCli();

    expect(profile.adapterKind).toBe("grok-cli");
    expect(profile.adapterVersion).toBe("grok-cli/1.2.3");
    expect(profile.maxInteractiveLatencyMs).toBe(600_000);
    expect(profile.supportedAuthModes).toEqual(expect.arrayContaining(["api-key"]));
  });

  it("invokes docker exec against the sandbox container", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "grok 1.2.3\n", stderr: "" });

    await probeGrokCli();

    const cmd = mockExec.mock.calls[0]?.[0] as string;
    expect(cmd).toMatch(/docker exec/);
    expect(cmd).toMatch(/grok --version/);
  });
});
