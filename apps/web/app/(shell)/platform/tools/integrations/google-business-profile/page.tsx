import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { LocalTime } from "@/components/ui/LocalTime";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadGoogleBusinessProfilePreview } from "@/lib/integrations/google-business-profile/preview";
import {
  GoogleBusinessProfileConnectPanel,
  type GoogleBusinessProfileConnectionState,
} from "@/components/integrations/GoogleBusinessProfileConnectPanel";

export default async function GoogleBusinessProfileIntegrationPage() {
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
    where: { integrationId: "google-business-profile" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadGoogleBusinessProfilePreview() : null;
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
          <span>Google Business Profile</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">Google Business Profile</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured local-presence integration. DPF stores your Google OAuth materials
          encrypted in this install and uses read-first local profile probes before any post or
          reply automation is added.
        </p>
      </div>

      <GoogleBusinessProfileConnectPanel initialState={initialState} />
      <GoogleBusinessProfilePreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies customer-owned Google Business Profile connectivity with offline OAuth credentials.</li>
          <li>Reads local location details, recent reviews, local posts, and profile media through the official Google Business Profile APIs.</li>
          <li>Supports localized reputation and listing awareness for the marketing specialist before write workflows exist.</li>
          <li>Sets the platform up for later review-response, posting, and local campaign automation without skipping governance.</li>
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
): GoogleBusinessProfileConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      accountId: null,
      locationId: null,
      locationTitle: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{
    accountId?: string;
    locationId?: string;
    locationTitle?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error"
        ? record.status
        : "unconfigured",
    accountId: typeof decoded?.accountId === "string" ? decoded.accountId : null,
    locationId: typeof decoded?.locationId === "string" ? decoded.locationId : null,
    locationTitle: typeof decoded?.locationTitle === "string" ? decoded.locationTitle : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: GoogleBusinessProfileConnectionState,
  preview: Awaited<ReturnType<typeof loadGoogleBusinessProfilePreview>> | null,
): GoogleBusinessProfileConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      locationTitle:
        typeof preview.preview.location.title === "string"
          ? preview.preview.location.title
          : state.locationTitle,
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

function GoogleBusinessProfilePreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadGoogleBusinessProfilePreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh Google Business Profile preview data for this location.
        </p>
        <p className="mt-2 text-[var(--dpf-text)]">{preview.error}</p>
      </section>
    );
  }

  if (preview.state === "unavailable") {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          Connect Google Business Profile credentials to load live location and review context.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;
  const city = previewData.location.storefrontAddress?.locality ?? null;
  const region = previewData.location.storefrontAddress?.administrativeArea ?? null;
  const locality = [city, region].filter(Boolean).join(", ") || null;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live local profile preview</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first sample data from the connected Google Business Profile location.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded <LocalTime value={previewData.loadedAt} options={{ year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} />
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <PreviewCard title="Account" fallback="No account details returned.">
          <PreviewRow label="Account" value={previewData.account.accountName ?? null} />
          <PreviewRow label="Type" value={previewData.account.type ?? null} />
          <PreviewRow label="Role" value={previewData.account.role ?? null} />
        </PreviewCard>
        <PreviewCard title="Location" fallback="No location details returned.">
          <PreviewRow label="Title" value={previewData.location.title ?? null} />
          <PreviewRow label="Locality" value={locality} />
          <PreviewRow label="Website" value={previewData.location.websiteUri ?? null} />
          <PreviewRow
            label="Phone"
            value={previewData.location.phoneNumbers?.primaryPhone ?? null}
          />
        </PreviewCard>
        <PreviewCard title="Recent reviews" fallback="No reviews returned yet.">
          <PreviewReviewList items={previewData.reviews} />
        </PreviewCard>
        <PreviewCard title="Recent local posts" fallback="No local posts returned yet.">
          <PreviewLocalPostList items={previewData.localPosts} />
        </PreviewCard>
        <PreviewCard title="Local profile media" fallback="No media items returned yet.">
          <PreviewMediaList
            items={previewData.media.items}
            totalMediaItemCount={previewData.media.totalMediaItemCount}
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

function PreviewReviewList({
  items,
}: {
  items: Array<{
    reviewId?: string;
    starRating?: string;
    comment?: string;
    reviewer?: { displayName?: string };
  }>;
}) {
  const visibleItems = items.filter(
    (item) =>
      (typeof item.reviewId === "string" && item.reviewId.length > 0) ||
      (typeof item.comment === "string" && item.comment.length > 0),
  );
  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleItems.map((item) => (
        <div
          key={`${item.reviewId ?? "review"}-${item.reviewer?.displayName ?? ""}`}
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="font-medium text-[var(--dpf-text)]">
              {item.reviewer?.displayName ?? "Anonymous reviewer"}
            </div>
            {item.starRating && (
              <div className="text-xs text-[var(--dpf-muted)]">{item.starRating}</div>
            )}
          </div>
          {item.comment && <div className="mt-1 text-xs text-[var(--dpf-muted)]">{item.comment}</div>}
        </div>
      ))}
    </div>
  );
}

function PreviewLocalPostList({
  items,
}: {
  items: Array<{
    name?: string;
    summary?: string;
    topicType?: string;
    state?: string;
    searchUrl?: string;
    callToAction?: {
      actionType?: string;
      url?: string;
    };
  }>;
}) {
  const visibleItems = items.filter(
    (item) =>
      (typeof item.name === "string" && item.name.length > 0) ||
      (typeof item.summary === "string" && item.summary.length > 0),
  );
  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleItems.map((item) => (
        <div
          key={item.name ?? item.summary}
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            {item.topicType && (
              <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--dpf-muted)]">
                {item.topicType}
              </span>
            )}
            {item.state && (
              <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--dpf-muted)]">
                {item.state}
              </span>
            )}
          </div>
          {item.summary && <p className="mt-2 text-xs text-[var(--dpf-text)]">{item.summary}</p>}
          {(item.callToAction?.actionType || item.searchUrl) && (
            <div className="mt-2 space-y-1 text-xs text-[var(--dpf-muted)]">
              {item.callToAction?.actionType && (
                <div>CTA: <span className="text-[var(--dpf-text)]">{item.callToAction.actionType}</span></div>
              )}
              {item.searchUrl && (
                <div>Search URL: <span className="text-[var(--dpf-text)]">{item.searchUrl}</span></div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PreviewMediaList({
  items,
  totalMediaItemCount,
}: {
  items: Array<{
    name?: string;
    mediaFormat?: string;
    thumbnailUrl?: string;
    googleUrl?: string;
    createTime?: string;
    locationAssociation?: {
      category?: string;
      priceListItemId?: string;
    };
    dimensions?: {
      widthPixels?: number;
      heightPixels?: number;
    };
    insights?: {
      viewCount?: string;
    };
    attribution?: {
      profileName?: string;
    };
  }>;
  totalMediaItemCount: number;
}) {
  const visibleItems = items.filter(
    (item) =>
      (typeof item.name === "string" && item.name.length > 0) ||
      (typeof item.thumbnailUrl === "string" && item.thumbnailUrl.length > 0) ||
      (typeof item.googleUrl === "string" && item.googleUrl.length > 0),
  );
  if (visibleItems.length === 0) return null;

  const countLabel =
    totalMediaItemCount === 1 ? "1 media item" : `${formatNumber(totalMediaItemCount)} media items`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--dpf-muted)]">{countLabel}</p>
      <div className="grid gap-2">
        {visibleItems.slice(0, 3).map((item) => {
          const category =
            item.locationAssociation?.category ?? item.locationAssociation?.priceListItemId ?? null;
          const dimensions =
            typeof item.dimensions?.widthPixels === "number" &&
            typeof item.dimensions?.heightPixels === "number"
              ? `${item.dimensions.widthPixels} x ${item.dimensions.heightPixels}`
              : null;
          const viewCount =
            typeof item.insights?.viewCount === "string"
              ? `${formatNumber(Number(item.insights.viewCount))} views`
              : null;

          return (
            <div
              key={item.name ?? item.thumbnailUrl ?? item.googleUrl}
              className="overflow-hidden rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)]"
            >
              {item.thumbnailUrl && (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  className="h-24 w-full object-cover"
                  loading="lazy"
                />
              )}
              <div className="space-y-1 px-3 py-2 text-xs">
                <div className="flex flex-wrap gap-2">
                  {item.mediaFormat && (
                    <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 font-medium text-[var(--dpf-muted)]">
                      {item.mediaFormat}
                    </span>
                  )}
                  {category && (
                    <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 font-medium text-[var(--dpf-muted)]">
                      {category}
                    </span>
                  )}
                </div>
                {viewCount && <p className="text-[var(--dpf-text)]">{viewCount}</p>}
                {dimensions && <p className="text-[var(--dpf-muted)]">{dimensions}</p>}
                {item.attribution?.profileName && (
                  <p className="text-[var(--dpf-muted)]">
                    By <span className="text-[var(--dpf-text)]">{item.attribution.profileName}</span>
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function hasRenderableChildren(value: React.ReactNode): boolean {
  if (Array.isArray(value)) {
    return value.some(Boolean);
  }
  return Boolean(value);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat().format(value);
}

