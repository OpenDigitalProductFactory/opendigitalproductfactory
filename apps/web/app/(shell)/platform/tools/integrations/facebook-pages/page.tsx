import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { LocalTime } from "@/components/ui/LocalTime";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadFacebookPagesPreview } from "@/lib/integrations/facebook-pages/preview";
import {
  FacebookPagesConnectPanel,
  type FacebookPagesConnectionState,
} from "@/components/integrations/FacebookPagesConnectPanel";

export default async function FacebookPagesPage() {
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
    where: { integrationId: "facebook-pages" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadFacebookPagesPreview() : null;
  const initialState = applyPreviewToConnectionState(baseState, preview);

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
          <a href="/platform/tools" className="hover:underline">
            Tools
          </a>
          <span>/</span>
          <span>Native Integrations</span>
          <span>/</span>
          <span>Facebook Pages</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">Facebook Pages</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured local Facebook page presence integration. DPF stores your Meta token
          encrypted in this install and uses read-first page, post, and comment probes before any
          moderation or publishing workflows are added.
        </p>
      </div>

      <FacebookPagesConnectPanel initialState={initialState} />
      <FacebookPagesPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies customer-scoped Meta page access for localized brand presence and engagement.</li>
          <li>Reads recent page posts and comments without pushing DPF into social publishing by default.</li>
          <li>Creates a practical bridge from local social presence into review, lead, and follow-up operations.</li>
          <li>Sets the platform up for later supervised response drafts and routing-aware escalation.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): FacebookPagesConnectionState {
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
  state: FacebookPagesConnectionState,
  preview: Awaited<ReturnType<typeof loadFacebookPagesPreview>> | null,
): FacebookPagesConnectionState {
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

function FacebookPagesPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadFacebookPagesPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh the Facebook page preview for this page.
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
          Connect Meta page credentials to load live page, post, and comment context.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live page preview</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first Meta page, recent post, and comment context from the connected local presence source.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded <LocalTime value={previewData.loadedAt} options={{ year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} />
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <PreviewCard title="Page" fallback="No page details returned.">
          <PreviewRow label="Page" value={previewData.page.name} />
          <PreviewRow label="Page ID" value={previewData.page.id} />
          <PreviewRow label="Category" value={previewData.page.category} />
          <PreviewRow label="Followers" value={formatMetric(previewData.page.fanCount)} />
        </PreviewCard>
        <PreviewCard title="Recent posts" fallback="No recent posts returned yet.">
          <PreviewList
            items={previewData.recentPosts.map((post) => ({
              primary: post.message ?? post.id,
              secondary: post.createdTime,
            }))}
          />
        </PreviewCard>
        <PreviewCard title="Recent comments" fallback="No recent comments returned yet.">
          <PreviewList
            items={previewData.recentComments.map((comment) => ({
              primary: comment.message ?? comment.id,
              secondary: [comment.fromName, comment.createdTime].filter(Boolean).join(" • ") || null,
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

function formatMetric(value: number | null): string | null {
  if (typeof value !== "number") return null;
  return new Intl.NumberFormat().format(value);
}

