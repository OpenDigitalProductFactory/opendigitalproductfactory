import { describe, expect, it } from "vitest";

import {
  reviewedKnowledgeIsEligible,
  validateDemandEvidenceInput,
} from "./evidence";

describe("validateDemandEvidenceInput", () => {
  it("normalizes a typed, confidence-bearing source reference", () => {
    expect(
      validateDemandEvidenceInput({
        sourceKind: "customer-feedback",
        sourceRef: " FEEDBACK-1 ",
        title: " Repeated checkout friction ",
        summary: " Three customers reported the same issue. ",
        confidence: 0.8,
      }),
    ).toEqual({
      valid: true,
      value: {
        sourceKind: "customer-feedback",
        sourceRef: "FEEDBACK-1",
        title: "Repeated checkout friction",
        summary: "Three customers reported the same issue.",
        confidence: 0.8,
        reviewedAt: null,
      },
    });
  });

  it("rejects unknown source kinds and invalid confidence", () => {
    expect(
      validateDemandEvidenceInput({
        sourceKind: "guess",
        sourceRef: "x",
        title: "Guess",
      }),
    ).toMatchObject({ valid: false });
    expect(
      validateDemandEvidenceInput({
        sourceKind: "research",
        sourceRef: "x",
        title: "Research",
        confidence: 1.2,
      }),
    ).toMatchObject({ valid: false });
  });

  it("lets reviewed knowledge derive its title from the canonical page", () => {
    expect(
      validateDemandEvidenceInput({
        sourceKind: "reviewed-knowledge",
        sourceRef: "customer-booking-patterns",
        title: "",
      }),
    ).toMatchObject({
      valid: true,
      value: {
        sourceRef: "customer-booking-patterns",
        title: "",
      },
    });
    expect(
      validateDemandEvidenceInput({
        sourceKind: "booking",
        sourceRef: "BOOK-42",
        title: "",
      }),
    ).toMatchObject({ valid: false });
  });
});

describe("reviewedKnowledgeIsEligible", () => {
  it("requires published, reviewed organization knowledge", () => {
    expect(
      reviewedKnowledgeIsEligible({
        status: "published",
        lastReviewedAt: new Date("2026-07-28T00:00:00Z"),
        pageOrganizationId: "org-1",
        demandOrganizationId: "org-1",
        isKernel: false,
      }),
    ).toBe(true);
    expect(
      reviewedKnowledgeIsEligible({
        status: "draft",
        lastReviewedAt: new Date("2026-07-28T00:00:00Z"),
        pageOrganizationId: "org-1",
        demandOrganizationId: "org-1",
        isKernel: false,
      }),
    ).toBe(false);
    expect(
      reviewedKnowledgeIsEligible({
        status: "published",
        lastReviewedAt: null,
        pageOrganizationId: "org-1",
        demandOrganizationId: "org-1",
        isKernel: false,
      }),
    ).toBe(false);
  });

  it("allows reviewed kernel knowledge without assigning it to the organization", () => {
    expect(
      reviewedKnowledgeIsEligible({
        status: "published",
        lastReviewedAt: new Date("2026-07-28T00:00:00Z"),
        pageOrganizationId: null,
        demandOrganizationId: "org-1",
        isKernel: true,
      }),
    ).toBe(true);
  });
});
