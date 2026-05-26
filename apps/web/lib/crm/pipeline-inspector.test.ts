import { describe, expect, it } from "vitest";
import {
  buildPipelineInspectorView,
  getStageAgeDays,
  getStageExitCriteria,
  isStageStale,
} from "./pipeline-inspector";

const now = new Date("2026-05-26T12:00:00.000Z");

describe("pipeline inspector view model", () => {
  it("calculates stage age in whole days", () => {
    expect(getStageAgeDays(new Date("2026-05-20T11:00:00.000Z"), now)).toBe(6);
    expect(getStageAgeDays(new Date("2026-05-26T11:00:00.000Z"), now)).toBe(0);
  });

  it("flags stale open stages using stage-specific thresholds or dormant state", () => {
    expect(isStageStale({ stage: "proposal", stageAgeDays: 15, isDormant: false })).toBe(true);
    expect(isStageStale({ stage: "proposal", stageAgeDays: 3, isDormant: false })).toBe(false);
    expect(isStageStale({ stage: "discovery", stageAgeDays: 1, isDormant: true })).toBe(true);
    expect(isStageStale({ stage: "closed_won", stageAgeDays: 90, isDormant: false })).toBe(false);
  });

  it("returns stage exit criteria for buyer-progress stages", () => {
    expect(getStageExitCriteria("proposal")).toEqual([
      "Quote or proposal sent",
      "Commercial owner identified",
      "Budget and timeline confirmed",
    ]);
    expect(getStageExitCriteria("custom_stage")).toEqual([
      "Confirm the next buyer commitment",
      "Record the evidence needed to leave this stage",
    ]);
  });

  it("builds a scan-first inspector with quote, engagement, next action, and AI topics", () => {
    const view = buildPipelineInspectorView({
      now,
      opportunity: {
        id: "opp-1",
        opportunityId: "OPP-CODEX-001",
        title: "Modernize revenue workflow",
        stage: "proposal",
        isDormant: false,
        probability: 70,
        expectedValue: 15000,
        currency: "GBP",
        expectedClose: new Date("2026-06-10T00:00:00.000Z"),
        stageChangedAt: new Date("2026-05-06T12:00:00.000Z"),
        notes: "Proposal sent after discovery.",
        account: { id: "acct-1", name: "Acme Ops" },
        contact: { email: "buyer@example.com", firstName: "Bea", lastName: "Buyer" },
        engagement: {
          id: "eng-1",
          title: "Website pricing inquiry",
          status: "qualified",
          source: "web_inquiry",
          sourceRefId: "inq-1",
        },
        quotes: [
          {
            id: "quote-1",
            quoteNumber: "QUO-2026-0004",
            status: "sent",
            totalAmount: 15000,
            currency: "GBP",
            sentAt: new Date("2026-05-22T00:00:00.000Z"),
            acceptedAt: null,
          },
        ],
        activities: [
          {
            id: "act-1",
            type: "email",
            subject: "Sent proposal",
            body: "Proposal and pricing sent.",
            createdAt: new Date("2026-05-22T09:00:00.000Z"),
          },
        ],
      },
    });

    expect(view.stageAgeLabel).toBe("20 days in stage");
    expect(view.staleLabel).toBe("Stale stage");
    expect(view.stageExitCriteria).toContain("Quote or proposal sent");
    expect(view.suggestedNextAction).toBe("Follow up on the sent quote and confirm the next buyer commitment.");
    expect(view.sourceEngagement?.label).toBe("Website pricing inquiry");
    expect(view.latestQuote?.statusLabel).toBe("Sent");
    expect(view.aiTopics.map((topic) => topic.id)).toEqual([
      "deal-summary",
      "stale-stage-diagnosis",
      "follow-up-draft",
    ]);
  });
});
