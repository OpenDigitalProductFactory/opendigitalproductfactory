import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    customerContact: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { detectEmailType, EmailType } from "./storefront-auth";
import { prisma } from "@dpf/db";

describe("detectEmailType", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns customer when email found in CustomerContact", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await detectEmailType("customer@example.com")).toBe(EmailType.Customer);
  });

  it("returns employee when email found in User", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1" } as never);
    expect(await detectEmailType("employee@example.com")).toBe(EmailType.Employee);
  });

  it("returns unknown when email not found in either table", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await detectEmailType("new@example.com")).toBe(EmailType.Unknown);
  });
});
