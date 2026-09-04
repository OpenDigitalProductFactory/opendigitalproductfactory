import { expect, it, vi } from "vitest";
import { signTransitionPayload } from "@/lib/platform-runtime/transition-protocol";
import { ok } from "@/lib/shared/action-result";

type TestContext = { mocks: any; runSelfUpgrade: (input: any) => Promise<any>; installState: string; installStateHash: string };

export function registerSelfUpgradeFunctionTests(input: {
  allFunctions: unknown[];
  scheduled: unknown;
  manual: unknown;
}) {
  it("registers both self-upgrade entry points", () => {
    expect(input.allFunctions).toEqual(expect.arrayContaining([input.scheduled, input.manual]));
  });
}

export function registerCoreSelfUpgradeSuccessTest(input: {
  mocks: any;
  runSelfUpgrade: (params: any) => Promise<any>;
}) {
  it("returns succeeded status when promoter exits 0", async () => {
    const result = await input.runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ status: "succeeded", runId: "SUR-AAAABBBB" });
    expect(input.mocks.completeRun).toHaveBeenCalledWith("SUR-AAAABBBB");
  });
}

export function configureReleaseUpgradeTest(input: {
  mocks: any;
  installState: string;
  sourceSha: string;
  currentConfigDigest: string;
  targetConfigDigest: string;
}) {
  vi.stubEnv("GHCR_OWNER", "opendigitalproductfactory");
  vi.stubEnv("DPF_IMAGE_TAG", "v1.0.0");
  vi.stubEnv("DPF_HOST_INSTALL_PATH", "/opt/dpf");
  vi.stubEnv("DPF_SELF_UPGRADE_COMPOSE_FILES", "docker-compose.yml docker-compose.release.yml");
  input.mocks.readSelfUpgradeSupport.mockResolvedValue({ configuredEnabled: true, supported: true, enabled: true, targetKind: "release-artifact", reason: "enabled", message: null });
  input.mocks.readFile.mockImplementation(async (path: string) => path.endsWith("install-state.json") ? input.installState : path.endsWith(".install-mode") ? "consumer" : "s".repeat(32));
  input.mocks.readCurrentContainerConfigDigest.mockResolvedValue(input.currentConfigDigest);
  input.mocks.readRegistryReleaseCandidate.mockResolvedValue({
    ...ok(),
    candidate: { tag: "v2.0.0", sourceSha: input.sourceSha, channelDigest: `sha256:${"b".repeat(64)}`, platformManifestDigest: `sha256:${"c".repeat(64)}`, configDigest: input.targetConfigDigest, platformOs: "linux", platformArchitecture: "amd64" },
  });
}

export function registerReleaseWorkerTargetRecoveryTests(input: {
  mocks: any;
  runSelfUpgrade: (params: any) => Promise<any>;
  installState: string;
}) {
  const sourceSha = "f".repeat(40);
  const currentConfigDigest = `sha256:${"a".repeat(64)}`;
  const targetConfigDigest = `sha256:${"c".repeat(64)}`;
  const candidate = {
    tag: "v2.0.0", sourceSha, channelDigest: `sha256:${"b".repeat(64)}`,
    platformManifestDigest: `sha256:${"c".repeat(64)}`, configDigest: targetConfigDigest,
    platformOs: "linux", platformArchitecture: "amd64",
  };
  const configure = () => configureReleaseUpgradeTest({
    mocks: input.mocks, installState: input.installState, sourceSha,
    currentConfigDigest, targetConfigDigest,
  });

  it("uses verified target evidence when the registry is unavailable at worker start", async () => {
    configure();
    input.mocks.readRegistryReleaseCandidate.mockResolvedValue({ ok: false, reason: "registry-unavailable" });
    input.mocks.loadVerifiedReleaseTargetEvidence.mockResolvedValue(candidate);
    input.mocks.getRun.mockResolvedValue({ targetSha: sourceSha, targetTag: candidate.tag });
    input.mocks.updateRunPlan.mockResolvedValue({ runId: "SUR-VERIFIED" });
    try {
      await expect(input.runSelfUpgrade({ triggeredBy: "ops", runId: "SUR-VERIFIED" }))
        .resolves.toMatchObject({ status: "succeeded", runId: "SUR-VERIFIED" });
      expect(input.mocks.skipRun).not.toHaveBeenCalled();
      expect(input.mocks.deferAdmittedRunForRedispatch).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("returns an admitted run to reconciliation when no verified target is available", async () => {
    configure();
    input.mocks.readRegistryReleaseCandidate.mockResolvedValue({ ok: false, reason: "registry-unavailable" });
    input.mocks.loadVerifiedReleaseTargetEvidence.mockResolvedValue(null);
    input.mocks.deferAdmittedRunForRedispatch.mockResolvedValue(true);
    try {
      await expect(input.runSelfUpgrade({ triggeredBy: "ops", runId: "SUR-RECONCILE" }))
        .resolves.toMatchObject({ reconciling: true, reason: "registry-unavailable", runId: "SUR-RECONCILE" });
      expect(input.mocks.deferAdmittedRunForRedispatch).toHaveBeenCalledWith("SUR-RECONCILE", "release-target-registry-unavailable");
      expect(input.mocks.skipRun).not.toHaveBeenCalled();
      expect(input.mocks.startQuiescence).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("fails closed when the worker target differs from the durable admission", async () => {
    configure();
    input.mocks.getRun.mockResolvedValue({ targetSha: "e".repeat(40), targetTag: candidate.tag });
    try {
      await expect(input.runSelfUpgrade({ triggeredBy: "ops", runId: "SUR-DRIFT" }))
        .resolves.toMatchObject({ ok: false, status: "failed", reason: "admission-target-drift" });
      expect(input.mocks.failRun).toHaveBeenCalledWith("SUR-DRIFT", expect.stringContaining("admission-target-drift"));
      expect(input.mocks.startQuiescence).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("terminalizes registry integrity failures instead of using cached evidence", async () => {
    configure();
    input.mocks.readRegistryReleaseCandidate.mockResolvedValue({ ok: false, reason: "config-digest-mismatch" });
    input.mocks.loadVerifiedReleaseTargetEvidence.mockResolvedValue(candidate);
    try {
      await expect(input.runSelfUpgrade({ triggeredBy: "ops", runId: "SUR-INTEGRITY" }))
        .resolves.toMatchObject({ ok: false, status: "failed", reason: "release-target-integrity-failed", releaseStatus: "config-digest-mismatch" });
      expect(input.mocks.loadVerifiedReleaseTargetEvidence).not.toHaveBeenCalled();
      expect(input.mocks.failRun).toHaveBeenCalledWith("SUR-INTEGRITY", "release-target-integrity-failed: config-digest-mismatch");
      expect(input.mocks.startQuiescence).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
}

export function registerInstallStateHandoffTests({ mocks, runSelfUpgrade, installState, installStateHash }: TestContext) {
  it("resolves and validates readiness before quiescence, then promotes the same digest", async () => {
    const order: string[] = [];
    let persistedHandoff: unknown;
    mocks.resolvePromoterArtifact.mockImplementation(async () => { order.push("resolve"); return { digest: `sha256:${"d".repeat(64)}`, sourceSha: "abc1234deadbeef", contractSchema: 1, contractDigest: `sha256:${"c".repeat(64)}`, callerProtocol: { min: 1, max: 1 } }; });
    mocks.runPromoterReadiness.mockImplementation(async () => { order.push("readiness"); return { exitCode: 0, stdout: JSON.stringify({ failures: [], sourceHash: installStateHash, projectionHash: "b".repeat(64), fromSchemaVersion: 1, toSchemaVersion: 2 }), stderr: "" }; });
    mocks.recordPromoterReadiness.mockImplementation(async (_runId: string, report: any) => { order.push("evidence"); persistedHandoff = report.migrationHandoff; return {}; });
    mocks.startQuiescence.mockImplementation(async () => { order.push("quiescence"); return { runId: "QR-1", awaitReady: async () => ({ ...ok(), outcome: "ready-to-swap", runId: "QR-1", finalSnapshot: null }) }; });
    mocks.runPromoter.mockImplementation(async (params: any) => { order.push("promotion"); expect(params.promoterImage).toBe(`sha256:${"d".repeat(64)}`); expect(params.installStateMigrationHandoff).toBe(persistedHandoff); return { exitCode: 0, stdout: "", stderr: "" }; });
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(order).toEqual(["resolve", "readiness", "evidence", "quiescence", "promotion"]);
  });

  it.each(["missing", "tampered", "expired", "wrong-run", "wrong-digest", "changed-source", "wrong-identity"])("rejects %s migration evidence before quiescence", async (kind) => {
    mocks.recordPromoterReadiness.mockImplementation(async (_runId: string, report: any) => {
      const handoff = report.migrationHandoff;
      if (kind === "missing") { delete handoff.envelope.projectionHash; handoff.signature = signTransitionPayload(handoff.envelope, "s".repeat(32)); }
      else if (kind === "tampered") handoff.envelope.projectionHash = "c".repeat(64);
      else {
        if (kind === "expired") handoff.envelope.expiresAt = new Date(0).toISOString();
        if (kind === "wrong-run") handoff.envelope.runId = "SUR-other";
        if (kind === "wrong-digest") handoff.envelope.promoterDigest = `sha256:${"e".repeat(64)}`;
        if (kind === "changed-source") handoff.envelope.sourceHash = "e".repeat(64);
        if (kind === "wrong-identity") handoff.envelope.hostIdentity = { platform: "linux", arch: "arm64", provenance: "explicit" };
        handoff.signature = signTransitionPayload(handoff.envelope, "s".repeat(32));
      }
      return {};
    });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ ok: false, reason: "installer-state-repair-required" });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
  });

  it.each(["missing-secret", "malformed-state", "contradictory-identity"])("terminalizes %s preparation failure before quiescence", async (kind) => {
    if (kind === "missing-secret") mocks.readFile.mockImplementation(async (path: string) => { if (path.endsWith("runtime-transition.secret")) throw new Error("ENOENT"); return installState; });
    if (kind === "malformed-state") mocks.readFile.mockImplementation(async (path: string) => path.endsWith("install-state.json") ? "{bad" : "s".repeat(32));
    if (kind === "contradictory-identity") mocks.resolveSelfUpgradeHostIdentity.mockImplementation(() => { throw new Error("host_identity_contradictory"); });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ ok: false, status: "failed", reason: "installer-state-repair-required" });
    expect(mocks.failRun).toHaveBeenCalledWith("SUR-AAAABBBB", expect.stringContaining("installer-state-repair-required"));
    expect(mocks.emitUpgradeEvent).toHaveBeenCalledWith({ type: "upgrade.failed", runId: "SUR-AAAABBBB" });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });
}
