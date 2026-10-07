import { describe, expect, it } from "vitest";

import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "@/lib/work-management/workroom-shape-claim";

import { issueAcceptanceObjectiveMappingPacket, type IssuePacketDb } from "./issue-objective-mapping-packet";
import {
  acceptanceStewardDriveTaskId,
  loadAcceptanceStewardObjectiveMappingAuthority,
  stewardCapsuleIdFromRun,
  type StewardAuthorityDb,
} from "./steward-objective-mapping-authority";

// BI-099A0BA3: what the sweep issues is exactly what the steward run is
// admitted to. One in-memory store stands behind both halves.

const ITEM = "BI-DF255666";
const NOW = new Date("2026-10-07T05:00:00.000Z");
const VERIFIER = "AGT-WS-VERIFY";

function packet(targetAgent = VERIFIER) {
  const binding = {
    writerToolName: "record_initiative_evidence",
    itemId: ITEM,
    gate: "objective-mapping" as const,
    expectedCurrentBaselineId: "baseline-1",
    eligibleEvidenceActivityIds: ["E-1"],
    workroomRef: { kind: "workroom-head" as const, workroomId: "WC-DELIVERY", repositoryFullName: "o/r", branchName: "fix/x", headSha: "a".repeat(40) },
    artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "o/r", commitSha: "b".repeat(40), path: "docs/d.md", providerBlobId: "c".repeat(40) },
  };
  const base = { targetAgent, objective: "Map.", questionPacketSummary: `Objective mapping for ${ITEM}`, requiredToolNames: ["read_source_at_version", "record_initiative_evidence"], binding };
  return { ...base, requestKey: createObjectiveMappingRequestKey(base), tier: 2, enteredVia: "handoff", initiativeReviewBinding: binding };
}

function store() {
  const room = {
    id: "room-1",
    capsuleId: "WC-ACC-DF255666",
    idempotencyKey: `acceptance:${ITEM}`,
    status: "working",
    archivedAt: null as Date | null,
    objective: "",
    outcomeAnchor: { kind: "backlog-item", id: ITEM },
    scopeClaims: [
      buildWorkShapeClaim("acceptance-verification@1.0.0", NOW),
      buildWorkShapeRoleBindingsClaim({ "acceptance-verifier": `agent:${VERIFIER}` }, NOW),
    ],
  };
  const activities: Array<{ workCapsuleId: string; kind: string; payload: unknown; recordedByAgentId: string | null; recordedById: string | null }> = [];
  const db = {
    workroom: {
      findUnique: async ({ where }: { where: { idempotencyKey?: string; capsuleId?: string } }) =>
        where.idempotencyKey === room.idempotencyKey || where.capsuleId === room.capsuleId ? room : null,
      update: async ({ data }: { data: { objective: string } }) => { room.objective = data.objective; return room; },
    },
    workroomActivity: {
      findFirst: async ({ where }: { where: { workCapsuleId: string; kind: string } }) =>
        [...activities].reverse().find((row) => row.workCapsuleId === where.workCapsuleId && row.kind === where.kind) ?? null,
      create: async ({ data }: { data: { workCapsuleId: string; kind: string; payload: unknown; recordedByAgentId: string } }) => {
        activities.push({ ...data, recordedById: null });
        return { id: `act-${activities.length}` };
      },
    },
  };
  return { room, activities, db };
}

const run = (over: Record<string, unknown> = {}) => ({
  taskRunId: "TR-SCHED-00000001",
  userId: "user-operator",
  currentAgentId: VERIFIER,
  status: "working",
  completedAt: null,
  archivedAt: null,
  a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: acceptanceStewardDriveTaskId(ITEM) } },
  ...over,
});

describe("steward objective-mapping authority (BI-099A0BA3)", () => {
  it("admits the room's own drive run to exactly the packet the sweep issued", async () => {
    const { db, room } = store();
    await expect(issueAcceptanceObjectiveMappingPacket({
      db: db as unknown as IssuePacketDb, itemId: ITEM, ownerAgentId: VERIFIER, packet: packet(), objective: "brief", now: NOW,
    })).resolves.toBe("issued");
    expect(room.objective).toBe("brief");

    const authority = await loadAcceptanceStewardObjectiveMappingAuthority(db as unknown as StewardAuthorityDb, { run: run(), itemId: ITEM });

    expect(authority).toMatchObject({ ok: true, itemId: ITEM, packet: { targetAgent: VERIFIER, requestKey: packet().requestKey } });
  });

  it("the drive task id names the room the sweep keyed for the item", () => {
    expect(acceptanceStewardDriveTaskId(ITEM)).toBe("workroom-WC-ACC-DF255666-acceptance-verification");
    expect(stewardCapsuleIdFromRun(run().a2aMetadata)).toBe("WC-ACC-DF255666");
    expect(stewardCapsuleIdFromRun({ trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: "workroom-WC-OTHER-acceptance-verification" } })).toBeNull();
  });

  it("refuses a run whose item differs from the one the caller writes for", async () => {
    const { db } = store();
    await issueAcceptanceObjectiveMappingPacket({ db: db as unknown as IssuePacketDb, itemId: ITEM, ownerAgentId: VERIFIER, packet: packet(), objective: "b", now: NOW });
    await expect(loadAcceptanceStewardObjectiveMappingAuthority(db as unknown as StewardAuthorityDb, { run: run(), itemId: "BI-OTHER" }))
      .resolves.toEqual({ ok: false, reason: "room-not-bound" });
  });

  it("refuses an external-MCP run and a run of another agent", async () => {
    const { db } = store();
    await issueAcceptanceObjectiveMappingPacket({ db: db as unknown as IssuePacketDb, itemId: ITEM, ownerAgentId: VERIFIER, packet: packet(), objective: "b", now: NOW });
    await expect(loadAcceptanceStewardObjectiveMappingAuthority(db as unknown as StewardAuthorityDb, {
      run: run({ taskRunId: "TR-MCP-1", a2aMetadata: { trigger: "external-mcp", sourceRef: { kind: "scheduled-task", id: acceptanceStewardDriveTaskId(ITEM) } } }),
    })).resolves.toEqual({ ok: false, reason: "not-a-steward-run" });
    await expect(loadAcceptanceStewardObjectiveMappingAuthority(db as unknown as StewardAuthorityDb, { run: run({ currentAgentId: "AGT-OTHER" }) }))
      .resolves.toEqual({ ok: false, reason: "room-not-bound" });
  });
});
