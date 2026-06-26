import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { requireCapability, withCapability } from "./guards";

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);

function signedIn(id = "user-1", platformRole: string | null = "HR-000", isSuperuser = false) {
  mockAuth.mockResolvedValue({
    user: { id, email: "admin@example.com", platformRole, isSuperuser },
  } as never);
}

function signedOut() {
  mockAuth.mockResolvedValue(null as never);
}

describe("requireCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { userId } when the capability is present", async () => {
    signedIn("user-42");
    mockCan.mockReturnValue(true);

    await expect(requireCapability("manage_finance")).resolves.toEqual({ userId: "user-42" });
    // The check is delegated to the shared can() primitive with the
    // exact { platformRole, isSuperuser } context shape and the raw capability.
    expect(mockCan).toHaveBeenCalledWith(
      { platformRole: "HR-000", isSuperuser: false },
      "manage_finance",
    );
  });

  it("throws Unauthorized when the capability is absent", async () => {
    signedIn("user-9", "EMP-100");
    mockCan.mockReturnValue(false);

    await expect(requireCapability("manage_finance")).rejects.toThrow("Unauthorized");
  });

  it("throws Unauthorized when there is no session user", async () => {
    signedOut();
    mockCan.mockReturnValue(true);

    await expect(requireCapability("view_platform")).rejects.toThrow("Unauthorized");
    // Capability is never consulted once the user is missing.
    expect(mockCan).not.toHaveBeenCalled();
  });

  it("throws Unauthorized when the session user has no id", async () => {
    mockAuth.mockResolvedValue({ user: { id: "", platformRole: "HR-000", isSuperuser: false } } as never);
    mockCan.mockReturnValue(true);

    await expect(requireCapability("manage_platform")).rejects.toThrow("Unauthorized");
  });
});

describe("withCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the guarded callback with { userId } when granted", async () => {
    signedIn("user-7");
    mockCan.mockReturnValue(true);

    const fn = vi.fn(async (ctx: { userId: string }) => `ok:${ctx.userId}`);
    await expect(withCapability("manage_backlog", fn)).resolves.toBe("ok:user-7");
    expect(fn).toHaveBeenCalledWith({ userId: "user-7" });
  });

  it("throws and never runs the callback when denied", async () => {
    signedIn("user-7", "EMP-100");
    mockCan.mockReturnValue(false);

    const fn = vi.fn();
    await expect(withCapability("manage_backlog", fn)).rejects.toThrow("Unauthorized");
    expect(fn).not.toHaveBeenCalled();
  });
});
