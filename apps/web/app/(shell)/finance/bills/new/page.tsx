// apps/web/app/(shell)/finance/bills/new/page.tsx
import { prisma } from "@dpf/db";
import { getFinancialProfile } from "@dpf/finance-templates";
import { listSuppliers, listPurchaseOrders } from "@/lib/actions/ap";
import { getOrgSettings } from "@/lib/actions/currency";
import { CreateBillForm } from "@/components/finance/CreateBillForm";
import Link from "next/link";

type Props = { searchParams: Promise<{ supplierId?: string }> };

// Default line-item tax rate: 0 unless the org configured a VAT/GST tax model at
// setup. Avoids the legacy hardcoded 20% UK VAT default on US (and other
// non-VAT) installs.
async function getDefaultBillTaxRate(appliedProfileSlug: string | null): Promise<number> {
  const taxProfile = await prisma.organizationTaxProfile.findFirst({
    select: { taxModel: true },
  });
  if (taxProfile?.taxModel !== "vat") return 0;
  const profile = appliedProfileSlug ? getFinancialProfile(appliedProfileSlug) : null;
  return profile?.defaultTaxRate ?? 0;
}

export default async function NewBillPage({ searchParams }: Props) {
  const { supplierId } = await searchParams;

  const [suppliers, purchaseOrders, orgSettings] = await Promise.all([
    listSuppliers(),
    listPurchaseOrders(),
    getOrgSettings(),
  ]);
  const defaultTaxRate = await getDefaultBillTaxRate(orgSettings.appliedProfileSlug ?? null);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/bills" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Bills
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">New Bill</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">New Bill</h1>

      <div className="max-w-3xl">
        <CreateBillForm
          suppliers={suppliers.map((s) => ({
            id: s.id,
            supplierId: s.supplierId,
            name: s.name,
            defaultCurrency: s.defaultCurrency,
          }))}
          purchaseOrders={purchaseOrders.map((po) => ({
            id: po.id,
            poNumber: po.poNumber,
            supplierId: po.supplierId,
            lineItems: po.lineItems.map((li) => ({
              description: li.description,
              quantity: Number(li.quantity),
              unitPrice: Number(li.unitPrice),
              taxRate: Number(li.taxRate),
            })),
          }))}
          {...(supplierId ? { defaultSupplierId: supplierId } : {})}
          defaultCurrency={orgSettings.baseCurrency}
          defaultTaxRate={defaultTaxRate}
        />
      </div>
    </div>
  );
}
