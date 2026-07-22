// apps/web/app/(shell)/finance/invoices/new/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";
import { CreateInvoiceForm } from "@/components/finance/CreateInvoiceForm";
import { getInvoiceDefaultTaxRate } from "@/lib/actions/financial-setup";
import { defaultSignatureRequiredForArchetype } from "@/lib/finance/invoice-signature-default";
import {
  isFinanceInvoiceContext,
  resolveFinanceInvoiceCopy,
  resolveFinanceSurface,
} from "@/lib/finance/finance-surface";

type Props = { searchParams: Promise<{ from?: string }> };

export default async function NewInvoicePage({ searchParams }: Props) {
  const { from } = await searchParams;

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
      select: { archetype: { select: { archetypeId: true, category: true } } },
    }),
    getInvoiceDefaultTaxRate(),
    prisma.orgSettings.findFirst({ select: { baseCurrency: true } }),
  ]);

  // Default "require signature" on for regulated archetypes (legal/accounting).
  const defaultSignatureRequired = defaultSignatureRequiredForArchetype(
    storefront?.archetype?.archetypeId ?? null,
  );

  const category = storefront?.archetype?.category ?? null;
  const surface = resolveFinanceSurface(category);
  const copy = resolveFinanceInvoiceCopy(category);

  // When the form is opened from a Restaurant billing context (?from=booking …),
  // lead with that context's framing instead of the generic customer-first copy.
  const context = isFinanceInvoiceContext(from) ? from : null;
  const contextCopy = context ? copy.contexts[context] : null;
  const heading = contextCopy?.title ?? "New Invoice";
  const subhead = contextCopy?.description ?? copy.newInvoiceSubhead;
  const contextLabel =
    context && context !== "no-show"
      ? surface.invoiceEntryPoints.find((entry) => entry.id === context)?.label ?? null
      : context === "no-show"
        ? "No-show fee"
        : null;

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
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{heading}</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{subhead}</p>
      </div>

      {/* Restaurant billing entry points — start from a booking, order, catering,
          or private event rather than only a generic customer dropdown. */}
      {surface.mode === "owner-first" && surface.invoiceEntryPoints.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Start from
          </p>
          <div className="flex flex-wrap gap-2">
            {surface.invoiceEntryPoints.map((entry) => {
              const active = context === entry.id || (entry.id === "blank" && context === null);
              return (
                <Link
                  key={entry.id}
                  href={entry.href}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                    active
                      ? "border-[var(--dpf-accent)] bg-[color-mix(in_srgb,var(--dpf-accent)_12%,transparent)] text-[var(--dpf-text)]"
                      : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]",
                  ].join(" ")}
                >
                  {entry.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <CreateInvoiceForm
        customers={customers}
        defaultTaxRate={defaultTaxRate}
        defaultSignatureRequired={defaultSignatureRequired}
        defaultCurrency={orgSettings?.baseCurrency ?? "USD"}
        customerLabel={copy.customerLabel}
        signatureHint={copy.signatureHint}
        contextLabel={contextLabel}
      />
    </div>
  );
}
