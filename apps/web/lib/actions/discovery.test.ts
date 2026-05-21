import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    discoveryConnection: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
  executeBootstrapDiscovery: vi.fn(),
  persistBootstrapDiscoveryRun: vi.fn(),
}));
vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptSecret: (plain: string) => `enc:${plain}`,
  decryptSecret: (enc: string) => enc.replace(/^enc:/, ""),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { executeBootstrapDiscovery } from "@dpf/db";
import { configureDiscoveryConnection, triggerBootstrapDiscovery } from "./discovery";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockExecuteBootstrapDiscovery = executeBootstrapDiscovery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: true } });
  mockCan.mockReturnValue(true);
});

describe("configureDiscoveryConnection — edit path", () => {
  it("uses update-by-id when an id is supplied (URL changes don't fork the row)", async () => {
    mockUpdate.mockResolvedValue({ id: "conn-1" });
    const result = await configureDiscoveryConnection({
      id: "conn-1",
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "192.168.1.1", // changed from .0.1 — must not orphan original row
      apiKey: "new-key",
      configuration: { site: "default", discoverClients: true },
    });
    expect(result).toEqual({ ok: true, connectionId: "conn-1" });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: "conn-1" });
    expect(call.data.endpointUrl).toBe("https://192.168.1.1");
    expect(call.data.connectionKey).toBe("unifi:192.168.1.1");
    expect(call.data.encryptedApiKey).toBe("enc:new-key");
    expect(call.data.status).toBe("active");
  });

  it("preserves status when editing without a fresh key (URL/site rotation)", async () => {
    mockUpdate.mockResolvedValue({ id: "conn-1" });
    await configureDiscoveryConnection({
      id: "conn-1",
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "192.168.0.1",
      configuration: { site: "default", discoverClients: true },
    });
    const call = mockUpdate.mock.calls[0][0];
    expect(call.data).not.toHaveProperty("encryptedApiKey");
    expect(call.data).not.toHaveProperty("status");
  });

  it("falls back to upsert by connectionKey when id is omitted (create flow)", async () => {
    mockUpsert.mockResolvedValue({ id: "conn-fresh" });
    const result = await configureDiscoveryConnection({
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "192.168.0.1",
      apiKey: "fresh-key",
    });
    expect(result).toEqual({ ok: true, connectionId: "conn-fresh" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});

describe("triggerBootstrapDiscovery", () => {
  it("denies rerun when the user lacks the required capability", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-300", isSuperuser: false },
    });
    mockCan.mockReturnValue(false);

    await expect(triggerBootstrapDiscovery()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("revalidates discovery surfaces after a successful bootstrap run", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockExecuteBootstrapDiscovery.mockResolvedValue({ runKey: "DISC-200" });

    await expect(triggerBootstrapDiscovery()).resolves.toEqual({
      ok: true,
      summary: { runKey: "DISC-200" },
    });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });
});
