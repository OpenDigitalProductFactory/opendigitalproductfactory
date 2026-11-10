// BI-099A0BA3: in an acceptance steward room's scheduled run,
// record_initiative_evidence writes only the objective mapping the platform
// issued to the room, with the binding taken from the server, never the model.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok } from "@/lib/shared/action-result";

const mocks = vi.hoisted(() => ({
  findTaskRun: vi.fn(),
  stewardBinding: vi.fn(),
  recordGateReceipt: vi.fn(),
  recordObjectiveMapping: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique: (...args: unknown[]) => mocks.findTaskRun(...args) },
    toolExecution: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/backlog/initiative-readiness", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness")>(),
  recordInitiativeGateReceipt: (...args: unknown[]) => mocks.recordGateReceipt(...args),
  recordInitiativeObjectiveMappingProposal: (...args: unknown[]) => mocks.recordObjectiveMapping(...args),
}));

vi.mock("@/lib/backlog/acceptance-sweep/steward-objective-mapping-authority", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/backlog/acceptance-sweep/steward-objective-mapping-authority")>(),
  resolveAcceptanceStewardRunBinding: (...args: unknown[]) => mocks.stewardBinding(...args),
}));

import { initiativeReadinessPack } from "./initiative-readiness-pack";

const binding = {
  writerToolName: "record_initiative_evidence",
  itemId: "BI-ROUTED",
  gate: "objective-mapping",
  expectedCurrentBaselineId: "baseline-current",
  eligibleEvidenceActivityIds: ["E-1", "E-2"],
  workroomRef: { kind: "workroom-head", workroomId: "WC-DELIVERY", repositoryFullName: "o/r", branchName: "fix/x", headSha: "a".repeat(40) },
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "o/r", commitSha: "b".repeat(40), path: "docs/design.md", providerBlobId: "c".repeat(40) },
};

const context = { taskRunId: "TR-SCHED-ABCD1234", agentId: "AGT-WS-VERIFY", authorityDecisionId: "AUTH-1" } as never;
const handler = () => initiativeReadinessPack.handlers.record_initiative_evidence!;

describe("record_initiative_evidence in an acceptance steward run (BI-099A0BA3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A scheduled run carries no external review binding.
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: "workroom-WC-ACC-ROUTED-acceptance-verification" } } });
    mocks.recordObjectiveMapping.mockResolvedValue({ ...ok(), proposalId: "MAP-1" });
  });

  it("writes the mapping with the item, baseline and evidence set the platform issued, ignoring model-supplied ones", async () => {
    mocks.stewardBinding.mockResolvedValue({ ok: true, data: { itemId: "BI-ROUTED", binding } });

    const result = await handler()({
      operation: "objective-mapping",
      baselineId: "baseline-spoofed",
      objectiveMappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-1"] }],
      reason: "Verified on the live install.",
    }, "user-operator", context);

    expect(result).toMatchObject({ success: true });
    expect(mocks.stewardBinding).toHaveBeenCalledWith("TR-SCHED-ABCD1234");
    expect(mocks.recordObjectiveMapping).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-SCHED-ABCD1234",
      itemId: "BI-ROUTED",
      baselineId: "baseline-current",
      eligibleEvidenceActivityIds: ["E-1", "E-2"],
      proposerAgentId: "AGT-WS-VERIFY",
    }));
  });

  it("refuses when the room holds no current platform-issued packet, and writes nothing", async () => {
    mocks.stewardBinding.mockResolvedValue({ ok: false, error: "refused", reason: "packet-not-issued" });

    const result = await handler()({
      operation: "objective-mapping",
      itemId: "BI-ROUTED",
      baselineId: "baseline-current",
      objectiveMappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-1"] }],
      reason: "x",
    }, "user-operator", context);

    expect(result).toMatchObject({ success: false, error: "objective-mapping-packet-unavailable" });
    expect(mocks.recordObjectiveMapping).not.toHaveBeenCalled();
  });

  it("refuses any other operation from a steward room", async () => {
    mocks.stewardBinding.mockResolvedValue({ ok: true, data: { itemId: "BI-ROUTED", binding } });

    const result = await handler()({
      gate: "classification", decision: "pass", itemId: "BI-ROUTED", reason: "x",
      artifactRef: binding.artifactRef,
    }, "user-operator", context);

    expect(result).toMatchObject({ success: false, error: "steward-room-objective-mapping-only" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
  });

  it("refuses a model-named item other than the one the packet binds", async () => {
    mocks.stewardBinding.mockResolvedValue({ ok: true, data: { itemId: "BI-ROUTED", binding } });

    const result = await handler()({
      operation: "objective-mapping",
      itemId: "BI-ELSEWHERE",
      objectiveMappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-1"] }],
      reason: "x",
    }, "user-operator", context);

    expect(result).toMatchObject({ success: false, error: "steward-room-objective-mapping-only" });
    expect(mocks.recordObjectiveMapping).not.toHaveBeenCalled();
  });

  it("leaves every other run untouched: a non-steward run reaches the existing path", async () => {
    mocks.stewardBinding.mockResolvedValue(null);
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "interactive" } });

    await handler()({
      operation: "objective-mapping",
      itemId: "BI-ANY",
      baselineId: "baseline-x",
      objectiveMappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-1"] }],
      reason: "x",
    }, "user-1", { taskRunId: "TR-CHAT-1", agentId: "AGT-X", authorityDecisionId: "AUTH-1", tokenScope: "write" } as never);

    expect(mocks.recordObjectiveMapping).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-ANY", baselineId: "baseline-x", eligibleEvidenceActivityIds: [],
    }));
  });
});
