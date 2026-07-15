import { describe, it, expect } from "vitest";
import {
  detectToolRefusedDespiteAvailability,
  buildToolRefusedDespiteAvailableNudge,
  appendToolRefusedRecoveryMessages,
  classifyToolRefusedIssue,
} from "./tool-refused-recovery";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";

describe("detectToolRefusedDespiteAvailability (clause 2.6)", () => {
  const tools = [{ name: "start_ideate_research" }, { name: "saveBuildEvidence" }];

  it("returns the tool name when response asserts unavailability of a delivered tool", () => {
    const out = detectToolRefusedDespiteAvailability(
      "Blocker: start_ideate_research is not available in the current runtime.",
      tools,
    );
    expect(out).toBe("start_ideate_research");
  });

  it("returns null when response does not assert unavailability", () => {
    const out = detectToolRefusedDespiteAvailability("I'll call start_ideate_research now.", tools);
    expect(out).toBeNull();
  });

  it("returns null when the named tool is not in the delivered list", () => {
    const out = detectToolRefusedDespiteAvailability(
      "I cannot call do_something_else because it's not available.",
      tools,
    );
    expect(out).toBeNull();
  });

  it("matches alternate phrasings", () => {
    expect(
      detectToolRefusedDespiteAvailability("saveBuildEvidence isn't enabled yet — pending grants.", tools),
    ).toBe("saveBuildEvidence");
  });

  it("returns the unspecified sentinel for generic 'currently []' refusals", () => {
    const out = detectToolRefusedDespiteAvailability(
      "The tool grants are currently `[]` for this persona.",
      tools,
    );
    expect(out).not.toBeNull();
    expect(out).toContain("unspecified");
  });
});

describe("buildToolRefusedDespiteAvailableNudge (BI-PIR-6de01e8d)", () => {
  it("names the refused tool and orders a tool call", () => {
    const nudge = buildToolRefusedDespiteAvailableNudge({
      refusedToolName: "run_hive_scout_ingest",
      deliveredToolNames: ["run_hive_scout_ingest", "other"],
    });
    expect(nudge).toContain("run_hive_scout_ingest");
    expect(nudge).toMatch(/IS available/i);
    expect(nudge).toMatch(/Call it now/i);
    expect(nudge).not.toMatch(/not available/i);
  });

  it("lists delivered tools for unspecified refusal", () => {
    const nudge = buildToolRefusedDespiteAvailableNudge({
      refusedToolName: "(unspecified — generic refusal)",
      deliveredToolNames: ["alpha", "beta"],
    });
    expect(nudge).toContain("alpha");
    expect(nudge).toContain("beta");
  });
});

describe("appendToolRefusedRecoveryMessages (BI-PIR-6de01e8d)", () => {
  const tools = [{ name: "run_hive_scout_ingest" }];

  it("appends assistant + correction when no tools ran", () => {
    const next = appendToolRefusedRecoveryMessages({
      messages: [{ role: "user", content: "scout" }],
      assistantContent: "tool not available",
      refusedToolName: "run_hive_scout_ingest",
      deliveredTools: tools,
      executedToolCount: 0,
      toolsStripped: false,
    });
    expect(next).not.toBeNull();
    expect(next).toHaveLength(3);
    expect(next![1].role).toBe("assistant");
    expect(next![2].role).toBe("user");
    expect(String(next![2].content)).toMatch(/IS available/i);
  });

  it("returns null when tools already executed or stripped", () => {
    expect(
      appendToolRefusedRecoveryMessages({
        messages: [],
        assistantContent: "x",
        refusedToolName: "run_hive_scout_ingest",
        deliveredTools: tools,
        executedToolCount: 1,
        toolsStripped: false,
      }),
    ).toBeNull();
    expect(
      appendToolRefusedRecoveryMessages({
        messages: [],
        assistantContent: "x",
        refusedToolName: "run_hive_scout_ingest",
        deliveredTools: tools,
        executedToolCount: 0,
        toolsStripped: true,
      }),
    ).toBeNull();
  });
});

describe("classifyToolRefusedIssue (BI-09C2480B)", () => {
  it("downgrades a recovered self-refusal to a low-severity, non-open trend record", () => {
    const c = classifyToolRefusedIssue({ recovered: true });
    expect(c.severity).toBe("low");
    // The issue-report-triage cron only projects OPEN reports into BI-PIR
    // backlog items, so a refusal the loop self-corrected must never be OPEN —
    // that is the ~24-duplicate-PIR noise this BI removes.
    expect(c.status).not.toBe(ISSUE_REPORT_STATUS.OPEN);
    // A terminal/resolved status both the triage runner and the dedupe-key
    // path skip, so the record survives for trend analysis without escalating.
    expect(c.status).toBe(ISSUE_REPORT_STATUS.RESOLVED_LOCALLY);
  });

  it("keeps an unrecovered self-refusal as a high-severity open contract issue", () => {
    const c = classifyToolRefusedIssue({ recovered: false });
    expect(c.severity).toBe("high");
    expect(c.status).toBe(ISSUE_REPORT_STATUS.OPEN);
  });
});
