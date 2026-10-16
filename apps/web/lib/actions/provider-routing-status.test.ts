import { beforeEach, describe, expect, it, vi } from "vitest";
const { mockPrisma, mockResumeProvider, mockAuth, mockCan } = vi.hoisted(() => ({
  mockPrisma: { modelProvider: { findUnique: vi.fn(), update: vi.fn() }, aiProviderConnection: { findUnique: vi.fn() }, modelProfile: { findMany: vi.fn() } },
  mockResumeProvider: vi.fn(), mockAuth: vi.fn(), mockCan: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma, setProviderStatusWithDefaultConnection: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@/lib/routing/loader", () => ({ invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("@/lib/inference/provider-operator-pause", () => ({ resumeOperatorProvider: mockResumeProvider }));
import { setProviderStatusWithDefaultConnection } from "@dpf/db";
import { toggleProviderStatus } from "./provider-routing-status";
beforeEach(() => { vi.resetAllMocks(); });

describe("operator provider toggle", () => {
  it("disables the connection together with the provider", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "active" });
    await expect(toggleProviderStatus("local")).resolves.toEqual({ status: "inactive", warning: null });
    expect(setProviderStatusWithDefaultConnection).toHaveBeenCalledWith(mockPrisma, { providerId: "local", status: "inactive" });
  });
  it.each(["inactive", "disabled"])("enables an account whose connection is %s even when the provider is active", async status => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "active", endpointType: "responses" });
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status });
    mockPrisma.modelProfile.findMany.mockResolvedValue([{ capabilities: { toolUse: true } }]);
    await expect(toggleProviderStatus("chatgpt")).resolves.toEqual({ status: "active", warning: null });
  });
  it("resumes a cloud pause without overwriting its automatic disabled status", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "disabled", endpointType: "responses" });
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status: "paused" });
    mockResumeProvider.mockResolvedValue({ outcome: "resumed", status: "disabled", connectionStatus: "active" });
    vi.mocked(setProviderStatusWithDefaultConnection).mockClear();
    await expect(toggleProviderStatus("chatgpt")).resolves.toMatchObject({ status: "disabled" });
    expect(mockResumeProvider).toHaveBeenCalledWith({ providerId: "chatgpt", actorId: "user-1" });
    expect(setProviderStatusWithDefaultConnection).not.toHaveBeenCalled();
  });
});

