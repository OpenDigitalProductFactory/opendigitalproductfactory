import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";

import { WordPressConnectPanel } from "@/components/integrations/WordPressConnectPanel";
import { LocalTime } from "@/components/ui/LocalTime";
import { EmptyState, Notice, StatusBadge } from "@/components/ui/report-kit";
import { auth } from "@/lib/auth";
import {
  createConnectorCredentialStore,
  createPrismaConnectorCredentialRepository,
} from "@/lib/integrations/kernel/credential-store";
import { can } from "@/lib/permissions";

import { toWordPressConnectionViewState } from "./view-model";

const CONNECTION_ID = "wordpress-self-hosted";

export default async function WordPressIntegrationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_provider_connections",
  )) redirect("/platform/tools");

  const store = createConnectorCredentialStore({
    repository: createPrismaConnectorCredentialRepository(prisma as never),
  });
  const [setup, totalProjections, attentionProjections, recentProjections, recentPublications] =
    await Promise.all([
      store.readSetupState(CONNECTION_ID),
      prisma.externalChannelProjection.count({
        where: { connectorKey: CONNECTION_ID, connectionId: CONNECTION_ID },
      }),
      prisma.externalChannelProjection.count({
        where: {
          connectorKey: CONNECTION_ID,
          connectionId: CONNECTION_ID,
          state: { in: ["drifted", "ambiguous"] },
        },
      }),
      prisma.externalChannelProjection.findMany({
        where: { connectorKey: CONNECTION_ID, connectionId: CONNECTION_ID },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          externalChannelProjectionId: true,
          resourceKind: true,
          sourceRef: true,
          state: true,
          externalUrl: true,
          updatedAt: true,
        },
      }),
      prisma.outboundPublication.findMany({
        where: { channelId: CONNECTION_ID },
        orderBy: { publishedAt: "desc" },
        take: 5,
        select: {
          publicationId: true,
          externalUrl: true,
          publishedAt: true,
          draft: { select: { body: true } },
        },
      }),
    ]);

  return (
    <div className="space-y-dpf-lg p-dpf-lg">
      <header>
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-dpf-xs text-dpf-caption text-dpf-muted">
          <a href="/platform/tools" className="hover:underline">Tools</a><span>/</span>
          <a href="/platform/tools/integrations" className="hover:underline">Native Integrations</a><span>/</span>
          <span>WordPress</span>
        </nav>
        <h1 className="mt-dpf-xs text-dpf-heading font-dpf-bold text-dpf-text">WordPress (self-hosted)</h1>
        <p className="mt-dpf-xs max-w-3xl text-dpf-body text-dpf-muted">
          Send approved DPF content to a site your customer owns. DPF only needs outbound HTTPS. DPF does not host the site. It does not expose this install or provide a CDN.
        </p>
      </header>

      <WordPressConnectPanel initialState={toWordPressConnectionViewState(setup)} />

      <WordPressActivity
        total={totalProjections}
        attention={attentionProjections}
        projections={recentProjections}
        publications={recentPublications}
      />

      <details className="rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-lg">
        <summary className="cursor-pointer text-dpf-title font-dpf-semibold text-dpf-text">Ownership boundary</summary>
        <div className="mt-dpf-md grid gap-dpf-md md:grid-cols-2">
          <div>
            <h3 className="text-dpf-body font-dpf-semibold text-dpf-text">DPF owns</h3>
            <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">Business source content, approvals, draft-first publication intent, audit receipts, and projection/drift state.</p>
          </div>
          <div>
            <h3 className="text-dpf-body font-dpf-semibold text-dpf-text">WordPress owns</h3>
            <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">Themes, blocks and layout, plugins, permalinks, SEO delivery, hosting, CDN, and the public visitor experience.</p>
          </div>
        </div>
      </details>
    </div>
  );
}

type ProjectionRow = {
  externalChannelProjectionId: string;
  resourceKind: string;
  sourceRef: string;
  state: string;
  externalUrl: string | null;
  updatedAt: Date;
};

type PublicationRow = {
  publicationId: string;
  externalUrl: string | null;
  publishedAt: Date;
  draft: { body: string };
};

function WordPressActivity({
  total,
  attention,
  projections,
  publications,
}: {
  total: number;
  attention: number;
  projections: ProjectionRow[];
  publications: PublicationRow[];
}) {
  return (
    <section className="rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-lg">
      <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
        <div>
          <h2 className="text-dpf-title font-dpf-semibold text-dpf-text">Content activity</h2>
          <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">
            {total} current {total === 1 ? "projection" : "projections"}. Audit receipts stay available.
          </p>
        </div>
        <StatusBadge
          intent={attention > 0 ? "warning" : total > 0 ? "success" : "neutral"}
          label={attention > 0 ? `${attention} need review` : total > 0 ? "No drift detected" : "No projections yet"}
        />
      </div>

      {attention > 0 ? (
        <div className="mt-dpf-md">
          <Notice variant="warn" title="External content needs review">
            WordPress changed or a remote outcome is uncertain. Review the affected item in WordPress before retrying; DPF will not create a possible duplicate.
          </Notice>
        </div>
      ) : null}

      {projections.length === 0 && publications.length === 0 ? (
        <div className="mt-dpf-md">
          <EmptyState
            title="No WordPress activity yet"
            description="Approve a WordPress draft in Customer Marketing. Then create it from Ready to publish."
            action={
              <a
                href="/customer/marketing#marketing-publish-queue"
                className="dpf-tap-target inline-flex items-center rounded-dpf-md bg-dpf-accent px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-dpf-on-accent"
              >
                Open Customer Marketing
              </a>
            }
          />
        </div>
      ) : (
        <details className="mt-dpf-md rounded-dpf-md border border-dpf-border bg-dpf-surface-2 p-dpf-md">
          <summary className="cursor-pointer text-dpf-body font-dpf-medium text-dpf-text">Recent projections and receipts</summary>
          <div className="mt-dpf-md grid gap-dpf-lg lg:grid-cols-2">
            <ActivityList title="Current projections" empty="No projections yet">
              {projections.map((row) => (
                <li key={row.externalChannelProjectionId} className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-dpf-sm">
                  <div className="flex items-start justify-between gap-dpf-sm">
                    <p className="text-dpf-caption font-dpf-medium text-dpf-text">{humanize(row.resourceKind)} · {row.sourceRef}</p>
                    <StatusBadge intent={projectionIntent(row.state)} label={humanize(row.state)} />
                  </div>
                  <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">Updated <LocalTime value={row.updatedAt.toISOString()} /></p>
                  {safeHttpsUrl(row.externalUrl) ? <a href={safeHttpsUrl(row.externalUrl)!} target="_blank" rel="noopener noreferrer" className="mt-dpf-xs inline-block text-dpf-caption text-dpf-accent hover:underline">Open in WordPress ↗</a> : null}
                </li>
              ))}
            </ActivityList>
            <ActivityList title="Publication receipts" empty="No receipts yet">
              {publications.map((row) => (
                <li key={row.publicationId} className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-dpf-sm">
                  <p className="text-dpf-caption font-dpf-medium text-dpf-text">{summarizeBody(row.draft.body)}</p>
                  <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">Recorded <LocalTime value={row.publishedAt.toISOString()} /></p>
                  {safeHttpsUrl(row.externalUrl) ? <a href={safeHttpsUrl(row.externalUrl)!} target="_blank" rel="noopener noreferrer" className="mt-dpf-xs inline-block text-dpf-caption text-dpf-accent hover:underline">Open receipt target ↗</a> : null}
                </li>
              ))}
            </ActivityList>
          </div>
        </details>
      )}
    </section>
  );
}

function ActivityList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  return <div><h3 className="text-dpf-body font-dpf-semibold text-dpf-text">{title}</h3>{count > 0 ? <ul className="mt-dpf-sm space-y-dpf-sm">{children}</ul> : <p className="mt-dpf-sm text-dpf-caption text-dpf-muted">{empty}</p>}</div>;
}

function projectionIntent(state: string): "success" | "warning" | "neutral" {
  if (state === "projected") return "success";
  if (state === "drifted" || state === "ambiguous") return "warning";
  return "neutral";
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function summarizeBody(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine || "Approved WordPress content";
}

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}
