import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadStripePreview } from "@/lib/integrate/stripe/preview";
import {
  StripeConnectPanel,
  type StripeConnectionState,
} from "@/components/integrations/StripeConnectPanel";

export default async function StripeIntegrationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    redirect("/platform/tools");
  }

  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: "stripe-billing-payments" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadStripePreview() : null;
  const initialState = applyPreviewToConnectionState(baseState, preview);

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
          <a href="/platform/tools" className="hover:underline">
            Tools
          </a>
          <span>/</span>
          <span>Enterprise Integrations</span>
          <span>/</span>
          <span>Stripe</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">Stripe Billing &amp; Payments</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured payments integration. DPF stores your Stripe key encrypted in this install
          and uses read-first probes before any billing or payment automation is added.
        </p>
      </div>

      <StripeConnectPanel initialState={initialState} />
      <StripePreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies Stripe connectivity with a customer-supplied key in this install only.</li>
          <li>Reads current balance plus customer, invoice, and payment intent context.</li>
          <li>Keeps Stripe on the native enterprise-integration substrate instead of a one-off secret store.</li>
          <li>Sets the platform up for later invoice collection, payment operations, and revenue workflows.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): StripeConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      mode: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{ mode?: string }>(record.fieldsEnc);

  return {
    status: record.status === "connected" || record.status === "error" ? record.status : "unconfigured",
    mode: decoded?.mode === "test" || decoded?.mode === "live" ? decoded.mode : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: StripeConnectionState,
  preview: Awaited<ReturnType<typeof loadStripePreview>> | null,
): StripeConnectionState {
  if (!preview) return state;
  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      mode: preview.preview.balance.livemode ? "live" : "test",
      lastErrorMsg: null,
      lastTestedAt: preview.preview.loadedAt,
    };
  }
  if (preview.state === "error") {
    return {
      ...state,
      status: "error",
      lastErrorMsg: preview.error,
    };
  }
  return state;
}

function StripePreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadStripePreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-2 font-medium text-amber-700">{preview.error}</p>
      </section>
    );
  }

  if (preview.state === "unavailable") {
    return null;
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live payments preview</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first sample data from the connected Stripe account.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded {formatDateTime(previewData.loadedAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Mode" value={previewData.balance.livemode ? "Live" : "Test"} />
        <MetricCard title="Available balance" value={formatStripeAmounts(previewData.balance.available)} />
        <MetricCard title="Pending balance" value={formatStripeAmounts(previewData.balance.pending)} />
        <MetricCard title="Recent payment intents" value={String(previewData.recentPaymentIntents.length)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <PreviewListCard
          title="Recent customers"
          items={previewData.recentCustomers.map((customer) => ({
            primary: customer.name ?? customer.id ?? "",
            secondary: customer.email ?? null,
          }))}
          empty="No customers returned yet."
        />
        <PreviewListCard
          title="Recent invoices"
          items={previewData.recentInvoices.map((invoice) => ({
            primary: invoice.number ?? invoice.id ?? "",
            secondary: [invoice.status, formatCurrencyLike(invoice.amount_due, invoice.currency)].filter(Boolean).join(" • ") || null,
          }))}
          empty="No invoices returned yet."
        />
        <PreviewListCard
          title="Recent payment intents"
          items={previewData.recentPaymentIntents.map((intent) => ({
            primary: intent.description ?? intent.id ?? "",
            secondary: [intent.status, formatCurrencyLike(intent.amount, intent.currency)].filter(Boolean).join(" • ") || null,
          }))}
          empty="No payment intents returned yet."
        />
      </div>
    </section>
  );
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--dpf-muted)]">{title}</p>
      <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

function PreviewListCard({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ primary: string; secondary: string | null }>;
  empty: string;
}) {
  const visibleItems = items.filter((item) => item.primary.length > 0);

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <h3 className="font-medium text-[var(--dpf-text)]">{title}</h3>
      <div className="mt-3 space-y-2 text-[var(--dpf-muted)]">
        {visibleItems.length === 0 ? (
          <p>{empty}</p>
        ) : (
          visibleItems.map((item) => (
            <div key={`${item.primary}-${item.secondary ?? ""}`} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2">
              <div className="font-medium text-[var(--dpf-text)]">{item.primary}</div>
              {item.secondary && <div className="text-xs text-[var(--dpf-muted)]">{item.secondary}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatStripeAmounts(amounts: Array<{ amount?: number; currency?: string } | undefined> | undefined): string {
  const first = amounts?.find((amount) => typeof amount?.amount === "number");
  return formatCurrencyLike(first?.amount, first?.currency) ?? "Unavailable";
}

function formatCurrencyLike(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== "number" || Number.isNaN(amount)) return null;
  if (typeof currency !== "string" || currency.length === 0) return `${amount}`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
