import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  updateStorefront: vi.fn(),
  completeSetupStepFromEvidence: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({
  prisma: { storefrontConfig: { update: mocks.updateStorefront } },
}));
vi.mock("@/lib/onboarding/setup-progress-service.server", () => ({
  completeSetupStepFromEvidence: mocks.completeSetupStepFromEvidence,
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe("storefront publish route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { type: "admin" } });
    mocks.updateStorefront.mockResolvedValue({ organizationId: "org-1" });
  });

  it("projects a successful publish into onboarding progress", async () => {
    const response = await POST(request({ id: "sf-1", isPublished: true }));

    expect(response.status).toBe(200);
    expect(mocks.updateStorefront).toHaveBeenCalledWith({
      where: { id: "sf-1" },
      data: { isPublished: true },
      select: { organizationId: true },
    });
    expect(mocks.completeSetupStepFromEvidence).toHaveBeenCalledWith("org-1", "storefront");
  });

  it("never reopens onboarding when a storefront is unpublished", async () => {
    await POST(request({ id: "sf-1", isPublished: false }));

    expect(mocks.completeSetupStepFromEvidence).not.toHaveBeenCalled();
  });
});
