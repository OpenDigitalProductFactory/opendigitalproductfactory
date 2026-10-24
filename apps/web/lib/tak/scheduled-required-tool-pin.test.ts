// A named governed writer must be ATTACHED, not discovered (BI-4A394B21).
//
// Live evidence, WC-A69BCABB on 2026-09-15. The dispatched coworker ran a full
// agent loop (64 messages) and reported, verbatim:
//
//   "Status: Tools mismatch — the tools you listed don't match what's actually
//    available to me. I attempted to call surface_list, surface_snapshot,
//    surface_open, surface_query, surface_act, load_tools, and search_knowledge
//    — none of ..."
//
// and the run was failed for `record_workroom_evidence executed zero times`.
// The grant existed (workroom_evidence_write). The tool was authorized. It was
// simply never attached to the run, and the marketplace lookup did not surface
// it, so the model could not reach the one tool its brief required.
//
// With a richer brief the same gap produced something worse than an error: the
// coworker answered "Sweep completed — 0 vulnerability findings, 0 CISA KEV
// exposures, estate is clean", fabricating specific counts with no tool call.

import { describe, expect, it } from "vitest";

import { scheduledRequiredToolNames } from "./scheduled-task-runs";

const EVIDENCE = { name: "record_workroom_evidence", sideEffect: true };
const READ_ONLY = { name: "get_workroom", sideEffect: false };
const UNRELATED = { name: "create_backlog_item", sideEffect: true };

// The brief the drive actually sends, abbreviated.
const WORKROOM_BRIEF = `You are executing one stage of a standing Workroom activity.
Room: WC-A69BCABB
This stage is done when: Every advisory source in scope has been read.
Before you finish, record what you did by calling record_workroom_evidence with capsuleId "WC-A69BCABB", stageKey "sweep", and kind "assurance-run".`;

describe("scheduledRequiredToolNames", () => {
  it("pins the governed writer the brief names", () => {
    expect(
      scheduledRequiredToolNames({
        prompt: WORKROOM_BRIEF,
        authorizedTools: [EVIDENCE, READ_ONLY, UNRELATED],
      }),
    ).toEqual(["record_workroom_evidence"]);
  });

  it("does not pin a side-effecting tool the prompt never mentions", () => {
    // Pinning everything would defeat the attachment budget the cap exists for.
    expect(
      scheduledRequiredToolNames({ prompt: WORKROOM_BRIEF, authorizedTools: [UNRELATED] }),
    ).toEqual([]);
  });

  it("does not pin a read-only tool, even when named", () => {
    // The budget is for governed writers; reads load on demand safely.
    expect(
      scheduledRequiredToolNames({
        prompt: "call get_workroom first",
        authorizedTools: [READ_ONLY],
      }),
    ).toEqual([]);
  });

  it("only pins tools the caller is authorized for", () => {
    // Authorization is upstream; an unauthorized name must never be pinned in.
    expect(scheduledRequiredToolNames({ prompt: WORKROOM_BRIEF, authorizedTools: [] })).toEqual([]);
  });

  it("is case-insensitive and de-duplicated", () => {
    expect(
      scheduledRequiredToolNames({
        prompt: "RECORD_WORKROOM_EVIDENCE twice: record_workroom_evidence",
        authorizedTools: [EVIDENCE],
      }),
    ).toEqual(["record_workroom_evidence"]);
  });

  it("agrees with the post-hoc verdict about what was required", async () => {
    // One rule, two uses. If these ever diverge, a run can be failed for a tool
    // the pin never attached — which is exactly the live defect.
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    const authorizedTools = [EVIDENCE, READ_ONLY, UNRELATED];
    const pinned = scheduledRequiredToolNames({ prompt: WORKROOM_BRIEF, authorizedTools });
    const verdict = classifyScheduledRequiredTools({
      prompt: WORKROOM_BRIEF,
      authorizedTools,
      executedTools: [],
    });
    // Nothing executed, so the verdict must name the tool as absent — and the
    // pin must be attaching that same tool.
    expect(verdict.kind).toBe("absent");
    if (verdict.kind === "executed") throw new Error("expected an absent verdict");
    expect(pinned).toContain(verdict.toolName);
  });
});
