// apps/web/app/(shell)/finance/invoices/new/page.tsx
import { prisma } from "@dpf/db";
import { getFinancialProfile } from "@dpf/finance-templates";
import Link from "next/link";
import { CreateInvoiceForm } from "@/components/finance/CreateInvoiceForm";
import { resolveInvoiceDefaultTaxRate } from "@/lib/finance/invoice-default-tax";
import { defaultSignatureRequiredForArchetype } from "@/lib/finance/invoice-signature-default";

export default async function NewInvoicePage() {
  const [customers, taxProfile, orgSettings, storefront] = await Promise.all([
    prisma.customerAccount.findMany({
      where: {
        status: { in: ["active", "prospect", "qualified", "onboarding"] },
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        accountId: true,
        name: true,
        currency: true,
      },
    }),
    prisma.organizationTaxProfile.findFirst({ select: { taxModel: true } }),
    prisma.orgSettings.findFirst({ select: { appliedProfileSlug: true } }),
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { archetypeId: true } } },
    }),
  ]);

  // Default the TAX % field from the org's wizard VAT selection, not a 20% hardcode.
  const financeProfile = orgSettings?.appliedProfileSlug
    ? getFinancialProfile(orgSettings.appliedProfileSlug)
    : null;
  const defaultTaxRate = resolveInvoiceDefaultTaxRate({
    taxModel: taxProfile?.taxModel ?? null,
    profileVatRegistered: financeProfile?.vatRegistered ?? null,
    profileDefaultTaxRate: financeProfile?.defaultTaxRate ?? null,
  });

  // Default "require signature" on for regulated archetypes (legal/accounting).
  const defaultSignatureRequired = defaultSignatureRequiredForArchetype(
    storefront?.archetype?.archetypeId ?? null,
  );

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/invoices"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Invoices
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">New</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">New Invoice</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Create a draft invoice to send to a customer
        </p>
      </div>

      <CreateInvoiceForm
        customers={customers}
        defaultTaxRate={defaultTaxRate}
        defaultSignatureRequired={defaultSignatureRequired}
      />
    </div>
  );
}
