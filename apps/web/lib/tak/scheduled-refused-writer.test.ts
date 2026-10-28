// BI-CAP-B5F50D1F — a governed writer that was CALLED and refused is not a
// writer that was "attached to the run and not called".
//
// Live, 2026-10-28: ten post-implementation review runs were filed as
// "required governed tool record_initiative_post_implementation_review executed
// zero times; it was attached to the run and not called". ToolExecution shows
// every one of the redundant re-runs called the writer and was refused
// platform-review-packet-unavailable, and WC-PIR-76B35820 called it four times
// (malformed-receipt, terminal_reader_identity_conflict). The verdict sent
// operators looking for a model refusal or a missing tool that did not exist.
import { describe, expect, it } from "vitest";

import { detectScheduledRequiredToolFailure, scheduledRequiredToolCorrection } from "./scheduled-task-runs";

const WRITER = { name: "record_initiative_post_implementation_review", sideEffect: true };
const EVIDENCE = { name: "record_workroom_evidence", sideEffect: true };
const PROMPT = "Read the bound change with read_source_at_version. Then call record_initiative_post_implementation_review with gate \"post-implementation-review\". Then record record_workroom_evidence in this room.";
const refused = (error: string) => ({ name: WRITER.name, result: { success: false, error } });
const evidence = { name: EVIDENCE.name, result: { success: true } };

describe("detectScheduledRequiredToolFailure for a refused writer", () => {
  it("names the refusal instead of claiming the writer was not called (the 12:00 re-run)", () => {
    const verdict = detectScheduledRequiredToolFailure({
      prompt: PROMPT, authorizedTools: [WRITER, EVIDENCE], attachedToolNames: [WRITER.name, EVIDENCE.name],
      executedTools: [refused("platform-review-packet-unavailable"), evidence],
    });
    expect(verdict).toBe("required governed tool record_initiative_post_implementation_review was called 1 time and refused every time (platform-review-packet-unavailable)");
    expect(verdict).not.toMatch(/not called|zero times/);
  });

  it("lists each distinct refusal once, in call order (WC-PIR-76B35820)", () => {
    const verdict = detectScheduledRequiredToolFailure({
      prompt: PROMPT, authorizedTools: [WRITER, EVIDENCE], attachedToolNames: [WRITER.name, EVIDENCE.name],
      executedTools: [refused("malformed-receipt"), refused("terminal_reader_identity_conflict"), refused("terminal_reader_identity_conflict"), refused("malformed-receipt"), evidence],
    });
    expect(verdict).toBe("required governed tool record_initiative_post_implementation_review was called 4 times and refused every time (malformed-receipt, terminal_reader_identity_conflict)");
  });

  it("still says not called when the writer truly was not called", () => {
    expect(detectScheduledRequiredToolFailure({
      prompt: PROMPT, authorizedTools: [WRITER, EVIDENCE], attachedToolNames: [WRITER.name, EVIDENCE.name], executedTools: [evidence],
    })).toBe("required governed tool record_initiative_post_implementation_review executed zero times; it was attached to the run and not called");
  });

  it("names a refusal without an error code as unexplained", () => {
    expect(detectScheduledRequiredToolFailure({
      prompt: PROMPT, authorizedTools: [WRITER, EVIDENCE], executedTools: [{ name: WRITER.name, result: { success: false } }, evidence],
    })).toBe("required governed tool record_initiative_post_implementation_review was called 1 time and refused every time (no error code)");
  });
});

describe("scheduledRequiredToolCorrection for a refused writer", () => {
  it("does not tell a model that called the writer that it did not call it", () => {
    expect(scheduledRequiredToolCorrection({
      prompt: PROMPT, authorizedTools: [WRITER, EVIDENCE], attachedToolNames: [WRITER.name, EVIDENCE.name],
      executedTools: [refused("platform-review-packet-unavailable"), evidence],
    })).toBeNull();
  });

  it("still corrects a model that never called it", () => {
    expect(scheduledRequiredToolCorrection({
      prompt: PROMPT, authorizedTools: [WRITER, EVIDENCE], attachedToolNames: [WRITER.name, EVIDENCE.name], executedTools: [evidence],
    })?.toolName).toBe(WRITER.name);
  });
});
