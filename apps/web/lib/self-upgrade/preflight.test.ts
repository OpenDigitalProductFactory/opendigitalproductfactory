import { describe, expect, it, vi } from "vitest";
import { signTransitionPayload } from "@/lib/platform-runtime/transition-protocol";
import { runCandidatePreflight } from "./preflight";

describe("candidate signed install-state handoff", () => {
  it("returns a digest-bound signed envelope from candidate readiness", async () => {
    const secret = "s".repeat(32);
    const artifact = { digest: `sha256:${"d".repeat(64)}`, contractSchema: 1, contractDigest: "c".repeat(64) } as never;
    const runtime = { buildCandidatePromoterImage: vi.fn(async () => "candidate"), resolvePromoterArtifact: vi.fn(async () => artifact), runPromoterReadiness: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ sourceHash: "a".repeat(64), projectionHash: "b".repeat(64), fromSchemaVersion: 1, toSchemaVersion: 2, migrationRequired: true }), stderr: "" })) };
    const result = await runCandidatePreflight({ sourcePath: "/source", hostInstallPath: "/host", canonicalInstallPath: "/host", targetSha: "target", runId: "SUR-1", composeFiles: [], healthUrl: "http://health", hostIdentity: { platform: "linux", arch: "arm64", provenance: "explicit" }, runtimeTransitionSecret: secret, now: () => new Date("2026-07-18T00:00:00Z"), runtime: async () => runtime as never, recordReadiness: vi.fn(), failRun: vi.fn(), emitFailure: vi.fn() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrationHandoff.envelope).toMatchObject({ runId: "SUR-1", promoterDigest: artifact.digest, hostIdentity: { platform: "linux", arch: "arm64", provenance: "explicit" } });
    expect(result.migrationHandoff.signature).toBe(signTransitionPayload(result.migrationHandoff.envelope, secret));
    expect(runtime.runPromoterReadiness).toHaveBeenCalledWith(expect.objectContaining({ hostIdentity: result.migrationHandoff.envelope.hostIdentity }));
  });

  it("refuses legacy bootstrap without a signed migration carrier", async () => {
    const failRun = vi.fn();
    const result = await runCandidatePreflight({ readinessMode: "legacy-bootstrap", readinessOwner: "bridge", sourcePath: "/source", hostInstallPath: "/host", canonicalInstallPath: "/host", targetSha: "target", runId: "SUR-legacy", composeFiles: [], healthUrl: "http://health", runtime: vi.fn(), recordReadiness: vi.fn(), failRun, emitFailure: vi.fn() });
    expect(result).toEqual({ ok: false, reason: "installer-state-repair-required" });
    expect(failRun).toHaveBeenCalledWith("SUR-legacy", expect.stringContaining("installer-state-repair-required"));
  });
});
