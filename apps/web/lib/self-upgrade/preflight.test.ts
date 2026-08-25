import { describe, expect, it, vi } from "vitest";
import { signTransitionPayload } from "@/lib/platform-runtime/transition-protocol";
import { resolveReadinessBackupHostPath, runCandidatePreflight } from "./preflight";

describe("candidate signed install-state handoff", () => {
  it("resolves a published release promoter without attempting a source build", async () => {
    const secret = "s".repeat(32);
    const release = {
      tag: "v2026.08.24-consumer-self-upgrade.4",
      ghcrOwner: "owner",
      channelDigest: `sha256:${"a".repeat(64)}`,
      platformManifestDigest: `sha256:${"b".repeat(64)}`,
      configDigest: `sha256:${"c".repeat(64)}`,
      platformOs: "linux" as const,
      platformArchitecture: "amd64",
    };
    const artifact = { digest: `sha256:${"d".repeat(64)}`, contractSchema: 1, contractDigest: "c".repeat(64) } as never;
    const runtime = { buildCandidatePromoterImage: vi.fn(), resolvePromoterArtifact: vi.fn(async () => artifact), runPromoterReadiness: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ sourceHash: "a".repeat(64), projectionHash: "b".repeat(64), fromSchemaVersion: 2, toSchemaVersion: 2 }), stderr: "" })) };
    const result = await runCandidatePreflight({ candidatePromoterReference: "ghcr.io/owner/dpf-promoter:v2.0.0", release, sourcePath: "/source-free-install", hostInstallPath: "/host", canonicalInstallPath: "/host", targetSha: "b".repeat(40), runId: "SUR-release", composeFiles: [], healthUrl: "http://health", hostIdentity: { platform: "linux", arch: "amd64", provenance: "install-state" }, runtimeTransitionSecret: secret, runtime: async () => runtime as never, recordReadiness: vi.fn(), failRun: vi.fn(), emitFailure: vi.fn() });
    expect(result.ok).toBe(true);
    expect(runtime.buildCandidatePromoterImage).not.toHaveBeenCalled();
    expect(runtime.resolvePromoterArtifact).toHaveBeenCalledWith(expect.objectContaining({ promoterImage: "ghcr.io/owner/dpf-promoter:v2.0.0", candidateReference: "ghcr.io/owner/dpf-promoter:v2.0.0", targetSha: "b".repeat(40) }));
    expect(runtime.runPromoterReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ release }),
    );
  });

  it("returns a digest-bound signed envelope from candidate readiness", async () => {
    const secret = "s".repeat(32);
    const artifact = { digest: `sha256:${"d".repeat(64)}`, contractSchema: 1, contractDigest: "c".repeat(64) } as never;
    const runtime = { buildCandidatePromoterImage: vi.fn(async () => "candidate"), resolvePromoterArtifact: vi.fn(async () => artifact), runPromoterReadiness: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ sourceHash: "a".repeat(64), projectionHash: "b".repeat(64), fromSchemaVersion: 1, toSchemaVersion: 2, migrationRequired: true }), stderr: "" })) };
    const result = await runCandidatePreflight({ sourcePath: "/source", hostInstallPath: "/host", canonicalInstallPath: "/host", targetSha: "target", runId: "SUR-1", composeFiles: [], healthUrl: "http://health", hostIdentity: { platform: "linux", arch: "arm64", provenance: "explicit" }, runtimeTransitionSecret: secret, now: () => new Date("2026-07-18T00:00:00Z"), runtime: async () => runtime as never, recordReadiness: vi.fn(), failRun: vi.fn(), emitFailure: vi.fn() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const migrationHandoff = result.migrationHandoff;
    expect(migrationHandoff).toBeDefined();
    if (!migrationHandoff) throw new Error("expected signed install-state migration handoff");
    expect(migrationHandoff.envelope).toMatchObject({ runId: "SUR-1", promoterDigest: `sha256:${"d".repeat(64)}`, hostIdentity: { platform: "linux", arch: "arm64", provenance: "explicit" } });
    expect(migrationHandoff.signature).toBe(signTransitionPayload(migrationHandoff.envelope, secret));
    expect(runtime.runPromoterReadiness).toHaveBeenCalledWith(expect.objectContaining({ hostIdentity: migrationHandoff.envelope.hostIdentity }));
  });

  it("refuses legacy bootstrap without a signed migration carrier", async () => {
    const failRun = vi.fn();
    const result = await runCandidatePreflight({ readinessMode: "legacy-bootstrap", readinessOwner: "bridge", sourcePath: "/source", hostInstallPath: "/host", canonicalInstallPath: "/host", targetSha: "target", runId: "SUR-legacy", composeFiles: [], healthUrl: "http://health", runtime: vi.fn(), recordReadiness: vi.fn(), failRun, emitFailure: vi.fn() });
    expect(result).toEqual({ ok: false, reason: "installer-state-repair-required" });
    expect(failRun).toHaveBeenCalledWith("SUR-legacy", expect.stringContaining("installer-state-repair-required"));
  });
});

describe("resolveReadinessBackupHostPath (BI-E2625B79)", () => {
  it("uses an explicit DPF_BACKUPS_HOST_PATH when set", () => {
    expect(resolveReadinessBackupHostPath("/vol/backups", "/opt/dpf")).toBe("/vol/backups");
  });

  it("falls back to <install>/backups when the env var is EMPTY (the documented compose default)", () => {
    // .env ships DPF_BACKUPS_HOST_PATH= empty by design; a plain `?? undefined`
    // leaks "" through and skips the /backups mount -> recovery_parent_unavailable.
    expect(resolveReadinessBackupHostPath("", "/opt/dpf")).toBe("/opt/dpf/backups");
  });

  it("falls back to <install>/backups when the env var is unset", () => {
    expect(resolveReadinessBackupHostPath(undefined, "/opt/dpf")).toBe("/opt/dpf/backups");
  });

  it("treats whitespace-only as unset and strips a trailing slash from the install path", () => {
    expect(resolveReadinessBackupHostPath("   ", "/opt/dpf/")).toBe("/opt/dpf/backups");
  });
});
