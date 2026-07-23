// Partner identity — EP-PARTNER-CHANNEL Phase 2 (BI-DE47EC0B).
//
// Contract under test: a partner contact converges onto the SAME Principal
// spine as every other party (no parallel partner identity table), and the
// `partner` kind is DERIVED from the account's live PartnerProgramEnrollment
// rather than asserted by the caller.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    employeeProfile: { findUnique: vi.fn() },
    agent: { findUnique: vi.fn() },
    customerContact: { findUnique: vi.fn() },
    principal: { create: vi.fn(), update: vi.fn() },
    principalAlias: { findFirst: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { syncPartnerPrincipal, principalKindForContact } from "./principal-linking";

const NOW = new Date("2026-07-23T00:00:00Z");

function partnerContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    email: "Tech@LocalMSP.example",
    isActive: true,
    account: {
      accountId: "ACC-MSP-1",
      partnerEnrollment: { status: "active", endedAt: null },
    },
    ...overrides,
  };
}

function mockCreatedPrincipal(kind: string) {
  vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.principal.create).mockResolvedValue({
    id: "principal-db-partner",
    principalId: "PRN-000900",
    kind,
    status: "active",
    displayName: "Tech@LocalMSP.example",
    sponsorPrincipalId: null,
    authorityMode: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  vi.mocked(prisma.principalAlias.createMany).mockResolvedValue({ count: 2 });
  vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
    {
      id: "alias-partner-contact",
      principalId: "principal-db-partner",
      aliasType: "partner_contact",
      aliasValue: "contact-1",
      issuer: "",
      createdAt: NOW,
    },
    {
      id: "alias-email",
      principalId: "principal-db-partner",
      aliasType: "email",
      aliasValue: "tech@localmsp.example",
      issuer: "",
      createdAt: NOW,
    },
  ] as never);
}

beforeEach(() => vi.clearAllMocks());

describe("syncPartnerPrincipal", () => {
  it("creates a partner principal anchored by partner_contact and email aliases", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(partnerContact() as never);
    mockCreatedPrincipal("partner");

    const result = await syncPartnerPrincipal("contact-1");

    expect(result.kind).toBe("partner");
    expect(prisma.principal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "partner" }) }),
    );
    // Email alias is lowercased so a partner contact converges with the SAME
    // person already known as a customer contact — one principal, not two.
    const aliasTypes = result.aliases.map((a) => a.aliasType).sort();
    expect(aliasTypes).toEqual(["email", "partner_contact"]);
    expect(result.aliases.find((a) => a.aliasType === "email")?.aliasValue).toBe(
      "tech@localmsp.example",
    );
  });

  it("re-kinds an EXISTING principal instead of creating a parallel partner identity", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(partnerContact() as never);
    // The same person already exists as a customer-kind principal (found by alias).
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue({
      id: "alias-email",
      principalId: "principal-db-partner",
      aliasType: "email",
      aliasValue: "tech@localmsp.example",
      issuer: "",
      createdAt: NOW,
      principal: {
        id: "principal-db-partner",
        principalId: "PRN-000900",
        kind: "customer",
        status: "active",
        displayName: "Tech@LocalMSP.example",
        sponsorPrincipalId: null,
        authorityMode: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    } as never);
    vi.mocked(prisma.principal.update).mockResolvedValue({
      id: "principal-db-partner",
      principalId: "PRN-000900",
      kind: "partner",
      status: "active",
      displayName: "Tech@LocalMSP.example",
      sponsorPrincipalId: null,
      authorityMode: null,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    vi.mocked(prisma.principalAlias.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([] as never);

    const result = await syncPartnerPrincipal("contact-1");

    expect(prisma.principal.create).not.toHaveBeenCalled();
    expect(prisma.principal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "principal-db-partner" },
        data: expect.objectContaining({ kind: "partner" }),
      }),
    );
    expect(result.principalId).toBe("PRN-000900");
  });

  it("refuses to promote a contact whose account has no live enrolment", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(
      partnerContact({ account: { accountId: "ACC-PLAIN", partnerEnrollment: null } }) as never,
    );

    await expect(syncPartnerPrincipal("contact-1")).rejects.toThrow(/not a partner contact/i);
    expect(prisma.principal.create).not.toHaveBeenCalled();
    expect(prisma.principal.update).not.toHaveBeenCalled();
  });

  it("treats an ended enrolment as not a partner", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(
      partnerContact({
        account: {
          accountId: "ACC-EX",
          partnerEnrollment: { status: "ended", endedAt: new Date("2026-06-01T00:00:00Z") },
        },
      }) as never,
    );

    await expect(syncPartnerPrincipal("contact-1")).rejects.toThrow(/no live PartnerProgramEnrollment/i);
  });

  it("throws a clear error when the contact does not exist", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(null as never);
    await expect(syncPartnerPrincipal("missing")).rejects.toThrow(/not found/i);
  });

  it("carries inactive contact status onto the principal", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(
      partnerContact({ isActive: false }) as never,
    );
    mockCreatedPrincipal("partner");

    await syncPartnerPrincipal("contact-1");

    expect(prisma.principal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "inactive" }) }),
    );
  });
});

describe("principalKindForContact", () => {
  it("derives partner from a live enrolment", () => {
    expect(principalKindForContact({ partnerEnrollment: { status: "active", endedAt: null } })).toBe(
      "partner",
    );
    expect(
      principalKindForContact({ partnerEnrollment: { status: "prospect", endedAt: null } }),
    ).toBe("partner");
  });

  it("derives customer with no enrolment, or an ended one", () => {
    expect(principalKindForContact({ partnerEnrollment: null })).toBe("customer");
    expect(principalKindForContact({})).toBe("customer");
    expect(
      principalKindForContact({ partnerEnrollment: { status: "ended", endedAt: NOW } }),
    ).toBe("customer");
  });

  it("is the single derivation rule — an account is never both kinds at once", () => {
    // The enrolment is additive (an MSP can be customer AND partner as a
    // business), but the PRINCIPAL kind is single-valued and deterministic.
    const kinds = new Set([
      principalKindForContact({ partnerEnrollment: { status: "active", endedAt: null } }),
      principalKindForContact({ partnerEnrollment: { status: "active", endedAt: null } }),
    ]);
    expect(kinds.size).toBe(1);
  });
});
