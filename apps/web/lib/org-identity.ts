import { prisma } from "@dpf/db";

// Shared resolver for the install's own business identity — the issuer behind
// invoices, emails, and other outbound artifacts. Sourced from live DB
// (Organization + tax registration + bank account), never a hardcoded
// "Acme"/"your provider"/example.com placeholder.

export type OrgBankDetails = {
  bankName: string | null;
  accountName: string | null;
  accountNumber: string | null;
  sortCode: string | null;
  iban: string | null;
};

export type OrgIdentity = {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLines: string[];
  logoUrl: string | null;
  vatNumber: string | null;
  bank: OrgBankDetails | null;
};

const ADDRESS_KEYS = [
  "line1",
  "line2",
  "street",
  "city",
  "region",
  "state",
  "county",
  "postalCode",
  "postcode",
  "zip",
  "country",
];

function formatAddress(address: unknown): string[] {
  if (!address || typeof address !== "object") return [];
  const a = address as Record<string, unknown>;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const key of ADDRESS_KEYS) {
    const v = a[key];
    if (typeof v === "string") {
      const t = v.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        lines.push(t);
      }
    }
  }
  return lines;
}

/**
 * Resolve the install's business identity. Returns null if no Organization
 * record exists. Callers MUST treat null / missing fields as "unknown" rather
 * than substituting a placeholder.
 */
export async function getOrgIdentity(): Promise<OrgIdentity | null> {
  const org = await prisma.organization.findFirst({
    select: {
      name: true,
      legalName: true,
      email: true,
      phone: true,
      website: true,
      address: true,
      logoUrl: true,
      taxProfile: {
        select: {
          registrations: {
            select: { taxType: true, registrationNumber: true, registrationStatus: true },
          },
        },
      },
    },
  });
  if (!org) return null;

  const regs = org.taxProfile?.registrations ?? [];
  const withNumber = regs.filter((r) => r.registrationNumber && r.registrationStatus !== "draft");
  const vat =
    withNumber.find((r) => /vat/i.test(r.taxType)) ??
    withNumber[0] ??
    regs.find((r) => r.registrationNumber) ??
    null;

  const bankRow = await prisma.bankAccount.findFirst({
    where: { status: "active" },
    orderBy: { name: "asc" },
    select: { name: true, bankName: true, accountNumber: true, sortCode: true, iban: true },
  });

  return {
    name: org.legalName?.trim() || org.name,
    email: org.email ?? null,
    phone: org.phone ?? null,
    website: org.website ?? null,
    addressLines: formatAddress(org.address),
    logoUrl: org.logoUrl ?? null,
    vatNumber: vat?.registrationNumber ?? null,
    bank: bankRow
      ? {
          bankName: bankRow.bankName ?? null,
          accountName: bankRow.name ?? null,
          accountNumber: bankRow.accountNumber ?? null,
          sortCode: bankRow.sortCode ?? null,
          iban: bankRow.iban ?? null,
        }
      : null,
  };
}
