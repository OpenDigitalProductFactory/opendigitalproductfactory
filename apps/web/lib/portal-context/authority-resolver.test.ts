import { describe, expect, it, vi } from "vitest";

import { resolvePortalAuthority, resolvePromotionReviewerGrantKeys } from "./authority-resolver";
import type { PortalContextDb } from "./db-types";
import type { PortalContextEnvelope } from "./types";

type WorkProjection = PortalContextEnvelope["work"];

describe("resolvePortalAuthority", () => {
  it("allows the current executor or scope-claim principal to act on a capsule without broad platform role", () => {
    const executorAuthority = resolvePortalAuthority({
      user: { id: "user-1", isSuperuser: false },
      userPrincipalId: "principal-1",
      platformRole: "none",
      work: {
        ...emptyWork(),
        capsule: capsuleAnchor({
          executorRef: "principal-1",
          scopeClaimPrincipalIds: [],
        }),
      },
      domainTools: [],
      promotionReviewerGrantKeys: [],
    });

    const scopeClaimAuthority = resolvePortalAuthority({
      user: { id: "user-1", isSuperuser: false },
      userPrincipalId: "principal-1",
      platformRole: "none",
      work: {
        ...emptyWork(),
        capsule: capsuleAnchor({
          executorRef: "other-principal",
          scopeClaimPrincipalIds: ["principal-1"],
        }),
      },
      domainTools: [],
      promotionReviewerGrantKeys: [],
    });

    const unrelatedAuthority = resolvePortalAuthority({
      user: { id: "user-1", isSuperuser: false },
      userPrincipalId: "principal-1",
      platformRole: "none",
      work: {
        ...emptyWork(),
        capsule: capsuleAnchor({
          executorRef: "other-principal",
          scopeClaimPrincipalIds: ["principal-2"],
        }),
      },
      domainTools: [],
      promotionReviewerGrantKeys: [],
    });

    expect(executorAuthority.canActOnCapsule).toBe(true);
    expect(scopeClaimAuthority.canActOnCapsule).toBe(true);
    expect(unrelatedAuthority.canActOnCapsule).toBe(false);
  });

  it("does not treat backlog management as promotion review authority", () => {
    const authority = resolvePortalAuthority({
      user: { id: "user-1", isSuperuser: false },
      userPrincipalId: "principal-1",
      platformRole: "HR-500",
      work: emptyWork(),
      domainTools: ["schedule_promotion", "run_release_gate"],
      promotionReviewerGrantKeys: [],
    });

    expect(authority.canReviewPromotion).toBe(false);
  });

  it("uses build-scoped promotion reviewer grants for promotion review authority", () => {
    const authority = resolvePortalAuthority({
      user: { id: "user-1", isSuperuser: false },
      userPrincipalId: "principal-1",
      platformRole: "none",
      work: emptyWork(),
      domainTools: [],
      promotionReviewerGrantKeys: ["release_gate_create"],
    });

    expect(authority.canReviewPromotion).toBe(true);
  });

  it("resolves active build-scoped promotion reviewer grants from authority bindings", async () => {
    const db = {
      authorityBinding: {
        findMany: vi.fn().mockResolvedValue([
          {
            subjects: [{ subjectType: "platform-role", subjectRef: "HR-300", relation: "allowed" }],
            grants: [{ grantKey: "release_gate_create", mode: "allow" }],
          },
          {
            subjects: [{ subjectType: "platform-role", subjectRef: "HR-300", relation: "allowed" }],
            grants: [{ grantKey: "deployment_plan_create", mode: "allow" }],
          },
        ]),
      },
    } as unknown as PortalContextDb;

    const grantKeys = await resolvePromotionReviewerGrantKeys({
      db,
      work: {
        ...emptyWork(),
        featureBuild: {
          buildId: "FB-123",
          title: "Build",
          phase: "review",
          status: "working",
          evidenceComplete: true,
          href: "/build?buildId=FB-123",
        },
      },
      routeContext: "/build",
      userId: "user-1",
      principalId: "principal-1",
      platformRole: "HR-300",
    });

    expect(grantKeys).toEqual(["release_gate_create"]);
    expect(db.authorityBinding?.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "active",
          resourceRef: { in: ["FB-123", "/build"] },
        }),
      }),
    );
  });

  it("reads proposal mode from task-run authority scope rather than active work anchors", () => {
    const anchoredBuildAuthority = resolvePortalAuthority({
      user: { id: "user-1", isSuperuser: false },
      userPrincipalId: "principal-1",
      platformRole: "none",
      work: {
        ...emptyWork(),
        featureBuild: {
          buildId: "FB-123",
          title: "Build",
          phase: "build",
          status: "working",
          evidenceComplete: false,
          href: "/build?buildId=FB-123",
        },
      },
      domainTools: [],
      promotionReviewerGrantKeys: [],
    });

    const proposalTaskAuthority = resolvePortalAuthority({
      user: { id: "user-1", isSuperuser: false },
      userPrincipalId: "principal-1",
      platformRole: "none",
      work: {
        ...emptyWork(),
        taskRun: {
          taskRunId: "TR-123",
          contextId: "ctx-123",
          status: "working",
          authorityScope: "proposal",
          parentTaskRunId: null,
        },
      },
      domainTools: [],
      promotionReviewerGrantKeys: [],
    });

    expect(anchoredBuildAuthority.proposalModeActive).toBe(false);
    expect(proposalTaskAuthority.proposalModeActive).toBe(true);
  });
});

function emptyWork(): WorkProjection {
  return {
    backlogItem: null,
    epic: null,
    capsule: null,
    featureBuild: null,
    taskRun: null,
    agentThread: null,
    branch: null,
  };
}

function capsuleAnchor(
  overrides: Partial<NonNullable<WorkProjection["capsule"]>> = {},
): NonNullable<WorkProjection["capsule"]> {
  return {
    capsuleId: "WC-123",
    title: "Capsule",
    status: "working",
    executorKind: "codex",
    executorRef: null,
    leaseHolderPrincipalId: null,
    leaseExpiresAt: "2026-05-17T19:00:00.000Z",
    isLeaseExpired: false,
    isStale: false,
    scopeClaims: [],
    scopeClaimPrincipalIds: [],
    branchName: null,
    href: "/build/work/WC-123",
    ...overrides,
  };
}
