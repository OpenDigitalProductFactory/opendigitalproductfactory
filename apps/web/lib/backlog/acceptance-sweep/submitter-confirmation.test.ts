import { describe, expect, it, vi } from "vitest";

import {
  SUBMITTER_CONFIRMATION_WINDOW_DAYS,
  advanceSubmitterConfirmation,
  confirmationChannelFor,
  submitterQuestion,
  type ConfirmationState,
  type SubmitterConfirmationPorts,
} from "./submitter-confirmation";

// BI-C899BB40 (AC-CFD-2): a customer-reported item closes on delivery and its
// submitter gets exactly one question. A negative answer files one corrective
// item; a confirmation or silence past the window resolves it; nothing repeats.

const CLOSED_AT = new Date("2026-10-27T05:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ISSUE_BODY = "It broke.\n\n[origin:ecosystem-upstream-issue:acme/portal#42]";

function state(overrides: Partial<ConfirmationState> = {}): ConfirmationState {
  return {
    itemId: "BI-1", body: ISSUE_BODY, lifecycleTags: ["ecosystem-inbound", "upstream-issue"],
    closure: { recordedAt: CLOSED_AT, payload: { to: "done", closureBasis: "delivery-evidence", acceptanceObligation: "pending-submitter-confirmation", servedSha: null } },
    records: [], sourceChanges: [],
    ...overrides,
  };
}

function ports(s: ConfirmationState, now = new Date(CLOSED_AT.getTime() + DAY)) {
  const recorded: Array<Record<string, unknown>> = [];
  const p = {
    now,
    loadState: vi.fn(async () => s),
    postIssueComment: vi.fn(async () => ({ sent: true as const, url: "https://github.com/acme/portal/issues/42#issuecomment-1" })),
    notifyCluster: vi.fn(async () => ({ sent: true as const, queued: 1 })),
    fileCorrective: vi.fn(async () => ({ action: "created" as const, itemId: "BI-ACC-1" })),
    record: vi.fn(async (_item: unknown, payload: Record<string, unknown>) => { recorded.push(payload); }),
  } satisfies SubmitterConfirmationPorts;
  return { p, recorded };
}

const item = { id: "row-1", itemId: "BI-1" };
const asked = (at: Date, channel = "github-issue") => ({ recordedAt: at, payload: { outcome: "question-sent", resolved: false, channel } });

describe("confirmationChannelFor", () => {
  it("reads the GitHub issue, then the founder demand cluster, from existing origin markers", () => {
    expect(confirmationChannelFor(ISSUE_BODY)).toEqual({ kind: "github-issue", repository: { forge: "github", owner: "acme", repo: "portal" }, number: 42 });
    expect(confirmationChannelFor("x [origin:founderDemandCluster:FDC-9]")).toEqual({ kind: "founder-demand-cluster", clusterId: "FDC-9" });
    expect(confirmationChannelFor("Source report: PIR-1")).toEqual({ kind: "none" });
  });
});

describe("advanceSubmitterConfirmation", () => {
  it("asks exactly once on the GitHub issue and records the question", async () => {
    const { p, recorded } = ports(state());
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "question-sent" });
    expect(p.postIssueComment).toHaveBeenCalledTimes(1);
    expect(p.postIssueComment).toHaveBeenCalledWith({ forge: "github", owner: "acme", repo: "portal" }, 42, submitterQuestion("BI-1"));
    expect(recorded).toEqual([expect.objectContaining({ outcome: "question-sent", resolved: false, channel: "github-issue" })]);
  });

  it("never asks a second time once a question is on the record", async () => {
    const { p } = ports(state({ records: [asked(new Date(CLOSED_AT.getTime() + 1000))] }));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "waiting" });
    expect(p.postIssueComment).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("records question-not-sent with no controller credential and still runs the clock", async () => {
    const { p, recorded } = ports(state());
    p.postIssueComment.mockResolvedValueOnce({ sent: false, reason: "no-credential", message: "no controller login" } as never);
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "question-not-sent", reason: "no-credential" });
    expect(recorded[0]).toMatchObject({ outcome: "question-not-sent", reason: "no-credential", resolved: false });
  });

  it("a reopened issue after the question files one corrective item and resolves", async () => {
    const at = new Date(CLOSED_AT.getTime() + 1000);
    const { p, recorded } = ports(state({ records: [asked(at)],
      sourceChanges: [{ recordedAt: new Date(at.getTime() + DAY), kind: "reopened" }] }));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "not-fixed", correctiveItemId: "BI-ACC-1" });
    expect(p.fileCorrective).toHaveBeenCalledTimes(1);
    expect(p.fileCorrective).toHaveBeenCalledWith(expect.objectContaining({ originalItemId: "BI-1" }));
    expect(recorded).toEqual([expect.objectContaining({ outcome: "not-fixed", resolved: true, correctiveItemId: "BI-ACC-1" })]);
  });

  it("ignores a source change that happened before the question", async () => {
    const at = new Date(CLOSED_AT.getTime() + DAY);
    const { p } = ports(state({ records: [asked(at)], sourceChanges: [{ recordedAt: CLOSED_AT, kind: "reopened" }] }),
      new Date(at.getTime() + DAY));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "waiting" });
    expect(p.fileCorrective).not.toHaveBeenCalled();
  });

  it("the submitter closing the issue confirms it", async () => {
    const at = new Date(CLOSED_AT.getTime() + 1000);
    const { p, recorded } = ports(state({ records: [asked(at)], sourceChanges: [{ recordedAt: new Date(at.getTime() + DAY), kind: "closed" }] }));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "confirmed" });
    expect(recorded[0]).toMatchObject({ outcome: "confirmed", resolved: true });
  });

  it("silence past the window is satisfied-by-silence; inside the window it waits", async () => {
    const at = new Date(CLOSED_AT.getTime() + 1000);
    const inside = ports(state({ records: [asked(at)] }), new Date(at.getTime() + (SUBMITTER_CONFIRMATION_WINDOW_DAYS - 1) * DAY));
    expect(await advanceSubmitterConfirmation(item, inside.p)).toMatchObject({ step: "waiting" });
    const past = ports(state({ records: [asked(at)] }), new Date(at.getTime() + SUBMITTER_CONFIRMATION_WINDOW_DAYS * DAY));
    expect(await advanceSubmitterConfirmation(item, past.p)).toMatchObject({ step: "satisfied-by-silence" });
    expect(past.recorded[0]).toMatchObject({ outcome: "satisfied-by-silence", resolved: true });
    expect(past.p.fileCorrective).not.toHaveBeenCalled();
  });

  it("does nothing once an outcome is resolved", async () => {
    const { p } = ports(state({ records: [asked(CLOSED_AT), { recordedAt: new Date(CLOSED_AT.getTime() + DAY), payload: { outcome: "confirmed", resolved: true } }] }));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "resolved" });
    expect(p.record).not.toHaveBeenCalled();
  });

  it("uses the federation notice for a founder demand cluster", async () => {
    const { p, recorded } = ports(state({ body: "[origin:founderDemandCluster:FDC-9]", lifecycleTags: [] }));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "question-sent" });
    expect(p.notifyCluster).toHaveBeenCalledWith("FDC-9", submitterQuestion("BI-1"));
    expect(recorded[0]).toMatchObject({ channel: "founder-demand-cluster" });
  });

  it("records no-channel for a customer origin with no reply path", async () => {
    const { p, recorded } = ports(state({ itemId: "BI-PIR-1", body: "Source report: PIR-1", lifecycleTags: [] }));
    expect(await advanceSubmitterConfirmation({ id: "row-1", itemId: "BI-PIR-1" }, p)).toMatchObject({ step: "question-not-sent", reason: "no-channel" });
    expect(recorded[0]).toMatchObject({ outcome: "question-not-sent", reason: "no-channel" });
  });

  it("retires a legacy non-customer obligation as not-owed, once, without asking anyone", async () => {
    const { p, recorded } = ports(state({ body: "Platform work", lifecycleTags: [],
      closure: { recordedAt: CLOSED_AT, payload: { to: "done", closureBasis: "canonical-deployment", acceptanceObligation: "pending-independent-verification" } } }));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "not-owed" });
    expect(p.postIssueComment).not.toHaveBeenCalled();
    expect(recorded).toEqual([expect.objectContaining({ outcome: "not-owed", resolved: true })]);
  });

  it("asks a legacy customer-reported item its one question", async () => {
    const { p } = ports(state({ closure: { recordedAt: CLOSED_AT, payload: { to: "done", closureBasis: "canonical-deployment", acceptanceObligation: "pending-independent-verification" } } }));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "question-sent" });
  });

  it("files the corrective item a failed acceptance owes, once", async () => {
    const { p, recorded } = ports(state({ body: "Platform work", lifecycleTags: [],
      closure: { recordedAt: CLOSED_AT, payload: { to: "done", closureBasis: "canonical-deployment", acceptanceObligation: "corrective-work-required", deployment: { servedSha: "d".repeat(40) } } } }));
    expect(await advanceSubmitterConfirmation(item, p)).toMatchObject({ step: "corrective-filed", correctiveItemId: "BI-ACC-1" });
    expect(p.fileCorrective).toHaveBeenCalledWith(expect.objectContaining({ servedSha: "d".repeat(40) }));
    expect(recorded[0]).toMatchObject({ outcome: "corrective-filed", resolved: true });
  });
});
