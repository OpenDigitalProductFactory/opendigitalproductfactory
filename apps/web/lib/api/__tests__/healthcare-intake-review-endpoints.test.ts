import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/auth-middleware.js", () => ({
  requireEmployeeAuth: vi.fn(),
  requireCapability: vi.fn(),
}));
vi.mock("../../healthcare/care-intake-review-repository.js", () => ({
  listCareIntakeReviewQueue: vi.fn(),
  revokeCareIntakeAccessGrant: vi.fn(),
}));

import { POST as revokeGrant } from "../../../app/api/v1/healthcare/intake/[packetId]/access-grants/[grantId]/revoke/route.js";
import { GET as reviewQueue } from "../../../app/api/v1/healthcare/intake/review/route.js";
import { requireCapability, requireEmployeeAuth } from "../../api/auth-middleware.js";
import { listCareIntakeReviewQueue, revokeCareIntakeAccessGrant } from "../../healthcare/care-intake-review-repository.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireEmployeeAuth).mockResolvedValue({
    user: { id: "user-reception", type: "admin" } as never,
    capabilities: ["view_customer", "operate_customer"],
    authContext: { principalId: "principal-receptionist" } as never,
  });
});

describe("healthcare intake receptionist endpoints", () => {
  it("requires the customer-view capability and passes the authenticated principal", async () => {
    vi.mocked(listCareIntakeReviewQueue).mockResolvedValue({ items: [] });
    const response = await reviewQueue(new Request("http://localhost/api/v1/healthcare/intake/review?organizationId=org-a"));
    expect(response.status).toBe(200);
    expect(requireCapability).toHaveBeenCalledWith(["view_customer", "operate_customer"], "view_customer");
    expect(listCareIntakeReviewQueue).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a", actorPrincipalId: "principal-receptionist",
    }));
  });

  it("requires the customer-operate capability for grant revocation", async () => {
    vi.mocked(revokeCareIntakeAccessGrant).mockResolvedValue({
      grantId: "grant-a", status: "revoked", revokedAt: new Date("2026-08-01"),
    });
    const response = await revokeGrant(new Request("http://localhost", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: "org-a", reason: "patient-requested" }),
    }), { params: Promise.resolve({ packetId: "intake-a", grantId: "grant-a" }) });
    expect(response.status).toBe(200);
    expect(requireCapability).toHaveBeenCalledWith(["view_customer", "operate_customer"], "operate_customer");
    expect(revokeCareIntakeAccessGrant).toHaveBeenCalledWith(expect.objectContaining({
      packetId: "intake-a", grantId: "grant-a", actorPrincipalId: "principal-receptionist",
    }));
  });
});
