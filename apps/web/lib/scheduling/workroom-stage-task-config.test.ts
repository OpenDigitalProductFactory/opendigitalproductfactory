// BI-43C3E914 — the Workroom stage record on taskConfig, and its isolation
// from the `trigger` record that shares the same JSON column.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readScheduledWorkTrigger, withScheduledWorkTrigger } from "@dpf/validators/workroom-policy/scheduled-work-trigger";
import {
  WORKROOM_STAGE_TASK_CONFIG_KEY,
  readWorkroomStageTaskConfig,
  withWorkroomStageTaskConfig,
  workroomStageToolsFromTaskConfig,
} from "./workroom-stage-task-config";

const STAGE = {
  shapeKey: "dependency-advisory-watch",
  shapeVersion: "1.0.0",
  stageKey: "sweep",
  tools: ["read_codebase_manifest", "list_patch_posture"],
};
const QUALIFICATION = { schemaVersion: 1 as const, phase: "prepare" as const, itemId: "BI-1", workroomId: "WC-1",
  repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha: "b".repeat(40),
  protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
  installationId: "install-dev", accountablePrincipalRef: "principal:owner",
  protocolReviewReceiptId: "review-protocol-1",
  shapeKey: STAGE.shapeKey, shapeVersion: STAGE.shapeVersion, stageKey: STAGE.stageKey, policyVersion: 1 as const,
  executorMode: "sandbox-build" as const, requiredPlatform: "linux" as const,
  targetProductionBlobIds: ["d".repeat(40)],
  permittedTools: ["read_codebase_manifest", "list_patch_posture", "write_sandbox_file", "record_workroom_evidence"],
  allowedPaths: ["apps/web/lib/qualification.test.ts"], issuedAt: "2026-01-28T19:00:00.000Z",
  expiresAt: new Date(Date.now() + 60_000).toISOString(), maxStarts: 1 as const, maxDurationMs: 600_000 };

describe("workroom stage taskConfig record", () => {
  it("round-trips through the reader", () => {
    expect(readWorkroomStageTaskConfig(withWorkroomStageTaskConfig(null, STAGE))).toEqual(STAGE);
    expect(workroomStageToolsFromTaskConfig(withWorkroomStageTaskConfig({}, STAGE))).toEqual(STAGE.tools);
  });
  it("preserves every other taskConfig key, including a trigger", () => {
    const withTrigger = withScheduledWorkTrigger({ version: 2 }, { kind: "time" }, new Date("2026-09-01T00:00:00.000Z"));
    const next = withWorkroomStageTaskConfig(withTrigger, STAGE);
    expect(next.version).toBe(2);
    expect(readScheduledWorkTrigger(next)?.kind).toBe("time");
    expect(readWorkroomStageTaskConfig(next)).toEqual(STAGE);
  });
  it("is not misread as a trigger, and a trigger is not misread as a stage", () => {
    expect(readScheduledWorkTrigger(withWorkroomStageTaskConfig({}, STAGE))).toBeNull();
    expect(readWorkroomStageTaskConfig(withScheduledWorkTrigger({}, { kind: "detected-need" }))).toBeNull();
    expect(readScheduledWorkTrigger({ [WORKROOM_STAGE_TASK_CONFIG_KEY]: { ...STAGE, kind: "time" } })).toBeNull();
  });
  it("reads absent or malformed records as no stage, never throwing", () => {
    expect(readWorkroomStageTaskConfig(null)).toBeNull();
    expect(readWorkroomStageTaskConfig("nonsense")).toBeNull();
    expect(readWorkroomStageTaskConfig([STAGE])).toBeNull();
    expect(readWorkroomStageTaskConfig({ workroomStage: [] })).toBeNull();
    expect(readWorkroomStageTaskConfig({ workroomStage: { stageKey: "sweep" } })).toBeNull();
    expect(workroomStageToolsFromTaskConfig({ trigger: { kind: "time" } })).toEqual([]);
  });
  it("keeps only non-empty, unique tool names", () => {
    expect(readWorkroomStageTaskConfig({ workroomStage: { shapeKey: "s", stageKey: "x", tools: ["a", "", 3, "a", " b "] } })?.tools)
      .toEqual(["a", "b"]);
    expect(readWorkroomStageTaskConfig({ workroomStage: { shapeKey: "s", stageKey: "x" } })?.tools).toEqual([]);
  });
  it("narrows a qualification stage to its server-owned tool set", () => {
    const expected = [...STAGE.tools, "write_sandbox_file", "record_workroom_evidence"];
    const next = withWorkroomStageTaskConfig(null, { ...STAGE, tools: [...expected, "deploy_feature"],
      qualificationExperiment: QUALIFICATION });
    expect(workroomStageToolsFromTaskConfig(next)).toEqual(expected);
  });
  it("fails closed on a malformed qualification marker", () => {
    const next = { workroomStage: { ...STAGE, qualificationExperiment: { permittedTools: "list_patch_posture" } } };
    expect(readWorkroomStageTaskConfig(next)).toBeNull();
    expect(workroomStageToolsFromTaskConfig(next)).toEqual([]);
  });
});

describe("scheduler wiring", () => {
  const scheduler = readFileSync(join(__dirname, "../actions/agent-task-scheduler.ts"), "utf8");
  it("passes the stage's declared tools into scheduledToolsNeedingPin", () => {
    expect(scheduler).toMatch(/scheduledToolsNeedingPin\(\{[\s\S]*?taskConfig:\s*task\.taskConfig/);
  });
});
