import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadFacebookLeadAdsPreview } from "@/lib/integrate/facebook-lead-ads/preview";
import {
  FacebookLeadAdsConnectPanel,
  type FacebookLeadAdsConnectionState,
} from "@/components/integrations/FacebookLeadAdsConnectPanel";

export default async function FacebookLeadAdsPage() {
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
    where: { integrationId: "facebook-lead-ads" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadFacebookLeadAdsPreview() : null;
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
          <span>Facebook Lead Ads</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">Facebook Lead Ads</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured local lead capture integration. DPF stores your Meta token encrypted
          in this install and uses read-first lead-form and lead-retrieval probes before any
          automation or webhook write workflows are added.
        </p>
      </div>

      <FacebookLeadAdsConnectPanel initialState={initialState} />
      <FacebookLeadAdsPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies customer-scoped Meta page access for local Facebook lead generation forms.</li>
          <li>Reads lead forms and recent submissions without forcing DPF into ad-management workflows.</li>
          <li>Creates a practical bridge from localized lead capture into CRM and follow-up operations.</li>
          <li>Sets the platform up for later webhook-triggered lead routing and handoff automation.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): FacebookLeadAdsConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      pageId: null,
      pageName: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{
    pageId?: string;
    pageName?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error"
        ? record.status
        : "unconfigured",
    pageId: typeof decoded?.pageId === "string" ? decoded.pageId : null,
    pageName: typeof decoded?.pageName === "string" ? decoded.pageName : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: FacebookLeadAdsConnectionState,
  preview: Awaited<ReturnType<typeof loadFacebookLeadAdsPreview>> | null,
): FacebookLeadAdsConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      pageId: preview.preview.page.id,
      pageName: preview.preview.page.name,
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

function FacebookLeadAdsPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadFacebookLeadAdsPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh the Facebook Lead Ads preview for this page.
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
          Connect Meta page credentials to load local lead forms and recent submissions.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live lead preview</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first Meta page, form, and submission context from the connected lead source.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded {formatDateTime(previewData.loadedAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <PreviewCard title="Page" fallback="No page details returned.">
          <PreviewRow label="Page" value={previewData.page.name} />
          <PreviewRow label="Page ID" value={previewData.page.id} />
          <PreviewRow label="Category" value={previewData.page.category} />
        </PreviewCard>
        <PreviewCard title="Lead forms" fallback="No lead forms returned yet.">
          <PreviewList
            items={previewData.forms.map((form) => ({
              primary: form.name ?? form.id,
              secondary: form.status ?? form.locale ?? null,
            }))}
          />
        </PreviewCard>
        <PreviewCard title="Recent leads" fallback="No recent leads returned yet.">
          <PreviewList
            items={previewData.recentLeads.map((lead) => ({
              primary: lead.id,
              secondary: formatLeadSecondary(lead),
            }))}
          />
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
      <div className="mt-3">
        {hasContent(content) ? content : <p className="text-[var(--dpf-muted)]">{fallback}</p>}
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;

  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      <p className="font-medium text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

function PreviewList({
  items,
}: {
  items: Array<{ primary: string; secondary: string | null }>;
}) {
  if (!items.length) return null;

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={`${item.primary}-${item.secondary ?? ""}`} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <p className="font-medium text-[var(--dpf-text)]">{item.primary}</p>
          {item.secondary && <p className="text-xs text-[var(--dpf-muted)]">{item.secondary}</p>}
        </li>
      ))}
    </ul>
  );
}

function hasContent(content: React.ReactNode): boolean {
  if (Array.isArray(content)) return content.length > 0;
  return Boolean(content);
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

function formatLeadSecondary(lead: {
  formId: string | null;
  adId: string | null;
  fieldNames: string[];
}): string | null {
  const context = lead.formId ?? lead.adId;
  const fields = lead.fieldNames.length > 0 ? lead.fieldNames.join(", ") : null;

  if (context && fields) {
    return `${context} • ${fields}`;
  }

  return context ?? fields;
}
