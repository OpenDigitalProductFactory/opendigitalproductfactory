// BI-62DB6C03 — a Workroom stage run's evidence writer is offered, or the run
// is not dispatched; and a model that wrongly says it is missing is corrected.
//
// Live evidence, 2026-10-21 13:47Z, TR-SCHED-B95B0F30 (adopter health watch,
// customer-advisor, codex/gpt-5.6-luna): "the required evidence-recording
// action is unavailable". It was offered — the archived prompts of the same
// coworker's 14:22Z failure list record_workroom_evidence second under
// "Tools:", and every /ops/workrooms turn in seven days attached 15 tools with
// the writer pinned. 40 failures in seven days were this false claim. The
// other direction was silent: the verdict only counted the writer as required
// when it was authorized, so a run offered no writer was recorded ok.
import { describe, expect, it } from "vitest";

import {
  detectScheduledRunFailure,
  scheduledMandatoryToolGap,
  scheduledMandatoryToolNames,
  scheduledRequiredToolCorrection,
} from "./scheduled-task-runs";

const EVIDENCE = { name: "record_workroom_evidence", sideEffect: true };
const READER = { name: "list_customer_accounts", sideEffect: false };
const STAGE_CONFIG = {
  workroomStage: { shapeKey: "adopter-health-watch", shapeVersion: "1.0.0", stageKey: "report", tools: ["list_customer_accounts"] },
};
const BRIEF = `You are executing one stage of a standing Workroom activity.
Room: WC-0A92C30D
Before you finish, record what you did by calling record_workroom_evidence with capsuleId "WC-0A92C30D", stageKey "report", kind "assurance-finding", and outcome "completed".`;

describe("scheduledMandatoryToolNames", () => {
  it("a Workroom stage run must be offered record_workroom_evidence", () => {
    expect(scheduledMandatoryToolNames({ prompt: "Read the accounts.", taskConfig: STAGE_CONFIG }))
      .toEqual(["record_workroom_evidence"]);
    expect(scheduledMandatoryToolNames({ prompt: BRIEF })).toEqual(["record_workroom_evidence"]);
  });

  it("an ordinary scheduled task has no mandatory writer", () => {
    expect(scheduledMandatoryToolNames({ prompt: "Refresh the campaign brief." })).toEqual([]);
    // A longer name that merely contains the writer's name is not the writer.
    expect(scheduledMandatoryToolNames({ prompt: "call record_workroom_evidence_v2" })).toEqual([]);
  });
});

describe("scheduledMandatoryToolGap — the run is not dispatched without its writer", () => {
  it("an advise boundary withholds the writer, so the stage is not dispatched in advise mode", () => {
    const gap = scheduledMandatoryToolGap({
      prompt: BRIEF, taskConfig: STAGE_CONFIG, mode: "advise", attached: [READER], deferred: [],
    });
    expect(gap).toMatch(/record_workroom_evidence/);
    expect(gap).toMatch(/advise/);
  });

  it("an act run without the grant names the missing authority", () => {
    const gap = scheduledMandatoryToolGap({
      prompt: BRIEF, taskConfig: STAGE_CONFIG, mode: "act", attached: [READER], deferred: [],
    });
    expect(gap).toMatch(/record_workroom_evidence/);
    expect(gap).toMatch(/not authorized/);
  });

  it("an authorized writer left outside the attachment budget is also a gap", () => {
    const gap = scheduledMandatoryToolGap({
      prompt: BRIEF, taskConfig: STAGE_CONFIG, mode: "act", attached: [READER], deferred: [EVIDENCE],
    });
    expect(gap).toMatch(/attachment budget/);
  });

  it("an attached writer is no gap", () => {
    expect(scheduledMandatoryToolGap({
      prompt: BRIEF, taskConfig: STAGE_CONFIG, mode: "act", attached: [READER, EVIDENCE], deferred: [],
    })).toBeNull();
  });
});

describe("scheduledRequiredToolCorrection — one correction for a writer offered but not called", () => {
  it("names the attached writer and tells the model to call it, or record blocked", () => {
    const correction = scheduledRequiredToolCorrection({
      prompt: BRIEF, authorizedTools: [READER, EVIDENCE], attachedToolNames: ["list_customer_accounts", "record_workroom_evidence"],
      executedTools: [{ name: "list_customer_accounts", result: { success: true } }],
    });
    expect(correction?.toolName).toBe("record_workroom_evidence");
    expect(correction?.message).toMatch(/record_workroom_evidence is attached to this run/);
    expect(correction?.message).toMatch(/outcome "blocked"/);
  });

  it("no correction once the writer ran", () => {
    expect(scheduledRequiredToolCorrection({
      prompt: BRIEF, authorizedTools: [EVIDENCE], attachedToolNames: ["record_workroom_evidence"],
      executedTools: [{ name: "record_workroom_evidence", result: { success: true } }],
    })).toBeNull();
  });

  it("no correction for a writer that was not attached (the pre-dispatch gap owns that)", () => {
    expect(scheduledRequiredToolCorrection({
      prompt: BRIEF, authorizedTools: [EVIDENCE], attachedToolNames: [], executedTools: [],
    })).toBeNull();
  });
});

describe("the zero-execution verdict says the writer was offered", () => {
  it("an attached writer the model never called is not reported as unavailable", () => {
    const failure = detectScheduledRunFailure({
      prompt: BRIEF, authorizedTools: [READER, EVIDENCE], executedTools: [], content: "blocked",
      attachedToolNames: ["record_workroom_evidence"],
    });
    expect(failure).toBe(
      "required governed tool record_workroom_evidence executed zero times; it was attached to the run and not called",
    );
  });

  it("without the attached set the message is unchanged", () => {
    expect(detectScheduledRunFailure({
      prompt: BRIEF, authorizedTools: [EVIDENCE], executedTools: [], content: "blocked",
    })).toBe("required governed tool record_workroom_evidence executed zero times");
  });
});
