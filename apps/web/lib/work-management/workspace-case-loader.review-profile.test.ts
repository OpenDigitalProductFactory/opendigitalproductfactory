import { expect, it, vi } from "vitest";
import { loadWorkspaceWorkCaseDetail, type WorkspaceCasePrismaClient } from "./workspace-case-loader";

const baseItem = {
  id: "row-1",
  itemId: "WI-1",
  sourceType: "booking",
  sourceId: "BK-1",
  title: "Confirm condenser appointment",
  description: "Customer needs a scheduling confirmation.",
  urgency: "urgent",
  effortClass: "short",
  status: "awaiting-input",
  assignedToUserId: "user-1",
  assignedToAgentId: null,
  dueAt: null,
  evidence: [{ kind: "operator-note", summary: "Customer called twice." }],
  createdAt: new Date("2026-06-28T10:00:00.000Z"),
  updatedAt: new Date("2026-06-28T10:30:00.000Z"),
};

function prismaFor(items: [typeof baseItem]): WorkspaceCasePrismaClient {
  return {
    workItem: { findMany: async () => items, findFirst: async () => items[0] },
    workItemMessage: { findMany: async () => [] },
    workroom: { findMany: async () => [] },
    workroomActivity: { findMany: async () => [] },
  };
}

  it("returns source review requirements only inside an authorized room read", async () => {
    const allowed = await loadWorkspaceWorkCaseDetail({ prismaClient: prismaFor([baseItem]),
      caseKey: "booking%3ABK-1", userId: "user-1" });
    expect(allowed?.room?.reviewProfile).toMatchObject({
      applicability: "unknown", source: { status: "resolved", identity: { sourceKey: "booking" } },
    });
    const denied = await loadWorkspaceWorkCaseDetail({ prismaClient: prismaFor([baseItem]),
      caseKey: "booking%3ABK-1", userId: "another-user" });
    expect(denied).toBeNull();
  });


it("loads occurrence scope only after content admission and retains unresolved applicability", async () => {
  const subject: import("./room-review-subject").RoomReviewSubject = { status: "resolved", organizationId: "org-one", storefrontId: "sf-one", storefrontRevision: "2026-10-25T00:00:00.000Z",
    source: { sourceKey: "booking", sourceId: "BK-1", revision: "2026-10-25T00:00:00.000Z" },
    primary: { ref: "arch-one", slug: "campground", category: "hospitality", revision: "2026-10-25T00:00:00.000Z" },
    compositions: [], fingerprint: "subject-proof" };
  const reviewSubjectLoader = vi.fn(async () => subject);
  const input = { prismaClient: prismaFor([baseItem]), caseKey: "booking%3ABK-1", userId: "user-1", reviewSubjectLoader };
  const result = await loadWorkspaceWorkCaseDetail(input);
  expect(reviewSubjectLoader).toHaveBeenCalledExactlyOnceWith({ sourceType: "booking", sourceId: "BK-1" });
  expect(result?.room?.reviewProfile).toMatchObject({ applicability: "unknown", assessment: "not-exercised", subject });
  reviewSubjectLoader.mockClear();
  expect(await loadWorkspaceWorkCaseDetail({ ...input, userId: "other-user" })).toBeNull();
  expect(reviewSubjectLoader).not.toHaveBeenCalled();
});

it("keeps inherited requirements when the scoped source reader is unavailable", async () => {
  const reviewSubjectLoader = vi.fn(async () => { throw new Error("private org-two database detail"); });
  const result = await loadWorkspaceWorkCaseDetail({ prismaClient: prismaFor([baseItem]),
    caseKey: "booking%3ABK-1", userId: "user-1", reviewSubjectLoader });
  expect(result?.room?.reviewProfile).toMatchObject({
    source: { status: "resolved" }, subject: { status: "unknown", reason: "source-unavailable" },
  });
  expect(JSON.stringify(result)).not.toContain("private org-two");
});

it("does not reinterpret a work-item identifier as a missing booking reference", async () => {
  const reviewSubjectLoader = vi.fn(async () => ({ status: "unknown" as const, reason: "source-missing" as const }));
  const db = prismaFor([baseItem]);
  db.workItem.findFirst = async () => ({ ...baseItem, sourceId: null });
  const result = await loadWorkspaceWorkCaseDetail({ prismaClient: db,
    caseKey: "booking%3AWI-1", userId: "user-1", reviewSubjectLoader });
  expect(reviewSubjectLoader).not.toHaveBeenCalled();
  expect(result?.room?.reviewProfile).toMatchObject({ subject: { status: "unknown", reason: "source-missing" } });
});
