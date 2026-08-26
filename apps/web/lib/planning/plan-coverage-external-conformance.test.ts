// Conformance: an EXTERNAL-SESSION-SHAPED capsule must be able to record schema-v2
// plan coverage (BI-B9403248 acceptance). The external shape is precisely:
//   - every capsule activity recorded by a HUMAN principal, so the set of
//     distinct recordedByAgentId values is EMPTY;
//   - the install's shared git identity signs the commit, and NO email-type
//     PrincipalAlias is registered for it (0 exist on a real install);
//   - therefore no agent-type alias binds an agent to the author either.
//
// This test deliberately drives the REAL resolveRepositoryArtifact rather than a
// stub. Stubbing the resolver is what let the original defect sit undetected:
// every existing record test injected an already-successful artifact, so the
// provenance conjunction that no external session could satisfy was never
// exercised from this direction.
import { describe, expect, it, vi } from "vitest";

import { resolveRepositoryArtifact } from "@/lib/backlog/initiative-readiness/repository-artifact";
import { recordPlanBacklogCoverage, type PlanBacklogCoverageDb } from "./plan-backlog-coverage";

const COMMIT = "a".repeat(40);
const BLOB = "b".repeat(40);
const AUTHOR_PRINCIPAL = "principal-operator";

const planArtifactRef = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: COMMIT,
  path: "docs/superpowers/plans/example.md",
  providerBlobId: BLOB,
};

const traceability = {
  requirementRefs: ["OBJ-TEST-001"],
  contractRefs: ["contract:test"],
  flowRefs: ["flow:test"],
  verificationRefs: ["AC-TEST-001"],
};

const planText = [
  "OBJ-1", "OBJ-2", "OBJ-TEST-001",
  "AC-1", "AC-2", "AC-TEST-001",
  "contract:test", "flow:test",
].join("\n");
const planBytes = Buffer.from(planText, "utf8");

const baselineRows = [{ payload: {
  baselineId: "baseline-1",
  supersedesBaselineId: null,
  artifactDigest: "sha256:design",
  objectiveStatements: [{ objectiveId: "OBJ-TEST-001" }],
  acceptanceStatements: [{ acceptanceId: "AC-TEST-001" }],
} }];

/** A Workroom shaped exactly like one an external CLI session leaves behind. */
function externalSessionCapsuleDb(overrides: {
  headSha?: string | null;
  activities?: Array<{ recordedByAgentId: string | null }>;
} = {}) {
  return {
    workroom: {
      findMany: vi.fn(async () => [{
        capsuleId: "WC-EXTERNAL",
        headBranch: "fix/external-session",
        headSha: overrides.headSha === undefined ? COMMIT : overrides.headSha,
        createdByPrincipalId: AUTHOR_PRINCIPAL,
        activities: overrides.activities ?? [],
      }]),
    },
    // No email alias for the install git identity, and no agent alias — the real
    // install has zero of both.
    principalAlias: { findMany: vi.fn(async () => []) },
    credentialEntry: { findUnique: vi.fn(async () => null) },
    platformDevConfig: {
      findUnique: vi.fn(async () => ({
        upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
      })),
    },
    scheduledJob: { findUnique: vi.fn(async () => null) },
  };
}

/** The provider: a DCO-signed commit and the plan blob at that commit. */
function providerFetch() {
  return vi.fn(async (url: string | URL | Request) => String(url).includes("/commits/")
    ? new Response(JSON.stringify({
      commit: { message: "docs: plan\n\nSigned-off-by: DPF CI <dpf-ci@users.noreply.github.com>" },
    }), { status: 200 })
    : new Response(JSON.stringify({
      type: "file",
      sha: BLOB,
      encoding: "base64",
      content: planBytes.toString("base64"),
    }), { status: 200 }));
}

function coverageDb(options: { baselines?: typeof baselineRows } = {}): {
  db: PlanBacklogCoverageDb;
  activityCreate: ReturnType<typeof vi.fn>;
} {
  const activityCreate = vi.fn(async () => ({ id: "activity-receipt-1" }));
  const tx = {
    $queryRaw: async <T>(strings: TemplateStringsArray, ..._values: unknown[]) => (
      strings.join("").includes('FROM "WorkCapsule"')
        // The immutable preflight re-reads the capsule owner; it must agree with
        // the principal the resolver derived.
        ? [{ id: "workroom-row", createdByPrincipalId: AUTHOR_PRINCIPAL }]
        : [{ id: "parent-row" }]
    ) as unknown as T,
    backlogItem: {
      findUnique: vi.fn(async ({ where }: { where: { itemId: string } }) =>
        where.itemId === "BI-EXTERNAL"
          ? { id: "parent-row", itemId: "BI-EXTERNAL", effortSize: "medium" }
          : null),
      findMany: vi.fn(async () => []),
    },
    backlogItemActivity: {
      create: activityCreate,
      findMany: vi.fn(async () => options.baselines ?? baselineRows),
    },
  };
  return { activityCreate, db: { ...tx, $transaction: vi.fn(async (work) => work(tx)) } };
}

function externalResolveArtifact(capsuleDb = externalSessionCapsuleDb(), fetchImpl = providerFetch()) {
  return ((args: Parameters<typeof resolveRepositoryArtifact>[0]) => resolveRepositoryArtifact({
    ...args,
    db: capsuleDb as never,
    fetchImpl: fetchImpl as typeof fetch,
  })) as typeof resolveRepositoryArtifact;
}

describe("plan coverage — external session conformance (BI-B9403248)", () => {
  it("records v2 coverage for a capsule with a human principal, no agent provenance and no email alias", async () => {
    const { db, activityCreate } = coverageDb();

    const result = await recordPlanBacklogCoverage({
      itemId: "BI-EXTERNAL",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "atomic",
      rationale: "One behavioural unit; no phase ships on its own.",
      deliverables: [{
        key: "atomic",
        title: "Atomic delivery",
        independentlyShippable: false,
        dependsOn: [],
        ...traceability,
      }],
      // An external session records under a human principal and supplies no agentId.
      userId: "user-operator",
      db,
      resolveArtifact: externalResolveArtifact(),
    });

    expect(result).toMatchObject({ ok: true, receiptId: "activity-receipt-1" });
    expect(activityCreate).toHaveBeenCalledOnce();
    expect(activityCreate.mock.calls[0]![0]).toMatchObject({
      data: {
        kind: "plan_backlog_coverage",
        recordedByAgentId: null,
        payload: { schemaVersion: 2, decision: "atomic", scopeBaselineId: "baseline-1" },
      },
    });
  });

  it("still records when a single agent participated but no alias binds it to the author", async () => {
    const { db } = coverageDb();
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-EXTERNAL",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "atomic",
      rationale: "One behavioural unit; no phase ships on its own.",
      deliverables: [{ key: "atomic", title: "Atomic delivery", independentlyShippable: false, dependsOn: [], ...traceability }],
      userId: "user-operator",
      db,
      resolveArtifact: externalResolveArtifact(
        externalSessionCapsuleDb({ activities: [{ recordedByAgentId: "some-agent" }] }),
      ),
    });

    expect(result).toMatchObject({ ok: true });
  });

  // The amend/rebase/squash dead end: the DCO commandment's own remedy for a
  // missing trailer rewrites every sha, so a capsule whose head was frozen at
  // adoption could never be recorded again. adopt_worktree now re-syncs the head;
  // this asserts the failure a caller sees BEFORE they do, and that it names the
  // remedy rather than saying "missing or ambiguous".
  it("names the stale head and the adopt_worktree remedy when the branch moved after adoption", async () => {
    const { db } = coverageDb();
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-EXTERNAL",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "atomic",
      rationale: "One behavioural unit; no phase ships on its own.",
      deliverables: [{ key: "atomic", title: "Atomic delivery", independentlyShippable: false, dependsOn: [], ...traceability }],
      userId: "user-operator",
      db,
      resolveArtifact: externalResolveArtifact(externalSessionCapsuleDb({ headSha: "c".repeat(40) })),
    });

    expect(result).toMatchObject({ ok: false, code: "plan-artifact-invalid" });
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("WC-EXTERNAL");
    expect(result.error).toContain("adopt_worktree");
  });

  it("names the unset head when the capsule was claimed but never synced", async () => {
    const { db } = coverageDb();
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-EXTERNAL",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "atomic",
      rationale: "One behavioural unit; no phase ships on its own.",
      deliverables: [{ key: "atomic", title: "Atomic delivery", independentlyShippable: false, dependsOn: [], ...traceability }],
      userId: "user-operator",
      db,
      resolveArtifact: externalResolveArtifact(externalSessionCapsuleDb({ headSha: null })),
    });

    expect(result).toMatchObject({ ok: false, code: "plan-artifact-invalid" });
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("no recorded head");
  });

  // BI-72F368BC. The scope baseline is a hard precondition for v2 coverage and no
  // external surface can create one (the only writer is the spec-approval lane,
  // which is grant-gated to agent principals and requires a reviewer independent
  // of the artifact author). Pinned here so the day it is fixed, this test fails
  // and points at BI-72F368BC rather than the failure being rediscovered.
  it("is blocked by the missing scope baseline once provenance succeeds — BI-72F368BC", async () => {
    const { db, activityCreate } = coverageDb({ baselines: [] });
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-EXTERNAL",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "atomic",
      rationale: "One behavioural unit; no phase ships on its own.",
      deliverables: [{ key: "atomic", title: "Atomic delivery", independentlyShippable: false, dependsOn: [], ...traceability }],
      userId: "user-operator",
      db,
      resolveArtifact: externalResolveArtifact(),
    });

    // NOT plan-artifact-invalid: provenance is satisfied, and the remaining
    // blocker is a different gate entirely.
    expect(result).toMatchObject({ ok: false, code: "traceability-incomplete" });
    expect(activityCreate).not.toHaveBeenCalled();
  });
});
