import { describe, expect, it } from "vitest";
import {
  createStorefrontInquiryBacklogDraft,
  deriveLifecycleLabel,
} from "@/lib/governed-backlog-workflow";

describe("deriveLifecycleLabel", () => {
  it("returns Captured for triaging items without an outcome", () => {
    expect(
      deriveLifecycleLabel({
        backlogItem: { status: "triaging", triageOutcome: null, activeBuildId: null },
        featureBuild: null,
        governedBacklogEnabled: true,
      }),
    ).toBe("Captured");
  });

  it("returns Triaging for triaging items with an outcome awaiting confirmation", () => {
    expect(
      deriveLifecycleLabel({
        backlogItem: { status: "triaging", triageOutcome: "build", activeBuildId: null },
        featureBuild: null,
        governedBacklogEnabled: true,
      }),
    ).toBe("Triaging");
  });

  it("returns Prepared Draft for linked ideate builds that are not yet approved", () => {
    expect(
      deriveLifecycleLabel({
        backlogItem: { status: "open", triageOutcome: "build", activeBuildId: "build-1" },
        featureBuild: { phase: "ideate", draftApprovedAt: null },
        governedBacklogEnabled: true,
      }),
    ).toBe("Prepared Draft");
  });

  it("returns Ready to Start for approved ideate drafts", () => {
    expect(
      deriveLifecycleLabel({
        backlogItem: { status: "open", triageOutcome: "build", activeBuildId: "build-1" },
        featureBuild: { phase: "ideate", draftApprovedAt: new Date("2026-04-24T13:00:00Z") },
        governedBacklogEnabled: true,
      }),
    ).toBe("Ready to Start");
  });

  it("returns In Progress for active backlog execution", () => {
    expect(
      deriveLifecycleLabel({
        backlogItem: { status: "in-progress", triageOutcome: "build", activeBuildId: "build-1" },
        featureBuild: { phase: "build", draftApprovedAt: new Date("2026-04-24T13:00:00Z") },
        governedBacklogEnabled: true,
      }),
    ).toBe("In Progress");
  });

  it("returns Ready to Release for ship-phase builds that are not yet closed", () => {
    expect(
      deriveLifecycleLabel({
        backlogItem: { status: "in-progress", triageOutcome: "build", activeBuildId: "build-1" },
        featureBuild: { phase: "ship", draftApprovedAt: new Date("2026-04-24T13:00:00Z") },
        governedBacklogEnabled: true,
      }),
    ).toBe("Ready to Release");
  });

  it("returns Done for completed backlog items", () => {
    expect(
      deriveLifecycleLabel({
        backlogItem: { status: "done", triageOutcome: "build", activeBuildId: "build-1" },
        featureBuild: { phase: "complete", draftApprovedAt: new Date("2026-04-24T13:00:00Z") },
        governedBacklogEnabled: true,
      }),
    ).toBe("Done");
  });

  it("preserves legacy active-work semantics when governed mode is disabled", () => {
    expect(
      deriveLifecycleLabel({
        backlogItem: { status: "open", triageOutcome: "build", activeBuildId: "build-1" },
        featureBuild: { phase: "ideate", draftApprovedAt: null },
        governedBacklogEnabled: false,
      }),
    ).toBe("In Progress");
  });

  it("maps a storefront inquiry into customer-zero governed backlog intake metadata", () => {
    expect(
      createStorefrontInquiryBacklogDraft({
        inquiryId: "inquiry_1",
        inquiryRef: "INQ-1001",
        customerName: "Jane Prospect",
        customerEmail: "jane@example.com",
        message: "We want to run our own digital product operation on DPF.",
        storefrontLabel: "Open Digital Product Factory",
        itemLabel: "Open Digital Product Factory",
      }),
    ).toMatchObject({
      itemId: "BI-SFI-INQ1001",
      title: "Customer-zero product inquiry INQ-1001",
      type: "product",
      status: "triaging",
      source: "user-request",
      signalLabel: "customer-zero",
      recommendedTriageOutcome: "build",
    });
  });
});
