import { describe, expect, it, vi } from "vitest";
import { actor, input, database } from "./governed-work-claim.test-fixtures";
import { readyActivities } from "@/lib/backlog/initiative-readiness/entry-adapter.test-fixtures";
vi.mock("@/lib/backlog/initiative-readiness/canonical-artifact-discovery", async original => ({
  ...await original<typeof import("@/lib/backlog/initiative-readiness/canonical-artifact-discovery")>(),
  prepareCurrentDesignObservation: vi.fn(async () => ({ evidence: { state: "not-applicable" },
    admissionGuard: async () => ({ state: "not-applicable" }) })),
}));
import { claimGovernedBacklogWorkspace } from "./governed-work-claim";

const BASE = "3".repeat(40), HEAD = "1".repeat(40);
async function claim(workIntent: "design" | "plan" | "implementation", baseSha: string | null, headSha: string | null) {
  const db = database(readyActivities());
  const recorded = await db.workroom.findUnique({});
  vi.mocked(db.workroom.findUnique).mockResolvedValue({ ...recorded, baseSha, headSha } as never);
  vi.mocked(db.workroomActivity.findFirst!).mockResolvedValue({ payload: { schemaVersion: 1, intent: workIntent,
    policyVersion: "initiative-readiness.v1", subject: { kind: "backlog-item", id: input.backlogItemId } } } as never);
  return claimGovernedBacklogWorkspace({ db, input, actor, workIntent,
    dependencies: { claimWorkspace: vi.fn().mockResolvedValue({ capsuleId: "WC-ENTRY", backlogItemId: input.backlogItemId,
      headBranch: input.headBranch, worktreePath: input.worktreePath, claimed: true, conflict: null }),
    declareIntent: vi.fn().mockResolvedValue({ id: "intent-row" }) } });
}

describe("native persisted claim identity", () => {
  it.each(["baseSha", "headSha"] as const)("repairs invalid legacy %s before discovering or issuing a reviewer artifact", async field => {
    const db = database();
    vi.mocked(db.workroom.findMany).mockResolvedValue([{ capsuleId: "WC-ENTRY", backlogItemId: input.backlogItemId,
      repositoryFullName: input.repositoryFullName, headBranch: input.headBranch,
      baseSha: BASE, headSha: HEAD, [field]: "abc123" }] as never);
    const discover = vi.fn();
    const result = await claimGovernedBacklogWorkspace({ db, input, actor, workIntent: "implementation",
      dependencies: { claimWorkspace: vi.fn(), discoverCanonicalArtifact: discover } });
    expect(discover).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Unusable source must not issue a reviewer request");
    expect(result.data.recovery.reviewerRoutes).toEqual([]);
    expect(result.data.recovery.identityRepair?.missingFields).toEqual([field]);
    expect(result.data.recovery.identityRepair?.packet).not.toHaveProperty(field);
  });

  it.each([[null, null, "base"], [BASE, null, "head"], [null, HEAD, "base"],
    [BASE, "abc123", "head"], ["g".repeat(40), HEAD, "base"], [BASE, " ", "head"]])(
    "refuses implementation with stored base=%s head=%s even when optional input SHAs were omitted", async (base, head, missing) => {
      const result = await claim("implementation", base, head);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Unusable recorded source must not produce a successful implementation claim");
      expect(result.data.code).toBe("capsule_identity_mismatch");
      expect(String(result.error).toLowerCase()).toContain(missing!);
      expect(String(result.error)).toContain("40-character");
    });

  it("returns both actual persisted SHAs when implementation reuses complete recorded source", async () => {
    const result = await claim("implementation", BASE, HEAD);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.readback).toMatchObject({ baseSha: BASE, headSha: HEAD, sourceIdentityComplete: true });
  });

  it.each(["design", "plan"] as const)("keeps source-less %s valid and explicitly incomplete", async intent => {
    const result = await claim(intent, null, null);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.readback).toMatchObject({ baseSha: null, headSha: null, sourceIdentityComplete: false });
  });
});
