import { describe, expect, it, vi } from "vitest";

import { linkDemandEvidence, supersedeDemandEvidence } from "./evidence-repository";

function db() {
  const createActivity = vi.fn(async () => ({}));
  const updateLink = vi.fn(async () => ({}));
  return {
    backlogItem: {
      findUnique: vi.fn(async () => ({
        id: "backlog-1",
        itemId: "BI-1",
        organizationId: "org-1",
      })),
    },
    wikiPage: { findFirst: vi.fn(async () => null) },
    demandEvidenceLink: {
      upsert: vi.fn(async () => ({
        evidenceLinkId: "DME-1",
        sourceKind: "customer-feedback",
        sourceRef: "feedback-1",
        title: "Booking friction",
        status: "active",
      })),
      findUnique: vi.fn(async () => ({
        id: "link-1",
        evidenceLinkId: "DME-1",
        backlogItemId: "backlog-1",
        sourceKind: "customer-feedback",
        sourceRef: "feedback-1",
        title: "Booking friction",
        status: "active",
      })),
      update: updateLink,
    },
    backlogItemActivity: { create: createActivity },
    $transaction: vi.fn(async (operations: unknown[]) => operations),
  };
}

describe("demand evidence repository", () => {
  it("keeps principal provenance separate from the recording user", async () => {
    const repository = db();

    await linkDemandEvidence(repository, {
      itemId: "BI-1",
      sourceKind: "customer-feedback",
      sourceRef: "feedback-1",
      title: "Booking friction",
      linkedByPrincipalId: "principal-1",
      recordedByUserId: "user-1",
    });

    expect(repository.backlogItemActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recordedById: "user-1",
        payload: expect.objectContaining({ linkedByPrincipalId: "principal-1" }),
      }),
    });
  });

  it("returns the preserved evidence identity when superseding a link", async () => {
    const repository = db();

    const result = await supersedeDemandEvidence(repository, {
      evidenceLinkId: "DME-1",
      rationale: "Newer reviewed feedback supersedes this snapshot.",
      recordedByUserId: "user-1",
      recordedByPrincipalId: "principal-1",
    });

    expect(result).toEqual({
      ok: true,
      evidenceLinkId: "DME-1",
      sourceKind: "customer-feedback",
      sourceRef: "feedback-1",
      title: "Booking friction",
      status: "superseded",
    });
    expect(repository.backlogItemActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recordedById: "user-1",
        payload: expect.objectContaining({
          recordedByPrincipalId: "principal-1",
        }),
      }),
    });
  });
});
