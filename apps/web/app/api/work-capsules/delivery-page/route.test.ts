import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), can: vi.fn(), loadPage: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: {} } }));
vi.mock("@/lib/work-capsules/delivery-task-hub-store", () => ({ loadDeliveryTaskHubPage: mocks.loadPage }));

describe("GET /api/work-capsules/delivery-page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-100", isSuperuser: false } });
    mocks.can.mockReturnValue(true);
  });

  it("returns a bounded cursor page", async () => {
    mocks.loadPage.mockResolvedValue({ rows: [], nextCursor: null, observedAt: "2026-09-04T12:00:00.000Z" });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://dpf.test/api/work-capsules/delivery-page?cursor=opaque"));
    expect(response.status).toBe(200);
    expect(mocks.loadPage).toHaveBeenCalledWith(expect.anything(), { cursor: "opaque" });
  });

  it("returns 400 for an invalid cursor without widening the query", async () => {
    mocks.loadPage.mockRejectedValue(new Error("Invalid delivery task cursor"));
    const { GET } = await import("./route");
    const response = await GET(new Request("http://dpf.test/api/work-capsules/delivery-page?cursor=bad"));
    expect(response.status).toBe(400);
  });
});
