import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  can: vi.fn(),
  createSseResponse: vi.fn(),
  loadPage: vi.fn(),
  loadRow: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: {} } }));
vi.mock("@/lib/sse/sse-stream", () => ({ createSseResponse: mocks.createSseResponse }));
vi.mock("@/lib/work-capsules/delivery-task-hub-store", () => ({
  loadDeliveryTaskHubPage: mocks.loadPage,
  loadDeliveryTaskHubRow: mocks.loadRow,
}));
vi.mock("@/lib/work-capsules/delivery-task-stream", () => ({
  DELIVERY_TASK_HUB_EVENT: "delivery-task-hub",
  startDeliveryTaskHubSession: mocks.start,
}));
vi.mock("@/lib/work-capsules/activity-events", () => ({ subscribeToWorkCapsuleActivityEvents: mocks.subscribe }));

describe("GET /api/work-capsules/delivery-stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSseResponse.mockReturnValue(new Response("stream", { status: 200 }));
    mocks.start.mockResolvedValue(vi.fn());
  });

  it("returns 401 before opening a stream for a caller without view_platform", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.can.mockReturnValue(false);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://dpf.test/api/work-capsules/delivery-stream"));
    expect(response.status).toBe(401);
    expect(mocks.createSseResponse).not.toHaveBeenCalled();
  });

  it("opens one authenticated bounded delivery session", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-100", isSuperuser: false } });
    mocks.can.mockReturnValue(true);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://dpf.test/api/work-capsules/delivery-stream"));
    expect(response.status).toBe(200);
    expect(mocks.can).toHaveBeenCalledWith(expect.objectContaining({ platformRole: "HR-100" }), "view_platform");
    expect(mocks.createSseResponse).toHaveBeenCalledTimes(1);
    const options = mocks.createSseResponse.mock.calls[0]?.[0];
    const sendNamed = vi.fn();
    options.start({ sendNamed, closed: false });
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      loadSnapshot: expect.any(Function),
      loadRow: expect.any(Function),
      subscribe: mocks.subscribe,
    }));
  });
});
