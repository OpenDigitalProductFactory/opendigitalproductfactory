import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { summarizeUpgradeImpact } from "@/lib/self-upgrade/impact";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@/lib/self-upgrade/impact", () => ({ summarizeUpgradeImpact: vi.fn() }));

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);
const mockSummarizeUpgradeImpact = vi.mocked(summarizeUpgradeImpact);
const setAuthSession = (session: unknown) => {
  mockAuth.mockResolvedValue(session as never);
};

describe("GET /api/ops/self-upgrade/impact-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuthSession({
      user: {
        id: "user-1",
        platformRole: "HR-500",
        isSuperuser: false,
      },
      expires: "2026-06-01T00:00:00.000Z",
    });
    mockCan.mockReturnValue(true);
    mockSummarizeUpgradeImpact.mockResolvedValue({
      ok: false,
      reason: "no-target",
      detail: "No upstream update target is currently known.",
    });
  });

  it("requires an authenticated operator", async () => {
    setAuthSession(null);

    const res = await GET(new Request("https://dpf.local/api/ops/self-upgrade/impact-summary"));

    expect(res.status).toBe(401);
    expect(mockSummarizeUpgradeImpact).not.toHaveBeenCalled();
  });

  it("requires view_operations access", async () => {
    mockCan.mockReturnValue(false);

    const res = await GET(new Request("https://dpf.local/api/ops/self-upgrade/impact-summary"));

    expect(res.status).toBe(403);
    expect(mockSummarizeUpgradeImpact).not.toHaveBeenCalled();
  });

  it("returns the read-only summary with no-store caching", async () => {
    const res = await GET(new Request("https://dpf.local/api/ops/self-upgrade/impact-summary"));

    await expect(res.json()).resolves.toEqual({
      ok: false,
      reason: "no-target",
      detail: "No upstream update target is currently known.",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mockSummarizeUpgradeImpact).toHaveBeenCalledWith({ refresh: false });
  });

  it("passes refresh=true through to the summarizer", async () => {
    const res = await GET(
      new Request("https://dpf.local/api/ops/self-upgrade/impact-summary?refresh=true"),
    );

    expect(res.status).toBe(200);
    expect(mockSummarizeUpgradeImpact).toHaveBeenCalledWith({ refresh: true });
  });
});
