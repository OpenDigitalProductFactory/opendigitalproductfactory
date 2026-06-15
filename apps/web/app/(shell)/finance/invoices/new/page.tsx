// apps/web/app/(shell)/finance/invoices/new/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";
import { CreateInvoiceForm } from "@/components/finance/CreateInvoiceForm";
import { getInvoiceDefaultTaxRate } from "@/lib/actions/financial-setup";
import { defaultSignatureRequiredForArchetype } from "@/lib/finance/invoice-signature-default";

export default async function NewInvoicePage() {
  // Default the TAX % field from the org's wizard VAT selection, not a 20% hardcode
  // (shared with the recurring-schedule form via getInvoiceDefaultTaxRate).
  const [customers, storefront, defaultTaxRate, orgSettings] = await Promise.all([
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
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { archetypeId: true } } },
    }),
    getInvoiceDefaultTaxRate(),
    prisma.orgSettings.findFirst({ select: { baseCurrency: true } }),
  ]);

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
        defaultCurrency={orgSettings?.baseCurrency ?? "USD"}
      />
    </div>
  );
}
