import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadQuickBooksPreview } from "@/lib/integrate/quickbooks/preview";
import {
  QuickBooksConnectPanel,
  type QuickBooksConnectionState,
} from "@/components/integrations/QuickBooksConnectPanel";

export default async function QuickBooksIntegrationPage() {
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
    where: { integrationId: "quickbooks-online-accounting" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadQuickBooksPreview() : null;
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
          <span>QuickBooks</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">QuickBooks Online</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured finance integration. DPF stores your Intuit credentials encrypted in
          this install and uses read-first accounting probes before any write workflows are added.
        </p>
      </div>

      <QuickBooksConnectPanel initialState={initialState} />
      <QuickBooksPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies tenant-scoped QuickBooks connectivity with your own Intuit app credentials.</li>
          <li>Reads company profile plus a sample customer and invoice through the Accounting API.</li>
          <li>Keeps the connection on the native enterprise-integration substrate instead of a one-off secret store.</li>
          <li>Sets the platform up for later invoice, payment, and billing automation without skipping governance.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): QuickBooksConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      companyName: null,
      realmId: null,
      lastErrorMsg: null,
      lastTestedAt: null,
      environment: null,
    };
  }

  const decoded = decryptJson<{
    companyName?: string;
    realmId?: string;
    environment?: string;
  }>(record.fieldsEnc);

  return {
    status: record.status === "connected" || record.status === "error" ? record.status : "unconfigured",
    companyName: typeof decoded?.companyName === "string" ? decoded.companyName : null,
    realmId: typeof decoded?.realmId === "string" ? decoded.realmId : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
    environment:
      decoded?.environment === "sandbox" || decoded?.environment === "production"
        ? decoded.environment
        : null,
  };
}

function applyPreviewToConnectionState(
  state: QuickBooksConnectionState,
  preview: Awaited<ReturnType<typeof loadQuickBooksPreview>> | null,
): QuickBooksConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      companyName:
        typeof preview.preview.companyInfo.CompanyName === "string"
          ? preview.preview.companyInfo.CompanyName
          : state.companyName,
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

function QuickBooksPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadQuickBooksPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh QuickBooks preview data for this tenant.
        </p>
        <p className="mt-2 font-medium text-amber-700">{preview.error}</p>
      </section>
    );
  }

  if (preview.state === "unavailable") {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          Connect QuickBooks credentials to load live company, customer, and invoice context.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live accounting preview</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first sample data from the connected QuickBooks tenant.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded {formatDateTime(previewData.loadedAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <PreviewCard title="Company" fallback="No company profile returned.">
          <PreviewRow label="Name" value={previewData.companyInfo.CompanyName} />
          <PreviewRow label="Country" value={previewData.companyInfo.Country} />
        </PreviewCard>
        <PreviewCard title="Sample customer" fallback="No customers returned yet.">
          <PreviewRow label="Name" value={previewData.sampleCustomer?.DisplayName} />
          <PreviewRow label="ID" value={previewData.sampleCustomer?.Id} />
        </PreviewCard>
        <PreviewCard title="Sample invoice" fallback="No invoices returned yet.">
          <PreviewRow label="Doc #" value={previewData.sampleInvoice?.DocNumber} />
          <PreviewRow label="ID" value={previewData.sampleInvoice?.Id} />
        </PreviewCard>
      </div>
    </section>
  );
}

function PreviewCard({
  title,
  fallback,
  children,
}: {
  title: string;
  fallback: string;
  children: React.ReactNode;
}) {
  const content = Array.isArray(children) ? children.filter(Boolean) : children;

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <h3 className="font-medium text-[var(--dpf-text)]">{title}</h3>
      <div className="mt-3 space-y-2 text-[var(--dpf-muted)]">
        {hasRenderableChildren(content) ? content : <p>{fallback}</p>}
      </div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: unknown }) {
  if (typeof value !== "string" || value.length === 0) return null;

  return (
    <div className="flex items-start justify-between gap-3">
      <span>{label}</span>
      <span className="text-right text-[var(--dpf-text)]">{value}</span>
    </div>
  );
}

function hasRenderableChildren(value: React.ReactNode): boolean {
  if (Array.isArray(value)) {
    return value.some(Boolean);
  }
  return Boolean(value);
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
