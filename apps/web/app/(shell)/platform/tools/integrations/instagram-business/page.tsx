import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { LocalTime } from "@/components/ui/LocalTime";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadInstagramBusinessPreview } from "@/lib/integrations/instagram-business/preview";
import {
  InstagramBusinessConnectPanel,
  type InstagramBusinessConnectionState,
} from "@/components/integrations/InstagramBusinessConnectPanel";

export default async function InstagramBusinessPage() {
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
    where: { integrationId: "instagram-business" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadInstagramBusinessPreview() : null;
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
          <span>Instagram Business</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">Instagram Business</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured local visual presence integration. DPF stores your Meta token
          encrypted in this install and uses read-first profile, media, and comment probes before
          publishing, moderation, or reply automation is added.
        </p>
      </div>

      <InstagramBusinessConnectPanel initialState={initialState} />
      <InstagramBusinessPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies customer-scoped Instagram Business profile access.</li>
          <li>Reads recent media and first-media comment activity without publishing or moderation actions.</li>
          <li>Gives operators local visual presence context next to Google, Facebook, and WhatsApp channels.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): InstagramBusinessConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      instagramBusinessAccountId: null,
      username: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{
    instagramBusinessAccountId?: string;
    username?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error"
        ? record.status
        : "unconfigured",
    instagramBusinessAccountId:
      typeof decoded?.instagramBusinessAccountId === "string"
        ? decoded.instagramBusinessAccountId
        : null,
    username: typeof decoded?.username === "string" ? decoded.username : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: InstagramBusinessConnectionState,
  preview: Awaited<ReturnType<typeof loadInstagramBusinessPreview>> | null,
): InstagramBusinessConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      instagramBusinessAccountId: preview.preview.profile.id,
      username: preview.preview.profile.username,
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

function InstagramBusinessPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadInstagramBusinessPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-[var(--dpf-error)]/40 bg-[color-mix(in_srgb,var(--dpf-error)_10%,transparent)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh the Instagram Business preview.
        </p>
        <p className="mt-2 font-medium text-[var(--dpf-error)]">{preview.error}</p>
      </section>
    );
  }

  if (preview.state === "unavailable") {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          Connect Instagram Business credentials to load profile, media, and comment context.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live Instagram preview</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first profile, recent media, and comment context from the connected Instagram Business account.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded <LocalTime value={previewData.loadedAt} options={{ year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} />
        </p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <PreviewCard title="Profile" fallback="No profile details returned.">
          <PreviewRow label="Username" value={previewData.profile.username} />
          <PreviewRow label="Name" value={previewData.profile.name} />
          <PreviewRow label="Followers" value={formatMetric(previewData.profile.followersCount)} />
          <PreviewRow label="Media" value={formatMetric(previewData.profile.mediaCount)} />
          <PreviewRow label="Website" value={previewData.profile.website} />
        </PreviewCard>
        <PreviewCard title="Recent media" fallback="No recent media returned yet.">
          <PreviewList
            items={previewData.recentMedia.map((media) => ({
              key: media.id,
              primary: media.caption ?? media.id,
              secondary: [media.mediaType, formatMetric(media.likeCount), formatMetric(media.commentsCount)]
                .filter(Boolean)
                .join(" / ") || null,
            }))}
          />
        </PreviewCard>
        <PreviewCard title="Recent comments" fallback="No recent comments returned yet.">
          <PreviewList
            items={previewData.recentComments.map((comment) => ({
              key: comment.id,
              primary: comment.text ?? comment.id,
              secondary: [comment.username, comment.timestamp].filter(Boolean).join(" / ") || null,
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

function PreviewRow({ label, value }: { label: string; value: string | null }) {
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
  items: Array<{ key: string; primary: string; secondary: string | null }>;
}) {
  if (!items.length) return null;

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
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

