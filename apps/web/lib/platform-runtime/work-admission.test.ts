import { describe, expect, it, vi } from "vitest";
import { admitRuntimeGuardedWork, lockRuntimeTransitionAdmission } from "./work-admission";
import { validateRuntimeServiceImagePlan, type RuntimeTransitionEnvelope } from "./transition-protocol";

describe("runtime guarded work admission", () => {
  it("takes the transition advisory lock (via $executeRaw) before checking disabled and draining capabilities", async () => {
    // BI-8BA6AC56 regression: the lock is pg_advisory_xact_lock, which returns
    // `void`. Prisma 7.8's driver adapter throws P2010 (UnsupportedNativeDataType)
    // deserializing a void column from $queryRaw — which crashed EVERY Build Studio
    // promote/start. The lock must be acquired with $executeRaw (no result-set
    // deserialization). Only snapshot-free SHOW is read through $queryRaw.
    const calls: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async (..._args: unknown[]) => { calls.push("lock"); return 1; }),
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        if (strings.join("") === "SHOW transaction_isolation") return [{ transaction_isolation: "read committed" }];
        throw new Error("advisory lock must use $executeRaw");
      }),
      platformCapability: { findMany: vi.fn(async () => { calls.push("capabilities"); return []; }) },
      runtimeCapabilityTransition: { findMany: vi.fn(async () => { calls.push("transition"); return []; }) },
    };
    await admitRuntimeGuardedWork(tx, "task-run:proactive");
    expect(calls).toEqual(["lock", "lock", "capabilities", "transition"]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const strings = tx.$executeRaw.mock.calls[0][0] as unknown as string[];
    expect(strings.join("")).toContain('LOCK TABLE "RuntimeCapabilityTransition" IN SHARE ROW EXCLUSIVE MODE');
    const advisory = tx.$executeRaw.mock.calls[1][0] as unknown as string[];
    expect(advisory.join("")).toContain("pg_advisory_xact_lock");
  });

  it("refuses a fixed snapshot acquired before the fence for every work source", async () => {
    const tx = fakeTx({ isolation: "serializable" });
    tx.$executeRaw.mockImplementation(async (strings) => {
      if (strings.join("").startsWith("SET TRANSACTION")) throw new Error("SET TRANSACTION [NOT] DEFERRABLE must be called before any query");
      return 1;
    });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).rejects.toThrow("before any query");
    expect(tx.platformCapability.findMany).not.toHaveBeenCalled();
    expect(tx.runtimeCapabilityTransition.findMany).not.toHaveBeenCalled();
  });

  it("reenters only the exact transaction after successful early acquisition", async () => {
    const tx = fakeTx({ isolation: "serializable" });
    await lockRuntimeTransitionAdmission(tx);
    const count = tx.$executeRaw.mock.calls.length;
    await admitRuntimeGuardedWork(tx, "task-run:coworker");
    expect(tx.$executeRaw).toHaveBeenCalledTimes(count);
    const next = fakeTx({ isolation: "serializable" });
    await lockRuntimeTransitionAdmission(next);
    expect(next.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it("does not mark a failed lock acquisition as fenced", async () => {
    const tx = fakeTx({ isolation: "serializable" });
    tx.$executeRaw.mockRejectedValueOnce(new Error("settings failed"));
    await expect(lockRuntimeTransitionAdmission(tx)).rejects.toThrow("settings failed");
    await lockRuntimeTransitionAdmission(tx);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("does not transfer a successful fence to an externally supplied adapter", async () => {
    const tx = fakeTx({ isolation: "serializable" });
    await lockRuntimeTransitionAdmission(tx);
    const proxy = { ...tx };
    tx.$executeRaw.mockImplementation(async strings => {
      if (strings.join("").startsWith("SET TRANSACTION")) throw new Error("snapshot already taken");
      return 1;
    });
    await expect(lockRuntimeTransitionAdmission(proxy)).rejects.toThrow("snapshot already taken");
    await expect(lockRuntimeTransitionAdmission(tx)).resolves.toBeUndefined();
  });

  it("does not let an unrelated already-disabled capability suppress a shared source", async () => {
    const tx = fakeTx({ capabilities: [{ capabilityId: "runtime:adp-integration", state: "disabled", manifest: { runtime: { workGuards: ["task-run:coworker"] } } }] });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).resolves.toBeUndefined();
  });

  it("rejects work while a matching capability is being removed by an active transition", async () => {
    const tx = fakeTx({ capabilities: [{ capabilityId: "runtime:durable-automation", state: "active", manifest: { runtime: { workGuards: ["task-run:proactive"] } } }], transition: { previousKeys: ["runtime:core", "runtime:durable-automation"], desiredKeys: ["runtime:core"] } });
    await expect(admitRuntimeGuardedWork(tx, "task-run:proactive")).rejects.toThrow("runtime_capability_work_draining:runtime:durable-automation");
  });

  it("admits unrelated guarded work", async () => {
    const tx = fakeTx({ capabilities: [{ capabilityId: "runtime:build", state: "active", manifest: { runtime: { workGuards: ["build-studio-active"] } } }], transition: { previousKeys: ["runtime:build"], desiredKeys: [] } });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).resolves.toBeUndefined();
  });

  it.each(["pending", "applying", "host_applied", "compensating"])("fences canonical image-owner work during %s without a saved guard", async status => {
    const tx = fakeTx({ transition: imageTransition(status) });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).rejects.toThrow("runtime_capability_work_draining:runtime:browser-automation");
  });

  it("also fences the selected image owner's saved manifest guards", async () => {
    const tx = fakeTx({ capabilities: [{ capabilityId: "runtime:browser-automation", state: "active", manifest: { runtime: { workGuards: ["task-run:proactive"] } } }], transition: imageTransition() });
    await expect(admitRuntimeGuardedWork(tx, "task-run:proactive")).rejects.toThrow("runtime_capability_work_draining:runtime:browser-automation");
  });

  it("retains the producer fence while v3 image recovery is uncertain", async () => {
    const tx = fakeTx({ transition: { ...imageTransition("rollback_failed"), failure: { recoveryRequired: true } } });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).rejects.toThrow("runtime_capability_work_draining:runtime:browser-automation");
  });

  it.each(["succeeded", "rolled_back", "failed", "rollback_failed"])("releases the image guard after settled %s", async status => {
    const tx = fakeTx({ transition: { ...imageTransition(status), failure: { recoveryRequired: false } } });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).resolves.toBeUndefined();
  });

  it("does not let an older unrelated recovery row hide active image work", async () => {
    const tx = fakeTx({ transitions: [
      { previousKeys: ["runtime:build"], desiredKeys: [], status: "rollback_failed", failure: { recoveryRequired: true }, envelope: { version: 2 } },
      imageTransition(),
    ] });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).rejects.toThrow("runtime_capability_work_draining:runtime:browser-automation");
    expect(tx.runtimeCapabilityTransition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { status: { in: ["pending", "applying", "host_applied", "compensating"] } },
      { status: "rollback_failed", failure: { path: ["recoveryRequired"], equals: true } },
    ] } }));
  });

  it("does not expand an image transition to unrelated saved guards", async () => {
    const tx = fakeTx({ capabilities: [{ capabilityId: "runtime:build", state: "active", manifest: { runtime: { workGuards: ["build-studio-active"] } } }], transition: imageTransition() });
    await expect(admitRuntimeGuardedWork(tx, "build-studio-active")).resolves.toBeUndefined();
  });

  it.each(["missing-plan", "wrong-service", "wrong-source"])("holds bounded image-owner work for %s metadata", async fault => {
    const transition = imageTransition();
    const envelope = transition.envelope as Extract<RuntimeTransitionEnvelope, { version: 3 }>;
    if (fault === "missing-plan") delete (envelope as unknown as Record<string, unknown>).imagePlan;
    if (fault === "wrong-service") (envelope.imagePlan.services[0]! as { service: string }).service = "postgres";
    if (fault === "wrong-source") envelope.imagePlan.sourceSha = "f".repeat(40);
    const tx = fakeTx({ transition });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).rejects.toThrow("runtime_capability_work_scope_unproven:runtime:browser-automation");
    await expect(admitRuntimeGuardedWork(tx, "build-studio-active")).resolves.toBeUndefined();
  });

  it("preserves a legacy unchanged-key transition without image metadata", async () => {
    const tx = fakeTx({ transition: { previousKeys: ["runtime:browser-automation"], desiredKeys: ["runtime:browser-automation"] } });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).resolves.toBeUndefined();
  });

  it.each(["serializable", "repeatable read"])("preserves a fresh %s transaction for any work source", async isolation => {
    const tx = fakeTx({ isolation });
    await expect(admitRuntimeGuardedWork(tx, "build-studio-active")).resolves.toBeUndefined();
    expect(tx.$executeRaw.mock.calls[0]![0].join("")).toBe("SET TRANSACTION NOT DEFERRABLE");
  });

});

type CapabilityRow = { capabilityId: string; state: string; manifest: unknown };
type ActiveTransition = { previousKeys: string[]; desiredKeys: string[]; status?: string; envelope?: unknown; failure?: { recoveryRequired?: boolean } };

function imageTransition(status = "pending"): ActiveTransition {
  const sourceSha = "a".repeat(40), hash = "b".repeat(64);
  const keys = ["runtime:browser-automation", "runtime:core"];
  const states = { "runtime:browser-automation": "active", "runtime:core": "active" };
  const envelope: RuntimeTransitionEnvelope = {
    version: 3, kind: "runtime-capability-transition", mode: "reconciliation", transitionId: "RCT-producer-test",
    issuedAt: new Date(1000).toISOString(), expiresAt: new Date(601000).toISOString(), catalogHash: hash,
    previousStateHash: hash, desiredStateHash: hash, previousKeys: keys, desiredKeys: keys,
    previousProfiles: ["runtime-browser-automation"], desiredProfiles: ["runtime-browser-automation"], previousServices: ["browser-use", "portal"], desiredServices: ["browser-use", "portal"],
    protocolIdentity: { sourceSha, promoterDigest: `sha256:${hash}`, actuatorSha256: hash, signerSha256: hash, imageQualifierSha256: hash },
    imagePlan: { schemaVersion: 1, sourceSha, platform: "linux/amd64", operation: "prepare", services: [{ service: "browser-use", source: { kind: "source", sourceSha } }] },
    reconciliation: { observedHost: { schemaVersion: 2, installerVersion: "test", platform: "linux", arch: "amd64", capabilityCatalogHash: hash, capabilityStateVersion: hash, enabledRuntimeCapabilities: keys }, observedDatabaseStates: states, desiredHostEnabledKeys: keys, desiredDatabaseStates: states, touchedKeys: [] },
  };
  validateRuntimeServiceImagePlan(envelope);
  return { previousKeys: keys, desiredKeys: keys, envelope, status };
}

function fakeTx(input: { capabilities?: CapabilityRow[]; transition?: ActiveTransition; transitions?: ActiveTransition[]; isolation?: string }) {
  const rows = (input.transitions ?? (input.transition ? [input.transition] : [])).map(row => ({ ...row, status: row.status ?? "pending", envelope: row.envelope ?? null }));
  const selected = (where: { status?: { in: string[] }; OR?: Array<{ status: string | { in: string[] }; failure?: unknown }> }) => rows.filter(row =>
    where.status?.in.includes(row.status) || where.OR?.some(clause => typeof clause.status === "string"
      ? row.status === clause.status && row.failure?.recoveryRequired === true
      : clause.status.in.includes(row.status)));
  return {
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray) => 1),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => strings.join("") === "SHOW transaction_deferrable" ? [{ transaction_deferrable: "off" }] : [{ transaction_isolation: input.isolation ?? "read committed" }]),
    platformCapability: { findMany: vi.fn(async () => input.capabilities ?? []) },
    runtimeCapabilityTransition: {
      findFirst: vi.fn(async ({ where }) => selected(where)[0] ?? null),
      findMany: vi.fn(async ({ where }) => selected(where)),
    },
  };
}
