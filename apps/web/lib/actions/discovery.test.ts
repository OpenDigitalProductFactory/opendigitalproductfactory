import { beforeEach, describe, expect, it, vi } from "vitest";

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
  prisma: {},
  executeBootstrapDiscovery: vi.fn(),
  persistBootstrapDiscoveryRun: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { executeBootstrapDiscovery } from "@dpf/db";
import { triggerBootstrapDiscovery } from "./discovery";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockExecuteBootstrapDiscovery = executeBootstrapDiscovery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
