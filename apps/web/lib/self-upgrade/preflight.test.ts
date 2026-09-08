import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { signTransitionPayload } from "@/lib/platform-runtime/transition-protocol";
import { refreshMigrationHandoffAfterDrain, resolveReadinessBackupHostPath, runCandidatePreflight, type InstallStateMigrationHandoff } from "./preflight";

const fsMocks = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: fsMocks.readFile }));

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

describe("refreshMigrationHandoffAfterDrain (BI-95DF1BFC)", () => {
  const secret = "s".repeat(32);
  const digest = `sha256:${"d".repeat(64)}`;
  const hostIdentity = { platform: "linux" as const, arch: "amd64" as const, provenance: "explicit" as const };
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const handoffFor = (stateText: string, runId = "SUR-1"): InstallStateMigrationHandoff => {
    const now = new Date();
    const envelope: InstallStateMigrationHandoff["envelope"] = {
      version: 1 as const, kind: "install-state-migration" as const, runId,
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      sourceHash: sha(stateText), projectionHash: sha(stateText), fromSchemaVersion: 2, toSchemaVersion: 2,
      hostIdentity, promoterDigest: digest,
    };
    return { envelope, signature: signTransitionPayload(envelope, secret) };
  };
  const base = () => ({ runId: "SUR-1", resolvedPromoterDigest: digest, runtimeTransitionSecret: secret, hostIdentity, failRun: vi.fn(), emitFailure: vi.fn() });

  it("keeps the readiness handoff when the install-state did not move", async () => {
    const state = '{"schemaVersion":2}';
    fsMocks.readFile.mockResolvedValue(state);
    const migrationHandoff = handoffFor(state);
    const rerunPreflight = vi.fn();
    const result = await refreshMigrationHandoffAfterDrain({ ...base(), migrationHandoff, rerunPreflight });
    expect(result).toMatchObject({ ok: true, refreshed: false, migrationHandoff, resolvedPromoterDigest: digest });
    expect(rerunPreflight).not.toHaveBeenCalled();
  });

  it("re-runs readiness and carries the fresh handoff when a host-side writer moved the state during the drain", async () => {
    // SUR-4758058F: the agent-toolchain bootstrap rewrote install-state.json
    // three minutes into the drain; promote.sh then refused the stale envelope.
    const before = '{"schemaVersion":2}';
    const after = '{"schemaVersion":2,"agentToolchain":{"appliedAt":"2026-09-08T22:22:43Z"}}';
    fsMocks.readFile.mockResolvedValue(after);
    const stale = handoffFor(before);
    const fresh = handoffFor(after);
    const rerunPreflight = vi.fn(async () => ({ ok: true as const, resolvedPromoterDigest: digest, migrationHandoff: fresh }));
    const params = base();
    const result = await refreshMigrationHandoffAfterDrain({ ...params, migrationHandoff: stale, rerunPreflight });
    expect(result).toMatchObject({ ok: true, refreshed: true, code: "install_state_envelope_state_changed", migrationHandoff: fresh });
    expect(rerunPreflight).toHaveBeenCalledTimes(1);
    expect(params.failRun).not.toHaveBeenCalled();
  });

  it("re-runs readiness when the drain outlived the envelope TTL", async () => {
    const state = '{"schemaVersion":2}';
    fsMocks.readFile.mockResolvedValue(state);
    const expired = handoffFor(state);
    expired.envelope.expiresAt = new Date(Date.now() - 1_000).toISOString();
    expired.signature = signTransitionPayload(expired.envelope, secret);
    const fresh = handoffFor(state);
    const rerunPreflight = vi.fn(async () => ({ ok: true as const, resolvedPromoterDigest: digest, migrationHandoff: fresh }));
    const result = await refreshMigrationHandoffAfterDrain({ ...base(), migrationHandoff: expired, rerunPreflight });
    expect(result).toMatchObject({ ok: true, refreshed: true, code: "install_state_envelope_expired", migrationHandoff: fresh });
  });

  it("stays fail-closed on a tampered or wrong-run envelope instead of re-projecting over it", async () => {
    const state = '{"schemaVersion":2}';
    fsMocks.readFile.mockResolvedValue(state);
    const wrongRun = handoffFor(state, "SUR-other");
    const rerunPreflight = vi.fn();
    const params = base();
    const result = await refreshMigrationHandoffAfterDrain({ ...params, migrationHandoff: wrongRun, rerunPreflight });
    expect(result).toEqual({ ok: false, reason: "installer-state-repair-required: install_state_envelope_wrong_run" });
    expect(rerunPreflight).not.toHaveBeenCalled();
    expect(params.failRun).toHaveBeenCalledWith("SUR-1", expect.stringContaining("install_state_envelope_wrong_run"));
    expect(params.emitFailure).toHaveBeenCalledWith("SUR-1");
  });

  it("fails the run when the re-run readiness refuses", async () => {
    fsMocks.readFile.mockResolvedValue('{"moved":true}');
    const stale = handoffFor('{"schemaVersion":2}');
    const rerunPreflight = vi.fn(async () => ({ ok: false as const, reason: "promoter-readiness-failed" as const }));
    const result = await refreshMigrationHandoffAfterDrain({ ...base(), migrationHandoff: stale, rerunPreflight });
    expect(result).toEqual({ ok: false, reason: "promoter-readiness-failed" });
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
