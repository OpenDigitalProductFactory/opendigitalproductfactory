import { expect, it } from "vitest";
import { signTransitionPayload } from "@/lib/platform-runtime/transition-protocol";

type TestContext = { mocks: any; runSelfUpgrade: (input: any) => Promise<any>; installState: string; installStateHash: string };

export function registerInstallStateHandoffTests({ mocks, runSelfUpgrade, installState, installStateHash }: TestContext) {
  it("resolves and validates readiness before quiescence, then promotes the same digest", async () => {
    const order: string[] = [];
    let persistedHandoff: unknown;
    mocks.resolvePromoterArtifact.mockImplementation(async () => { order.push("resolve"); return { digest: `sha256:${"d".repeat(64)}`, sourceSha: "abc1234deadbeef", contractSchema: 1, contractDigest: `sha256:${"c".repeat(64)}`, callerProtocol: { min: 1, max: 1 } }; });
    mocks.runPromoterReadiness.mockImplementation(async () => { order.push("readiness"); return { exitCode: 0, stdout: JSON.stringify({ failures: [], sourceHash: installStateHash, projectionHash: "b".repeat(64), fromSchemaVersion: 1, toSchemaVersion: 2 }), stderr: "" }; });
    mocks.recordPromoterReadiness.mockImplementation(async (_runId: string, report: any) => { order.push("evidence"); persistedHandoff = report.migrationHandoff; return {}; });
    mocks.startQuiescence.mockImplementation(async () => { order.push("quiescence"); return { runId: "QR-1", awaitReady: async () => ({ ok: true, outcome: "ready-to-swap", runId: "QR-1", finalSnapshot: null }) }; });
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
