import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ task: vi.fn(), snapshot: vi.fn(), infer: vi.fn(), create: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { marketingAssetTask: { findUnique: mocks.task }, outboundDraft: { create: mocks.create } } }));
vi.mock("../marketing", () => ({ getMarketingWorkspaceSnapshot: mocks.snapshot }));
vi.mock("../routed-inference", () => ({ routeAndCall: mocks.infer }));
import { draftMarketingAsset } from "./draft-builder";

describe("saved customer-proof task revalidation", () => {
  let snapshot: any;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.task.mockResolvedValue({ taskId: "task", title: "Customer Case Study: Closed-Won Outcomes", assetType: "email", brief: "Write a proof-driven case study summarizing 4 closed-won customer outcomes.", channel: "email" });
    snapshot = { organization: { id: "org" }, strategy: { strategyId: "strategy", targetSegments: [], idealCustomerProfiles: [], proofAssets: [] }, storefront: { category: "software-platform", ctaType: "inquiry" }, latestReview: { summary: "Do not publish customer proof until permission and figures are on file." } };
    mocks.snapshot.mockImplementation(async () => snapshot);
    mocks.infer.mockResolvedValue({ content: "Four customers reduced costs after adopting the service." });
    mocks.create.mockImplementation(async ({ data }) => ({ ...data, draftId: "draft" }));
  });

  it("refuses an old customer-win instruction before inference or saving a draft", async () => {
    const result = await draftMarketingAsset({ assetTaskId: "task", createdByAgentId: "marketing-specialist" });
    expect(result).toMatchObject({ success: false, error: "customer_proof_requires_evidence" });
    expect(mocks.infer).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not treat a proof label or URL as verified outcomes and permission", async () => {
    snapshot.strategy.proofAssets = [{ type: "case-study", label: "Four customer wins", url: "https://example.com/results" }];
    const result = await draftMarketingAsset({ assetTaskId: "task", createdByAgentId: "marketing-specialist" });
    expect(result).toMatchObject({ success: false, error: "customer_proof_requires_evidence" });
    expect(mocks.infer).not.toHaveBeenCalled();
  });

  it("keeps ordinary marketing drafting pending human review", async () => {
    mocks.task.mockResolvedValue({ taskId: "task", title: "Service introduction", assetType: "email", brief: "Introduce the saved service offering without customer result claims.", channel: "email" });
    mocks.infer.mockResolvedValue({ content: "Subject: Our service\nHere is the service offering for your review." });
    const result = await draftMarketingAsset({ assetTaskId: "task", createdByAgentId: "marketing-specialist" });
    expect(result).toMatchObject({ success: true, status: "pending-review" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending-review" }) }));
  });
  it("does not save a generated customer outcome that was absent from an ordinary brief", async () => {
    mocks.task.mockResolvedValue({ taskId: "task", title: "Service introduction", assetType: "email", brief: "Introduce our service.", channel: "email" });
    expect(await draftMarketingAsset({ assetTaskId: "task", createdByAgentId: "marketing-specialist" })).toMatchObject({ success: false, error: "customer_proof_requires_evidence" });
    expect(mocks.infer).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
