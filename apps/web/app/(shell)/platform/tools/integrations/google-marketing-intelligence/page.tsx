import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadGoogleMarketingPreview } from "@/lib/integrate/google-marketing-intelligence/preview";
import {
  GoogleMarketingIntelligenceConnectPanel,
  type GoogleMarketingIntelligenceConnectionState,
} from "@/components/integrations/GoogleMarketingIntelligenceConnectPanel";

export default async function GoogleMarketingIntelligencePage() {
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
    where: { integrationId: "google-marketing-intelligence" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadGoogleMarketingPreview() : null;
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
          <span>Google Marketing Intelligence</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">
          Google Marketing Intelligence
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured Google marketing integration. DPF stores your OAuth credentials
          encrypted in this install and uses read-first GA4 and Search Console probes before any
          campaign write workflows are added.
        </p>
      </div>

      <GoogleMarketingIntelligenceConnectPanel initialState={initialState} />
      <GoogleMarketingPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies customer-scoped Google OAuth connectivity for both GA4 and Search Console.</li>
          <li>Reads traffic, user, and conversion context from GA4 plus search query/page context from Search Console.</li>
          <li>Supports strategy-first marketing work before deeper campaign automation is added.</li>
          <li>Creates a clean marketing-intelligence base for follow-on localized lead channels like Facebook Lead Ads.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(
  record: IntegrationCredentialRow,
): GoogleMarketingIntelligenceConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      ga4PropertyId: null,
      searchConsoleSiteUrl: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{
    ga4PropertyId?: string;
    searchConsoleSiteUrl?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error"
        ? record.status
        : "unconfigured",
    ga4PropertyId: typeof decoded?.ga4PropertyId === "string" ? decoded.ga4PropertyId : null,
    searchConsoleSiteUrl:
      typeof decoded?.searchConsoleSiteUrl === "string" ? decoded.searchConsoleSiteUrl : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: GoogleMarketingIntelligenceConnectionState,
  preview: Awaited<ReturnType<typeof loadGoogleMarketingPreview>> | null,
): GoogleMarketingIntelligenceConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
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

function GoogleMarketingPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadGoogleMarketingPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh Google marketing preview data for this connection.
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
          Connect Google credentials to load live GA4 and Search Console context.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">
            Live marketing intelligence preview
          </h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first traffic, conversion, and search demand data from the connected Google
            properties.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded {formatDateTime(previewData.loadedAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <MetricCard title="Sessions" value={String(previewData.analyticsSummary.sessions)} />
        <MetricCard title="Users" value={String(previewData.analyticsSummary.totalUsers)} />
        <MetricCard title="Conversions" value={String(previewData.analyticsSummary.conversions)} />
      </div>

      <div className="mt-4">
        <PreviewListCard
          title="Top search opportunities"
          items={previewData.searchConsoleRows.map((row) => ({
            primary: row.keys?.[0] ?? "",
            secondary:
              [row.keys?.[1] ?? null, formatRowMetrics(row)].filter(Boolean).join(" • ") || null,
          }))}
          empty="No Search Console rows returned yet."
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
            <div
              key={`${item.primary}-${item.secondary ?? ""}`}
              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2"
            >
              <div className="font-medium text-[var(--dpf-text)]">{item.primary}</div>
              {item.secondary && (
                <div className="text-xs text-[var(--dpf-muted)]">{item.secondary}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
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

function formatRowMetrics(row: {
  clicks?: number;
  impressions?: number;
  position?: number;
}): string | null {
  const parts = [
    typeof row.clicks === "number" ? `${row.clicks} clicks` : null,
    typeof row.impressions === "number" ? `${row.impressions} impressions` : null,
    typeof row.position === "number" ? `avg pos ${row.position}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
}
