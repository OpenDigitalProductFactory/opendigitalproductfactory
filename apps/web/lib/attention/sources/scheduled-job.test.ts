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
  nextRunAt: new Date("2026-10-20T06:17:00.000Z"),
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
