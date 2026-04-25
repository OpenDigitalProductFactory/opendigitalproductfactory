import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadHubSpotPreview } from "@/lib/integrate/hubspot/preview";
import {
  HubSpotConnectPanel,
  type HubSpotConnectionState,
} from "@/components/integrations/HubSpotConnectPanel";

export default async function HubSpotIntegrationPage() {
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
    where: { integrationId: "hubspot-marketing-crm" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadHubSpotPreview() : null;
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
          <span>HubSpot</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">HubSpot CRM &amp; Marketing</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured marketing and CRM integration. DPF stores your HubSpot token
          encrypted in this install and uses read-first marketing probes before any campaign write
          workflows are added.
        </p>
      </div>

      <HubSpotConnectPanel initialState={initialState} />
      <HubSpotPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies tenant-scoped HubSpot connectivity with customer-supplied private app credentials.</li>
          <li>Reads account details, recent contacts, and lead-capture forms through official HubSpot APIs.</li>
          <li>Supports a marketing-first workspace with approved CRM and campaign context instead of ad hoc prompts.</li>
          <li>Sets the platform up for later list, campaign, and lifecycle automation without skipping governance.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): HubSpotConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      portalId: null,
      accountType: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{
    portalId?: number;
    accountType?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error"
        ? record.status
        : "unconfigured",
    portalId: typeof decoded?.portalId === "number" ? decoded.portalId : null,
    accountType: typeof decoded?.accountType === "string" ? decoded.accountType : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: HubSpotConnectionState,
  preview: Awaited<ReturnType<typeof loadHubSpotPreview>> | null,
): HubSpotConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      portalId:
        typeof preview.preview.account.portalId === "number"
          ? preview.preview.account.portalId
          : state.portalId,
      accountType:
        typeof preview.preview.account.accountType === "string"
          ? preview.preview.account.accountType
          : state.accountType,
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

function HubSpotPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadHubSpotPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh HubSpot preview data for this portal.
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
          Connect HubSpot credentials to load live contact and form context.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live marketing preview</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first sample data from the connected HubSpot portal.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded {formatDateTime(previewData.loadedAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <PreviewCard title="Portal" fallback="No account details returned.">
          <PreviewRow label="Portal ID" value={formatNumber(previewData.account.portalId)} />
          <PreviewRow label="Account type" value={previewData.account.accountType ?? null} />
          <PreviewRow label="UI domain" value={previewData.account.uiDomain ?? null} />
        </PreviewCard>
        <PreviewCard title="Recent contacts" fallback="No contacts returned yet.">
          <PreviewList
            items={previewData.recentContacts.map((contact) => ({
              primary: formatContactName(contact),
              secondary: contact.properties?.email ?? null,
            }))}
          />
        </PreviewCard>
        <PreviewCard title="Recent forms" fallback="No forms returned yet.">
          <PreviewList
            items={previewData.recentForms.map((form) => ({
              primary: form.name,
              secondary: form.formType ?? null,
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
      <div className="mt-3 space-y-2 text-[var(--dpf-muted)]">
        {hasRenderableChildren(content) ? content : <p>{fallback}</p>}
      </div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string | null }) {
  if (typeof value !== "string" || value.length === 0) return null;

  return (
    <div className="flex items-start justify-between gap-3">
      <span>{label}</span>
      <span className="text-right text-[var(--dpf-text)]">{value}</span>
    </div>
  );
}

function PreviewList({
  items,
}: {
  items: Array<{ primary: string | undefined; secondary: string | null }>;
}) {
  const visibleItems = items.filter(
    (item) => typeof item.primary === "string" && item.primary.length > 0,
  );
  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleItems.map((item) => (
        <div
          key={`${item.primary}-${item.secondary ?? ""}`}
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2"
        >
          <div className="font-medium text-[var(--dpf-text)]">{item.primary}</div>
          {item.secondary && <div className="text-xs text-[var(--dpf-muted)]">{item.secondary}</div>}
        </div>
      ))}
    </div>
  );
}

function hasRenderableChildren(value: React.ReactNode): boolean {
  if (Array.isArray(value)) {
    return value.some(Boolean);
  }
  return Boolean(value);
}

function formatContactName(contact: {
  properties?: Record<string, string | null | undefined>;
}): string | undefined {
  const first = contact.properties?.firstname ?? "";
  const last = contact.properties?.lastname ?? "";
  const full = `${first} ${last}`.trim();
  return full || (contact.properties?.email ?? undefined);
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

function formatNumber(value: unknown): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return new Intl.NumberFormat().format(value);
}
