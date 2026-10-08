// BI-5C992261: a small fix refused at claim for research is told to record its
// reproduction with record_execution_evidence (source_verified + test_pass) and
// claim again (BI-6EB2DBBB). The claim used to load only receipt activities, so
// the evidence that advice produces never reached the readiness projection and
// the re-claim was refused forever. These tests follow the refusal's advice
// through the real writer and the real claim against one shared store.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Activity = {
  id: string;
  backlogItemId: string;
  kind: string;
  gateKey: string | null;
  recordedAt: Date;
  payload: unknown;
};

const store = vi.hoisted(() => ({ activities: [] as Activity[], clock: 0 }));

function appendActivity(data: { backlogItemId: string; kind: string; gateKey?: string | null; payload?: unknown }): Activity {
  store.clock += 1;
  const row: Activity = {
    id: `act-${store.clock}`,
    backlogItemId: data.backlogItemId,
    kind: data.kind,
    gateKey: data.gateKey ?? null,
    recordedAt: new Date(Date.UTC(2026, 9, 7, 12, 0, store.clock)),
    payload: data.payload ?? null,
  };
  store.activities.push(row);
  return row;
}

// The writer behind record_execution_evidence persists through @dpf/db. Back it
// with the same store the claim reads, so the test exercises what the advised
// remedy actually writes rather than a hand-shaped row.
vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: {
      findUnique: vi.fn(async () => ({ id: "row-bi" })),
    },
    backlogItemActivity: {
      create: vi.fn(async ({ data }: { data: { backlogItemId: string; kind: string; payload?: unknown } }) =>
        appendActivity(data)),
    },
    toolExecution: { findUnique: vi.fn(async () => null) },
  },
}));

import { buildEvidencePack } from "@/lib/mcp/packs/build-evidence-pack";
import { CLAIM_READINESS_ACTIVITY_KINDS, claimGovernedBacklogWorkspace } from "./governed-work-claim";
import type { CapsuleDb } from "./work-capsule-store-types";

const actor = { userId: "user-1", agentId: "AGT-EXT-CLAUDE", principalId: "PRN-1" };
const HEAD = "1111111111111111111111111111111111111111";
const BASE = "3333333333333333333333333333333333333333";
const input = {
  backlogItemId: "BI-SMALLFIX",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  headBranch: "fix/small-fix",
  worktreePath: "/worktrees/small-fix",
  baseBranch: "main",
  executorKind: "claude-desktop" as const,
  executorRef: "session-1",
  workShape: "delivery-small@1.0.0",
};

function database() {
  const db = {
    backlogItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: "row-bi",
        itemId: "BI-SMALLFIX",
        type: "product",
        source: "user-request",
        workType: "bug",
        scopeKind: "platform",
        title: "A small defect",
        body: "A small defect with a known cause.",
        archetypeCategories: [],
        archetypeIds: [],
        activeBuild: null,
      }),
      update: vi.fn(),
    },
    backlogItemActivity: {
      // Honour the kind filter: a mock that returns every row regardless of the
      // query cannot tell a claim that loads evidence from one that does not.
      findMany: vi.fn(async (args?: { where?: { backlogItemId?: string; kind?: { in?: string[] } } }) => {
        const kinds = args?.where?.kind?.in;
        return store.activities
          .filter((row) => !args?.where?.backlogItemId || row.backlogItemId === args.where.backlogItemId)
          .filter((row) => !kinds || kinds.includes(row.kind))
          .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime());
      }),
      create: vi.fn(async ({ data }: { data: { backlogItemId: string; kind: string; payload?: unknown } }) =>
        appendActivity(data)),
    },
    workroom: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({
        id: "row-wc",
        capsuleId: "WC-SMALLFIX",
        backlogItemId: "BI-SMALLFIX",
        status: "ready",
        archivedAt: null,
        repositoryFullName: input.repositoryFullName,
        headBranch: input.headBranch,
        worktreePath: input.worktreePath,
        executorKind: input.executorKind,
        executorRef: input.executorRef,
        leaseHolderPrincipalId: actor.principalId,
        leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      }),
      findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-SMALLFIX",
        repositoryFullName: input.repositoryFullName,
        headBranch: input.headBranch,
        headSha: HEAD,
        baseSha: BASE,
        backlogItemId: null,
      }]),
      update: vi.fn(),
    },
    workroomActivity: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({
        payload: {
          schemaVersion: 1,
          intent: "implementation",
          policyVersion: "initiative-readiness.v1",
          subject: { kind: "backlog-item", id: "BI-SMALLFIX" },
        },
      }),
    },
    agentToolGrant: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db as unknown as CapsuleDb;
}

const now = new Date("2026-10-07T13:00:00.000Z");
const claim = (db: CapsuleDb) => claimGovernedBacklogWorkspace({
  db,
  input,
  actor,
  workIntent: "implementation",
  now,
  dependencies: {
    claimWorkspace: vi.fn().mockResolvedValue({
      capsuleId: "WC-SMALLFIX",
      backlogItemId: "BI-SMALLFIX",
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      claimed: true,
      conflict: null,
    }),
    declareIntent: vi.fn().mockResolvedValue({ id: "intent-row" }),
    discoverCanonicalArtifact: vi.fn().mockResolvedValue({ resolved: false, reason: "no-canonical-artifact" }),
  },
});

const recordExecutionEvidence = (kind: string, extra: Record<string, unknown> = {}) =>
  buildEvidencePack.handlers.record_execution_evidence!(
    { itemId: "BI-SMALLFIX", kind, summary: `${kind} for the reproduction`, ...extra },
    actor.userId,
    { agentId: actor.agentId },
  );

function researchGuidance(result: Awaited<ReturnType<typeof claim>>): string {
  if (result.ok) return "";
  const readiness = result.data.readiness as { unmet?: Array<{ code: string; nextAction: string | null }> } | undefined;
  const research = readiness?.unmet?.find((entry) => entry.code === "RESEARCH_REQUIRED");
  return [research?.nextAction ?? "", JSON.stringify(result.data.recovery ?? {})].join("\n");
}

beforeEach(() => {
  store.activities.length = 0;
  store.clock = 0;
});

describe("a small fix's recorded reproduction at claim (BI-5C992261)", () => {
  it("loads the execution evidence the research remedy writes", () => {
    expect(CLAIM_READINESS_ACTIVITY_KINDS).toContain("evidence");
  });

  it("refuses without a reproduction, and admits the claim once the advised remedy is performed", async () => {
    const db = database();

    const refused = await claim(db);
    expect(refused.ok).toBe(false);
    const guidance = researchGuidance(refused);
    // The refusal advises exactly this remedy; the next steps perform it.
    expect(guidance).toContain("record_execution_evidence");
    expect(guidance).toContain("source_verified");
    expect(guidance).toContain("test_pass");

    const source = await recordExecutionEvidence("source_verified", {
      url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/x.ts#L10",
    });
    const test = await recordExecutionEvidence("test_pass");
    expect(source.success).toBe(true);
    expect(test.success).toBe(true);

    const admitted = await claim(db);
    expect(admitted).toMatchObject({
      ok: true,
      data: { workIntent: "implementation", readiness: { verdict: "allowed" } },
    });
  });

  it("still refuses research when only half of the reproduction is recorded", async () => {
    const db = database();
    await recordExecutionEvidence("test_pass");

    const refused = await claim(db);
    expect(refused.ok).toBe(false);
    const readiness = refused.ok ? null : refused.data.readiness as { unmet?: Array<{ code: string }> };
    expect(readiness?.unmet?.map((entry) => entry.code)).toContain("RESEARCH_REQUIRED");
  });
});
