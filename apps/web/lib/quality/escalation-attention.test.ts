import { describe, expect, it } from "vitest";
import {
  escalationSelfFixLabel,
  escalationAgeLabel,
  escalationBlockerSummary,
} from "./escalation-attention";

describe("escalationSelfFixLabel", () => {
  it("maps each self-fix class to a human label", () => {
    expect(escalationSelfFixLabel("needs-human")).toBe("Needs human");
    expect(escalationSelfFixLabel("needs-external-capability")).toBe("Needs external capability");
    expect(escalationSelfFixLabel("auto-recoverable")).toBe("Auto-recoverable");
  });

  it("falls back to a generic label for null / unknown", () => {
    expect(escalationSelfFixLabel(null)).toBe("Escalation");
    expect(escalationSelfFixLabel(undefined)).toBe("Escalation");
    expect(escalationSelfFixLabel("something-else")).toBe("Escalation");
  });
});

describe("escalationAgeLabel", () => {
  const now = new Date("2026-06-22T12:00:00Z").getTime();

  it("reports sub-minute ages as just now", () => {
    expect(escalationAgeLabel("2026-06-22T11:59:30Z", now)).toBe("just now");
    expect(escalationAgeLabel("2026-06-22T12:00:00Z", now)).toBe("just now");
  });

  it("reports minutes, hours, then days", () => {
    expect(escalationAgeLabel("2026-06-22T11:45:00Z", now)).toBe("15m ago");
    expect(escalationAgeLabel("2026-06-22T09:00:00Z", now)).toBe("3h ago");
    expect(escalationAgeLabel("2026-06-20T12:00:00Z", now)).toBe("2d ago");
  });

  it("is defensive against an unparseable timestamp", () => {
    expect(escalationAgeLabel("not-a-date", now)).toBe("just now");
  });
});

describe("escalationBlockerSummary", () => {
  // Mirrors the structured description escalateBuildToHuman.formatEscalationReport writes.
  const withIssues =
    'Build FB-1 ("X") could not be self-repaired by Build Studio and has been escalated.\n\n' +
    "Phase: plan\n" +
    "Self-fix feasibility: needs-human\n\n" +
    "What was attempted:\n" +
    "Build Studio attempted 3 automated plan revision round(s), and the reviewer still rejected the plan.\n\n" +
    "Unresolved blocking issues (root cause):\n" +
    "- [high] Import endpoint trusts unvalidated input\n" +
    "- [medium] Missing tests for the new path";

  it("returns the first concrete blocking issue, without the bullet", () => {
    expect(escalationBlockerSummary(withIssues)).toBe(
      "[high] Import endpoint trusts unvalidated input",
    );
  });

  it("falls back to the what-was-attempted sentence when no issues were listed", () => {
    const noIssues =
      "Phase: ideate\n\n" +
      "What was attempted:\n" +
      "The plan review failed and no automated revision could be attempted.\n\n" +
      "Unresolved blocking issues (root cause):\n" +
      "- (no structured blocking issues were recorded)";
    expect(escalationBlockerSummary(noIssues)).toBe(
      "The plan review failed and no automated revision could be attempted.",
    );
  });

  it("clips an overlong issue line", () => {
    const long = "Unresolved blocking issues (root cause):\n- " + "x".repeat(400);
    const out = escalationBlockerSummary(long)!;
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns null for empty / unparseable descriptions", () => {
    expect(escalationBlockerSummary(null)).toBeNull();
    expect(escalationBlockerSummary("")).toBeNull();
    expect(escalationBlockerSummary("just some prose with no headers")).toBeNull();
  });
});
