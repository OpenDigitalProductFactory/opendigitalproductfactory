import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { ok } from "@/lib/shared/action-result";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import type { TerminalRecoveryPorts } from "@/lib/backlog/initiative-readiness/terminal-recovery";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

import {
  authorAgentIdFrom,
  createSweepOwnerResolver,
  evaluateOwedAcceptance,
} from "./acceptance-sweep-evaluate";
import { projectOwedAcceptance } from "./owed-acceptance";

// S1's constraint (BI-04140C98): the owner resolver names a coworker only when
// it is given a Workroom branch and head. The sweep therefore runs the same
// terminal recovery chain the reviewer dispatch uses, which finds the item's
// live Workroom (WorkCapsule.backlogItemId), its baseline and its evidence, and
// swaps in the author-excluding resolver. Without a room the item reads
// unroutable with the chain's own reason, never a guessed owner.

const decision: InitiativeReadinessDecision = {
  decisionId: "unpersisted",
  policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: "BI-AA000003" },
  transitionObject: { kind: "backlog-item", id: "BI-AA000003", expectedVersion: "read-projection", targetState: "completion" },
  profile: "feature",
  target: "completion",
  verdict: "input-required",
  satisfied: [],
  unmet: [readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })],
  blockers: [],
  evaluatedAt: "2026-10-06T05:00:00.000Z",
};

const room = {
  capsuleId: "WC-ACCEPT03",
  backlogItemId: "BI-AA000003",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  baseSha: "1".repeat(40),
  headBranch: "feat/acceptance-fixture",
  headSha: "2".repeat(40),
  isLive: true,
};

const baselinePayload = {
  baselineId: "baseline-1",
  supersedesBaselineId: null,
  artifactRef: {
    kind: "repo-blob-at-commit",
    repositoryFullName: room.repositoryFullName,
    commitSha: "3".repeat(40),
    path: "docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md",
    providerBlobId: "4".repeat(40),
  },
};

function grantRows(agentId: string) {
  const agent = { agentId, displayName: `${agentId} name`, status: "active", archived: false, lifecycleStage: "production" };
  return [{ grantKey: "initiative_evidence_write", agent }, { grantKey: "file_read", agent }];
}

/** A grant read over `rows`; every agent runs in-platform unless listed in `externalCli`. */
function grantDb(rows: ReturnType<typeof grantRows>, externalCli: readonly string[] = []) {
  return {
    agentToolGrant: { findMany: vi.fn().mockResolvedValue(rows) },
    agent: {
      findMany: vi.fn(async (args: { where: { agentId: { in: string[] } } }) =>
        args.where.agentId.in.map((agentId) => ({
          agentId,
          executionConfig: { executionType: externalCli.includes(agentId) ? "external_cli" : "in_process" },
        }))),
    },
  };
}

function terminalPorts(overrides: Partial<TerminalRecoveryPorts> = {}): Partial<TerminalRecoveryPorts> {
  return {
    loadLiveRooms: vi.fn(async () => [room]),
    loadBaselinePayloads: vi.fn(async () => [baselinePayload]),
    loadEligibleEvidenceActivityIds: vi.fn(async () => ok({ activityIds: ["act-evidence-1"] })),
    loadObjectiveMappingHistory: vi.fn(async () => ok({ history: [] })),
    verifyHistoricalArtifact: vi.fn(async () => { throw new Error("provider must not be called"); }),
    discoverArtifact: vi.fn(async () => { throw new Error("baseline artifact is bound; discovery must not be called"); }),
    ...overrides,
  };
}

describe("createSweepOwnerResolver", () => {
  it("names a granted coworker other than the author through the item's live Workroom", async () => {
    const ports = terminalPorts();
    const resolveOwner = createSweepOwnerResolver({
      db: grantDb([...grantRows("AGT-A-AUTHOR"), ...grantRows("AGT-WS-ACCEPT")]),
      ports,
    });
    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });

    expect(ports.loadLiveRooms).toHaveBeenCalledWith({ itemId: "BI-AA000003", refusedWorkroomId: null });
    expect(result.owner).toEqual({ agentId: "AGT-WS-ACCEPT", displayName: "AGT-WS-ACCEPT name", codes: ["ACCEPTANCE_EVIDENCE_REQUIRED"] });
    expect(result.unroutable).toEqual([]);
  });

  it("reports the author as excluded rather than routing acceptance back to them", async () => {
    const resolveOwner = createSweepOwnerResolver({
      db: grantDb(grantRows("AGT-A-AUTHOR")),
      ports: terminalPorts(),
    });
    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });
    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([expect.objectContaining({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", reason: "no-eligible-reviewer" })]);
  });

  it("reads unroutable with the chain's reason when the item has no live Workroom", async () => {
    const resolveOwner = createSweepOwnerResolver({
      db: grantDb(grantRows("AGT-WS-ACCEPT")),
      ports: terminalPorts({ loadLiveRooms: vi.fn(async () => []) }),
    });
    const result = await projectOwedAcceptance({ decision, authorAgentId: null, resolveOwner });
    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([expect.objectContaining({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", reason: "workroom-not-found" })]);
  });
});

describe("createSweepOwnerResolver: only in-platform coworkers own acceptance (BI-C1781121)", () => {
  it("never names an external CLI agent: the first in-platform holder owns it instead", async () => {
    const resolveOwner = createSweepOwnerResolver({
      db: grantDb([...grantRows("AGT-EXT-CLAUDE"), ...grantRows("AGT-WS-BUILD")], ["AGT-EXT-CLAUDE"]),
      ports: terminalPorts(),
    });
    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });
    expect(result.owner).toEqual({ agentId: "AGT-WS-BUILD", displayName: "AGT-WS-BUILD name", codes: ["ACCEPTANCE_EVIDENCE_REQUIRED"] });
    expect(result.unroutable).toEqual([]);
  });

  it("reports no-in-platform-coworker, naming the external holders, when only they hold the lane", async () => {
    const resolveOwner = createSweepOwnerResolver({
      db: grantDb([...grantRows("AGT-EXT-CLAUDE"), ...grantRows("AGT-EXT-CODEX")], ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX"]),
      ports: terminalPorts(),
    });
    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });
    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([expect.objectContaining({
      code: "ACCEPTANCE_EVIDENCE_REQUIRED",
      reason: "no-in-platform-coworker",
      nextAction: expect.stringMatching(/^AGT-EXT-CLAUDE, AGT-EXT-CODEX hold initiative_evidence_write .*do not route it to a person/),
    })]);
  });

  it("treats an agent with no recorded execution runtime as not runnable in-platform", async () => {
    const db = grantDb(grantRows("AGT-WS-NORUNTIME"));
    db.agent.findMany = vi.fn(async () => [{ agentId: "AGT-WS-NORUNTIME", executionConfig: null }]) as never;
    const resolveOwner = createSweepOwnerResolver({ db, ports: terminalPorts() });
    const result = await projectOwedAcceptance({ decision, authorAgentId: null, resolveOwner });
    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([expect.objectContaining({ reason: "no-in-platform-coworker" })]);
  });

  it("keeps no-eligible-reviewer when the only holder is the author, even if it runs in-platform", async () => {
    const resolveOwner = createSweepOwnerResolver({ db: grantDb(grantRows("AGT-A-AUTHOR")), ports: terminalPorts() });
    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });
    expect(result.unroutable).toEqual([expect.objectContaining({ reason: "no-eligible-reviewer" })]);
  });
});

describe("authorAgentIdFrom", () => {
  it("prefers the newest room's assistant, then the claim, then the item's agent", () => {
    const item = { claimedByAgentId: "AGT-CLAIM", agentId: "AGT-ITEM" };
    expect(authorAgentIdFrom([{ agentId: null }, { agentId: "AGT-ROOM" }], item)).toBe("AGT-ROOM");
    expect(authorAgentIdFrom([], item)).toBe("AGT-CLAIM");
    expect(authorAgentIdFrom([], { claimedByAgentId: null, agentId: "AGT-ITEM" })).toBe("AGT-ITEM");
    expect(authorAgentIdFrom([], { claimedByAgentId: null, agentId: null })).toBeNull();
  });
});

describe("evaluateOwedAcceptance", () => {
  const item = { id: "row-3", itemId: "BI-AA000003", claimedByAgentId: null, agentId: null };

  it("projects the item's completion decision with its author excluded", async () => {
    const resolveOwner = vi.fn().mockResolvedValue({ reviewerRoutes: [], escalations: [], unroutable: [] });
    const loadCompletionDecision = vi.fn().mockResolvedValue(decision);
    const result = await evaluateOwedAcceptance(item, {
      loadAuthorAgentId: vi.fn().mockResolvedValue("AGT-A-AUTHOR"),
      loadDeliveryActorIds: vi.fn().mockResolvedValue({ ok: true, data: ["AGT-OLDER-DELIVERER"] }),
      loadCompletionDecision,
      resolveOwner,
    });
    expect(loadCompletionDecision).toHaveBeenCalledWith("BI-AA000003", "AGT-A-AUTHOR");
    expect(resolveOwner.mock.calls[0]![0].authorAgentId).toBe("AGT-A-AUTHOR");
    expect(result?.owed.map((entry) => entry.code)).toEqual(["ACCEPTANCE_EVIDENCE_REQUIRED"]);
  });

  it("returns null when readiness cannot be computed", async () => {
    const result = await evaluateOwedAcceptance(item, {
      loadAuthorAgentId: vi.fn().mockResolvedValue(null),
      loadDeliveryActorIds: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      loadCompletionDecision: vi.fn().mockResolvedValue(null),
      resolveOwner: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it("BI-099A0BA3 (M1): excludes every delivery actor, and evaluates nothing when they cannot be read", async () => {
    const resolveOwner = vi.fn().mockResolvedValue({ reviewerRoutes: [], escalations: [], unroutable: [] });
    await evaluateOwedAcceptance(item, {
      loadAuthorAgentId: vi.fn().mockResolvedValue("AGT-A-AUTHOR"),
      loadDeliveryActorIds: vi.fn().mockResolvedValue({ ok: true, data: ["AGT-OLDER-DELIVERER"] }),
      loadCompletionDecision: vi.fn().mockResolvedValue(decision),
      resolveOwner,
    });
    expect(resolveOwner.mock.calls[0]![0].excludedAgentIds).toEqual(["AGT-A-AUTHOR", "AGT-OLDER-DELIVERER"]);

    await expect(evaluateOwedAcceptance(item, {
      loadAuthorAgentId: vi.fn().mockResolvedValue("AGT-A-AUTHOR"),
      loadDeliveryActorIds: vi.fn().mockResolvedValue({ ok: false, error: "unbounded" }),
      loadCompletionDecision: vi.fn().mockResolvedValue(decision),
      resolveOwner,
    })).rejects.toThrow(/delivery actors/);
  });
});

// BI-7C7E8CAC: a small or break-fix item's acceptance and delivery evidence are
// owed by the delivery-coordinator and recorded with record_execution_evidence,
// not through objective mapping. The terminal chain answers that lane with an
// author-facing escalation (shape-lane-escalations.ts) and no reviewer route, so
// the sweep named nobody for the bulk of the awaiting pool. The sweep resolves
// the lane's owner from the grant that authorizes record_execution_evidence.
describe("createSweepOwnerResolver: the small-shape execution-evidence lane (BI-7C7E8CAC)", () => {
  const smallDecision: InitiativeReadinessDecision = {
    ...decision,
    profile: "fix",
    shapeDecision: { declared: "small", effective: "small", sensitivity: null, raised: false },
    unmet: [
      readinessRequirement({ code: "DELIVERY_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator" }),
      readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator" }),
    ],
  };
  const breakFixDecision: InitiativeReadinessDecision = {
    ...decision,
    profile: "fix",
    shapeDecision: { declared: "break-fix", effective: "break-fix", sensitivity: null, raised: false },
    unmet: [readinessRequirement({ code: "DELIVERY_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator" })],
  };

  function holder(agentId: string, grantKey: string) {
    return { grantKey, agent: { agentId, displayName: `${agentId} name`, status: "active", archived: false, lifecycleStage: "production" } };
  }

  it("names an in-platform coworker holding the record_execution_evidence grant as owner of a small item's acceptance", async () => {
    const ports = terminalPorts();
    const resolveOwner = createSweepOwnerResolver({
      db: grantDb([
        holder("AGT-A-AUTHOR", "backlog_write"),
        holder("AGT-EXT-CLAUDE", "build_evidence"),
        holder("AGT-WS-OPS", "backlog_write"),
        holder("AGT-WS-BUILD", "build_evidence"),
      ], ["AGT-EXT-CLAUDE"]),
      ports,
    });
    const result = await projectOwedAcceptance({ decision: smallDecision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });

    // Deterministic: the lowest agent id among eligible holders, never the author or an external agent.
    expect(result.owner).toEqual({
      agentId: "AGT-WS-BUILD",
      displayName: "AGT-WS-BUILD name",
      codes: ["DELIVERY_EVIDENCE_REQUIRED", "ACCEPTANCE_EVIDENCE_REQUIRED"],
    });
    expect(result.unroutable).toEqual([]);
    // The lane uses no Workroom, baseline or objective mapping.
    expect(ports.loadLiveRooms).not.toHaveBeenCalled();
  });

  it("asks for exactly the grants that authorize record_execution_evidence, active production holders only", async () => {
    const db = grantDb([holder("AGT-WS-BUILD", "build_evidence")]);
    const resolveOwner = createSweepOwnerResolver({ db, ports: terminalPorts() });
    await projectOwedAcceptance({ decision: smallDecision, authorAgentId: null, resolveOwner });
    expect(db.agentToolGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        grantKey: { in: ["backlog_write", "build_evidence"] },
        agent: { status: "active", archived: false, lifecycleStage: "production" },
      },
    }));
  });

  it("owns a break-fix item's delivery evidence the same way", async () => {
    const resolveOwner = createSweepOwnerResolver({ db: grantDb([holder("AGT-WS-OPS", "backlog_write")]), ports: terminalPorts() });
    const result = await projectOwedAcceptance({ decision: breakFixDecision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });
    expect(result.owner).toEqual({ agentId: "AGT-WS-OPS", displayName: "AGT-WS-OPS name", codes: ["DELIVERY_EVIDENCE_REQUIRED"] });
  });

  it("BI-099A0BA3 (M1): never names a delivery actor other than the guessed author for a small item", async () => {
    // AGT-WS-BUILD delivered in an older room; a newer room made AGT-A-AUTHOR the guessed author.
    const db = grantDb([
      holder("AGT-A-AUTHOR", "backlog_write"),
      holder("AGT-WS-BUILD", "build_evidence"),
      holder("AGT-WS-OPS", "backlog_write"),
    ]);
    const resolveOwner = createSweepOwnerResolver({ db, ports: terminalPorts() });
    const result = await projectOwedAcceptance({
      decision: smallDecision, authorAgentId: "AGT-A-AUTHOR", excludedAgentIds: ["AGT-WS-BUILD"], resolveOwner,
    });
    expect(result.owner?.agentId).toBe("AGT-WS-OPS");

    const onlyDeliverers = createSweepOwnerResolver({
      db: grantDb([holder("AGT-A-AUTHOR", "backlog_write"), holder("AGT-WS-BUILD", "build_evidence")]),
      ports: terminalPorts(),
    });
    const none = await projectOwedAcceptance({
      decision: smallDecision, authorAgentId: "AGT-A-AUTHOR", excludedAgentIds: ["AGT-WS-BUILD"], resolveOwner: onlyDeliverers,
    });
    expect(none.owner).toBeNull();
    expect(none.unroutable.map((entry) => entry.reason)).toEqual(["no-eligible-reviewer", "no-eligible-reviewer"]);
  });

  it("never names the author: the lane reads no-eligible-reviewer when the author is its only holder", async () => {
    const resolveOwner = createSweepOwnerResolver({ db: grantDb([holder("AGT-A-AUTHOR", "backlog_write")]), ports: terminalPorts() });
    const result = await projectOwedAcceptance({ decision: smallDecision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });
    expect(result.owner).toBeNull();
    expect(result.unroutable.map((entry) => [entry.code, entry.reason])).toEqual([
      ["DELIVERY_EVIDENCE_REQUIRED", "no-eligible-reviewer"],
      ["ACCEPTANCE_EVIDENCE_REQUIRED", "no-eligible-reviewer"],
    ]);
  });

  it("never names an external agent: the lane reads no-in-platform-coworker, naming the external holders", async () => {
    const resolveOwner = createSweepOwnerResolver({
      db: grantDb([holder("AGT-EXT-CLAUDE", "backlog_write"), holder("AGT-EXT-CODEX", "build_evidence")], ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX"]),
      ports: terminalPorts(),
    });
    const result = await projectOwedAcceptance({ decision: smallDecision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });
    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([
      expect.objectContaining({ code: "DELIVERY_EVIDENCE_REQUIRED", reason: "no-in-platform-coworker", nextAction: expect.stringMatching(/^AGT-EXT-CLAUDE, AGT-EXT-CODEX .*record_execution_evidence/) }),
      expect.objectContaining({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", reason: "no-in-platform-coworker" }),
    ]);
  });

  it("does not hand the lane's owner another delivery-coordinator code it cannot record", async () => {
    const withCapsule: InitiativeReadinessDecision = {
      ...smallDecision,
      blockers: [readinessRequirement({ code: "CAPSULE_IDENTITY_MISMATCH", state: "blocked", accountableRole: "delivery-coordinator" })],
    };
    const resolveOwner = createSweepOwnerResolver({ db: grantDb([holder("AGT-WS-BUILD", "build_evidence")]), ports: terminalPorts() });
    const result = await projectOwedAcceptance({ decision: withCapsule, authorAgentId: null, resolveOwner });
    expect(result.owner?.codes).toEqual(["DELIVERY_EVIDENCE_REQUIRED", "ACCEPTANCE_EVIDENCE_REQUIRED"]);
    expect(result.unroutable).toEqual([expect.objectContaining({ code: "CAPSULE_IDENTITY_MISMATCH", reason: "no-writer-lane" })]);
  });

  it("leaves a medium item's delivery evidence where it was: no writer lane", async () => {
    const medium: InitiativeReadinessDecision = {
      ...decision,
      shapeDecision: { declared: "medium", effective: "medium", sensitivity: null, raised: false },
      unmet: [readinessRequirement({ code: "DELIVERY_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator" })],
    };
    const resolveOwner = createSweepOwnerResolver({ db: grantDb([holder("AGT-WS-BUILD", "build_evidence")]), ports: terminalPorts() });
    const result = await projectOwedAcceptance({ decision: medium, authorAgentId: null, resolveOwner });
    expect(result.owner).toBeNull();
  });
});
