import { describe, expect, it, vi } from "vitest";

import {
  loadScheduledJobAttentionItems,
  scheduledJobToAttentionItem,
  type ScheduledJobAttentionRow,
} from "./scheduled-job";

const now = new Date("2026-10-13T12:00:00.000Z");

const failing: ScheduledJobAttentionRow = {
  jobId: "ecosystem-inbound-issue-triage",
  name: "Ecosystem: inbound issue triage",
  schedule: "17 6 * * 1",
  enabled: true,
  lastRunAt: new Date("2026-10-13T06:17:00.000Z"),
  nextRunAt: new Date("2026-10-20T06:17:00.000Z"), // clock-bomb-guard: allow projection takes an explicit `now`; no wall-clock comparison
  lastStatus: "failed",
  lastError: "upstream-issue: GitHub auth failed (401)",
  lastRunSummary: "Incomplete scan: 0 new, 0 matched, 0 failed; 1 unread source(s).",
};

describe("scheduledJobToAttentionItem", () => {
  it("brings a failing scheduled job forward with a deep link to the schedule register", () => {
    const item = scheduledJobToAttentionItem(failing, now);
    expect(item).toMatchObject({
      id: "scheduled-job:ecosystem-inbound-issue-triage",
      source: "scheduled-task",
      title: "Scheduled job needs review",
      deepLink: "/admin/scheduled-jobs",
      audience: { operator: true },
      triage: { residueReason: "no-self-heal", blastRadius: "Ecosystem: inbound issue triage" },
      actions: [{ kind: "open-in-context", label: "Review scheduled jobs", href: "/admin/scheduled-jobs" }],
    });
    expect(item!.context).toContain("Ecosystem: inbound issue triage");
    expect(item!.context).toContain("Incomplete scan");
  });

  it("names the missing commission when the intake controller is not commissioned", () => {
    const item = scheduledJobToAttentionItem({
      ...failing,
      lastStatus: "not-configured",
      lastError: null,
      lastRunSummary: "not commissioned: no controller workroom is referenced on ecosystem-inbound-issue-triage",
    }, now);
    expect(item).toMatchObject({
      id: "scheduled-job:ecosystem-inbound-issue-triage",
      title: "Issue intake is not commissioned",
      triage: { residueReason: "input-required" },
      deepLink: "/admin/scheduled-jobs",
    });
    expect(item!.context).toMatch(/not commissioned: no controller workroom/);
  });

  it("leaves healthy, never-run, disabled and unrelated not-configured jobs out of attention", () => {
    expect(scheduledJobToAttentionItem({ ...failing, lastStatus: "completed", lastError: null }, now)).toBeNull();
    expect(scheduledJobToAttentionItem({ ...failing, lastRunAt: null, lastStatus: null }, now)).toBeNull();
    expect(scheduledJobToAttentionItem({ ...failing, enabled: false }, now)).toBeNull();
    expect(scheduledJobToAttentionItem({
      ...failing, jobId: "discovery-prometheus-poll", lastStatus: "not-configured", lastRunSummary: "not commissioned: x",
    }, now)).toBeNull();
    expect(scheduledJobToAttentionItem({
      ...failing, lastStatus: "not-configured", lastRunSummary: "GitHub token missing",
    }, now)).toBeNull();
  });

  it("asks once, and leads to the switch, when the submission sweep is halted for want of consent", () => {
    // BI-6ED89EC6: the sweep used to halt daily with only a console line.
    const item = scheduledJobToAttentionItem({
      ...failing,
      jobId: "ecosystem-issue-submission-sweep",
      name: "Ecosystem: issue submission sweep",
      schedule: "41 5 * * *",
      lastStatus: "not-configured",
      lastError: null,
      lastRunSummary: "Upstream feedback is off, so 3 problems triaged here are not reaching the ecosystem.",
      metadata: { haltReason: "awaiting-consent" },
    }, now);
    expect(item).toMatchObject({
      // One standing item per job, never one per report.
      id: "scheduled-job:ecosystem-issue-submission-sweep",
      title: "Problems found here are not reaching the ecosystem",
      deepLink: "/admin/issue-reports/upstream#upstream-feedback",
      actions: [{ kind: "open-in-context", label: "Turn on upstream feedback", href: "/admin/issue-reports/upstream#upstream-feedback" }],
      triage: { residueReason: "input-required", decideEffort: "judgment" },
    });
    expect(item!.context).toContain("3 problems triaged here");
    expect(item!.context).toContain("nothing is sent until you do");
  });

  it("does not nag about a sweep the operator deliberately stopped", () => {
    for (const haltReason of ["paused", "fork-only", "not-applicable"]) {
      expect(scheduledJobToAttentionItem({
        ...failing,
        jobId: "ecosystem-issue-submission-sweep",
        lastStatus: "not-configured",
        lastRunSummary: "Contributions are paused, so nothing was sent.",
        metadata: { haltReason },
      }, now)).toBeNull();
    }
  });

  it("keys on the typed halt reason, so rewording the summary cannot silence the ask", () => {
    const base = { ...failing, jobId: "ecosystem-issue-submission-sweep", lastStatus: "not-configured" };
    expect(scheduledJobToAttentionItem({ ...base, lastRunSummary: "Reworded entirely.",
      metadata: { haltReason: "awaiting-consent" } }, now)).not.toBeNull();
    expect(scheduledJobToAttentionItem({ ...base, lastRunSummary: "awaiting consent: old prose",
      metadata: null }, now)).toBeNull();
  });

  it("does not leak the raw error text into the owner-facing context", () => {
    expect(scheduledJobToAttentionItem(failing, now)!.context).not.toContain("401");
  });
});

describe("loadScheduledJobAttentionItems", () => {
  it("queries enabled jobs whose last status can need attention and projects them", async () => {
    const findMany = vi.fn().mockResolvedValue([failing, { ...failing, jobId: "ok-job", lastStatus: "completed" }]);
    const items = await loadScheduledJobAttentionItems({ scheduledJob: { findMany } }, now);
    expect(items.map((item) => item.id)).toEqual(["scheduled-job:ecosystem-inbound-issue-triage"]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ enabled: true }),
    }));
  });
});
