import { describe, expect, it, vi } from "vitest";
vi.mock("@dpf/db", () => ({ prisma: {}, DATA_MODEL_MIRROR_TASK_ID: "data-mirror", SYSML_PROJECTION_TASK_ID: "sysml", SELF_OPTIMIZATION_SWEEP_TASK_ID: "optimization" }));
import { assertScheduledReportingEligible, parseScheduledReport, scheduledReportingRevision } from "./scheduled-reporting-contract";

const task = { taskId: "agent-task-56e05d88", ownerUserId: "owner", agentId: "platform-engineer", title: "Observe",
  prompt: "Private original commission; do not disclose or rewrite.", routeContext: "/platform", schedule: "23 */6 * * *",
  timezone: "UTC", isActive: false, taskKind: null, taskConfig: null, organizationId: null, productLineId: null,
  businessProductId: null, updatedAt: new Date("2026-10-29T00:00:00Z") };
const report = { version: 1, state: "routine", summary: "Observations unchanged.", evidenceToolNames: ["read_health"] };

describe("scheduled reporting contract", () => {
  it("accepts an owned paused generic commission without exposing its prompt", () => {
    expect(() => assertScheduledReportingEligible(task, "owner", true)).not.toThrow();
    expect(scheduledReportingRevision(task)).toMatch(/^[a-f0-9]{64}$/);
    expect(scheduledReportingRevision(task)).not.toContain(task.prompt);
  });
  it.each([
    { ownerUserId: "another-owner" }, { isActive: true }, { taskKind: "assurance-watch" },
    { taskKind: "unknown-kind" }, { organizationId: "org" }, { productLineId: "line" },
    { taskId: "workroom-stage" }, { taskId: "discovery-taxonomy-gap-triage-daily" },
    { taskId: "data-mirror" }, { taskId: "sysml" }, { taskId: "optimization" },
    { taskConfig: { workroomStage: {} } }, { taskConfig: { unknownWorkflow: true } },
    { taskConfig: { trigger: { kind: "unknown" } } },
    { taskConfig: { trigger: { kind: "time", workroomId: "WC-OTHER" } } },
    { taskConfig: { routineReporting: { version: 99, mode: "read-only-history" } } },
    { prompt: "Use record_workroom_evidence to complete this required stage." },
    { schedule: "0 9 1 11 *" }, { schedule: "invalid" }, { timezone: "America/Chicago" },
  ])("refuses an incompatible commission %j", change => {
    expect(() => assertScheduledReportingEligible({ ...task, ...change }, "owner", true)).toThrow();
  });
  it.each(["ownerUserId", "agentId", "prompt", "routeContext", "schedule", "timezone", "isActive", "taskKind", "taskConfig", "updatedAt"])("binds configuration revision to %s", key => {
    expect(scheduledReportingRevision({ ...task, [key]: key === "isActive" ? true : "changed" })).not.toBe(scheduledReportingRevision(task));
  });
  it("accepts only strict bounded report data, including genuinely actionable advice", () => {
    expect(parseScheduledReport(JSON.stringify(report))).toEqual(report);
    expect(parseScheduledReport(JSON.stringify({ ...report, state: "actionable", recommendation: "Investigate the measured increase." })).state).toBe("actionable");
  });
  it.each([
    { ...report, version: 2 }, { ...report, state: "completed" }, { ...report, summary: "" },
    { ...report, evidenceToolNames: [] }, { ...report, evidenceToolNames: ["read_health", "read_health"] },
    { ...report, recipientUserId: "another-owner" }, { ...report, url: "https://outside.invalid" },
    { ...report, evidenceRowId: "invented" }, { ...report, toolCall: { name: "delete_data" } },
    { ...report, state: "actionable" }, { ...report, state: "needs-decision" }, { ...report, state: "resolved" },
  ])("rejects unsupported or incomplete report data %j", value => {
    expect(() => parseScheduledReport(JSON.stringify(value))).toThrow();
  });
  it("rejects prose, fenced JSON, oversized JSON, and unknown fields before accepting a report", () => {
    for (const content of ["All healthy", "```json\n" + JSON.stringify(report) + "\n```", JSON.stringify({ ...report, extra: "x".repeat(17000) })]) {
      expect(() => parseScheduledReport(content)).toThrow();
    }
  });
});
