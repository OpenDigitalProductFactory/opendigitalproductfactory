import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCookies, mockHeaders, mockDb, mockResolvePrincipal } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCookies: vi.fn(),
  mockHeaders: vi.fn(),
  mockResolvePrincipal: vi.fn(),
  mockDb: {
    orgSettings: { findFirst: vi.fn() },
    businessProfile: { findFirst: vi.fn() },
    principal: { findUnique: vi.fn() },
  },
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T,>(fn: T) => fn,
}));
vi.mock("next/headers", () => ({ cookies: mockCookies, headers: mockHeaders }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/identity/principal-linking", () => ({
  resolvePrincipalRecordIdForSessionIdentity: mockResolvePrincipal,
}));
vi.mock("@dpf/db", () => ({ prisma: mockDb }));

import { getLocaleContext } from "./locale-context.server";

function jar(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name] } : undefined) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", type: "admin" } });
  mockCookies.mockResolvedValue(jar({}));
  mockHeaders.mockResolvedValue(new Headers({ "accept-language": "en-GB,en;q=0.9" }));
  mockDb.orgSettings.findFirst.mockResolvedValue({ baseCurrency: "USD", locale: "en-US", countryCode: "US" });
  mockDb.businessProfile.findFirst.mockResolvedValue({ timezone: "America/Chicago" });
  mockResolvePrincipal.mockResolvedValue("principal-row-1");
  mockDb.principal.findUnique.mockResolvedValue({ preferredLanguage: null, timeZone: null });
});

describe("getLocaleContext (server binding)", () => {
  it("resolves the default English context from live inputs", async () => {
    expect(await getLocaleContext()).toMatchObject({ language: "en-US", dir: "ltr", timeZone: "America/Chicago" });
  });

  it("reads the Principal by its relational id, not the public principalId", async () => {
    mockDb.principal.findUnique.mockResolvedValue({ preferredLanguage: "en-US", timeZone: "Europe/Madrid" });
    const ctx = await getLocaleContext();
    expect(mockResolvePrincipal).toHaveBeenCalledWith({ type: "admin", id: "user-1" });
    expect(mockDb.principal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "principal-row-1" } }),
    );
    expect(ctx.timeZone).toBe("Europe/Madrid");
  });

  it("applies an admin's ar-XB preview cookie as rtl", async () => {
    mockCookies.mockResolvedValue(jar({ "dpf-locale": "ar-XB" }));
    expect(await getLocaleContext()).toMatchObject({ language: "ar-XB", dir: "rtl" });
  });

  it("never throws: a failing session or database falls back to en-US", async () => {
    mockAuth.mockRejectedValue(new Error("no session"));
    mockDb.orgSettings.findFirst.mockRejectedValue(new Error("db down"));
    mockDb.businessProfile.findFirst.mockRejectedValue(new Error("db down"));
    expect(await getLocaleContext()).toMatchObject({ language: "en-US", dir: "ltr", displayCurrency: "USD" });
  });
});
