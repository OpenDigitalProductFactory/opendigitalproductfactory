// BI-A8679D84 — a scheduled run whose required governed writer executed zero
// times never ends `completed`, and a provider-busy reply is a requeue, not a
// writer the model "would not call".
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));

import { forcedToolRoute } from "./forced-tool-choice";
import {
  classifyScheduledRequiredTools,
  detectScheduledRunFailure,
  scheduledRequiredToolCorrection,
  scheduledRunProviderDeferral,
} from "./scheduled-task-runs";

const WRITER = "record_workroom_evidence";
const STAGE_CONFIG = { workroomStage: { shapeKey: "delivery-medium", shapeVersion: "1.0.0", stageKey: "design-note", tools: [] } };
const BRIEF_NAMING_WRITER = `Your stage: design-note\nBefore you finish, record what you did by calling ${WRITER} with capsuleId "WC-1".`;
const BRIEF_SILENT = "Your stage: design-note\nDo the work with your tools.";
const READER = { name: "get_backlog_item", sideEffect: false };

describe("the verdict requires a Workroom stage's writer whatever the authorized set says (BI-A8679D84 regression of BI-4A394B21)", () => {
  // The reintroducing path, live DEV 2026-10-15→10-22: 804 build-specialist
  // stage runs `completed` with executedToolCount=0. Their briefs named the
  // writer, but it was not in the authorized set, so nothing was required.
  it("is absent when the writer was not authorized and nothing ran", () => {
    expect(classifyScheduledRequiredTools({
      prompt: BRIEF_NAMING_WRITER, authorizedTools: [READER], executedTools: [], taskConfig: STAGE_CONFIG,
    })).toEqual({ kind: "absent", toolName: WRITER });
  });

  it("is absent when the brief does not name the writer and nothing ran", () => {
    expect(classifyScheduledRequiredTools({
      prompt: BRIEF_SILENT, authorizedTools: [READER, { name: WRITER, sideEffect: true }], executedTools: [], taskConfig: STAGE_CONFIG,
    })).toEqual({ kind: "absent", toolName: WRITER });
  });

  it("names the writer in the failure the run is recorded with", () => {
    expect(detectScheduledRunFailure({
      prompt: BRIEF_SILENT, authorizedTools: [READER, { name: WRITER, sideEffect: true }],
      executedTools: [], content: "Done.", attachedToolNames: [WRITER], taskConfig: STAGE_CONFIG,
    })).toBe(`required governed tool ${WRITER} executed zero times; it was attached to the run and not called`);
  });

  it("is executed when the writer ran", () => {
    expect(classifyScheduledRequiredTools({
      prompt: BRIEF_SILENT, authorizedTools: [READER], taskConfig: STAGE_CONFIG,
      executedTools: [{ name: WRITER, result: { success: true } }],
    })).toEqual({ kind: "executed" });
  });

  it("leaves a run that is not a Workroom stage judged on the writers its prompt names", () => {
    expect(classifyScheduledRequiredTools({
      prompt: "Summarize the week.", authorizedTools: [READER], executedTools: [],
    })).toEqual({ kind: "executed" });
  });

  it("corrects a stage run whose brief did not name its attached writer", () => {
    expect(scheduledRequiredToolCorrection({
      prompt: BRIEF_SILENT, authorizedTools: [READER, { name: WRITER, sideEffect: true }],
      attachedToolNames: [WRITER], executedTools: [], taskConfig: STAGE_CONFIG,
    })?.toolName).toBe(WRITER);
  });
});

describe("scheduledRunProviderDeferral (BI-A8679D84)", () => {
  const absent = { kind: "absent", toolName: WRITER } as const;

  it("requeues the loop's typed busy and capacity dead ends", () => {
    expect(scheduledRunProviderDeferral({ failure: { kind: "busy" }, content: "x", requiredTools: absent, executedToolCount: 0 })).toBe("rate-limit");
    expect(scheduledRunProviderDeferral({ failure: { kind: "capacity" }, content: "x", requiredTools: absent, executedToolCount: 0 })).toBe("provider-unavailable");
  });

  it("reads the live provider-busy reply when the loop carried no typed failure", () => {
    expect(scheduledRunProviderDeferral({
      content: "Every AI provider is busy right now — usually rate-limited or briefly overloaded. Nothing is misconfigured.",
      requiredTools: absent, executedToolCount: 0,
    })).toBe("rate-limit");
  });

  it("does not requeue a run whose writer ran, or one parked on an approval", () => {
    expect(scheduledRunProviderDeferral({ failure: { kind: "busy" }, content: "x", requiredTools: { kind: "executed" }, executedToolCount: 1 })).toBeNull();
    expect(scheduledRunProviderDeferral({ failure: { kind: "busy" }, content: "x", requiredTools: { kind: "proposed", toolName: WRITER }, executedToolCount: 1 })).toBeNull();
  });

  it("does not requeue a typed failure that waiting does not fix", () => {
    for (const kind of ["execution-uncertain", "unknown", "credentials", "required-terminal-writer-not-enforceable"]) {
      expect(scheduledRunProviderDeferral({ failure: { kind }, content: "Every AI provider is busy right now — rate-limited.", requiredTools: absent, executedToolCount: 0 })).toBeNull();
    }
  });

  it("does not requeue a model that answered in prose", () => {
    expect(scheduledRunProviderDeferral({ content: "I reviewed the room. Status: done.", requiredTools: absent, executedToolCount: 0 })).toBeNull();
  });
});

describe("forcedToolRoute (BI-A8679D84)", () => {
  const writerTool = { type: "function", function: { name: WRITER, parameters: {} } };
  const readerTool = { type: "function", function: { name: "get_backlog_item", parameters: {} } };

  it("forces the sole writer until it has been attempted", () => {
    expect(forcedToolRoute(WRITER, [{ name: "get_backlog_item" }], [readerTool, writerTool])).toEqual({
      tools: [writerTool], toolChoice: "required", terminalWriterToolName: WRITER,
    });
  });

  it("releases the choice and restores the surface once the writer was attempted", () => {
    expect(forcedToolRoute(WRITER, [{ name: WRITER }], [readerTool, writerTool])).toEqual({
      tools: [readerTool, writerTool], toolChoice: undefined, terminalWriterToolName: undefined,
    });
  });

  it("forces nothing when the writer is not on the provider surface", () => {
    expect(forcedToolRoute(WRITER, [], [readerTool])).toBeNull();
  });
});
