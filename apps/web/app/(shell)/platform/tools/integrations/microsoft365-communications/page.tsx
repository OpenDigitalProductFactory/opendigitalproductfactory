import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadMicrosoft365CommunicationsPreview } from "@/lib/integrate/microsoft365-communications/preview";
import {
  Microsoft365CommunicationsConnectPanel,
  type Microsoft365CommunicationsConnectionState,
} from "@/components/integrations/Microsoft365CommunicationsConnectPanel";

export default async function Microsoft365CommunicationsPage() {
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
    where: { integrationId: "microsoft365-communications" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadMicrosoft365CommunicationsPreview() : null;
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
          <span>Microsoft 365 Communications</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">
          Microsoft 365 Communications
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured Microsoft communications integration. DPF stores your tenant app
          credentials encrypted in this install and uses read-first Graph probes before any mail,
          calendar, or Teams automation is added.
        </p>
      </div>

      <Microsoft365CommunicationsConnectPanel initialState={initialState} />
      <Microsoft365CommunicationsPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies tenant-scoped Microsoft Graph connectivity with customer-supplied app credentials.</li>
          <li>Reads inbox, calendar, Teams, channels, and recent channel-message context for a scoped mailbox user.</li>
          <li>Keeps Microsoft 365 communications on the native enterprise-integration substrate instead of a one-off secret store.</li>
          <li>Sets the platform up for later service coordination, communications workflows, and governed write-safe actions.</li>
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
): Microsoft365CommunicationsConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      tenantDisplayName: null,
      mailboxDisplayName: null,
      mailboxUserPrincipalName: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{
    tenantDisplayName?: string;
    mailboxDisplayName?: string;
    mailboxUserPrincipalName?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error"
        ? record.status
        : "unconfigured",
    tenantDisplayName:
      typeof decoded?.tenantDisplayName === "string" ? decoded.tenantDisplayName : null,
    mailboxDisplayName:
      typeof decoded?.mailboxDisplayName === "string" ? decoded.mailboxDisplayName : null,
    mailboxUserPrincipalName:
      typeof decoded?.mailboxUserPrincipalName === "string"
        ? decoded.mailboxUserPrincipalName
        : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: Microsoft365CommunicationsConnectionState,
  preview: Awaited<ReturnType<typeof loadMicrosoft365CommunicationsPreview>> | null,
): Microsoft365CommunicationsConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      tenantDisplayName: preview.preview.tenant.displayName,
      mailboxDisplayName: preview.preview.mailbox.displayName,
      mailboxUserPrincipalName: preview.preview.mailbox.userPrincipalName,
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

function Microsoft365CommunicationsPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadMicrosoft365CommunicationsPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh Microsoft 365 communications preview data for this tenant.
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
          Connect Microsoft 365 credentials to load live mailbox, calendar, and Teams context.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live communications preview</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first mailbox, calendar, Teams, and channel activity from the connected Microsoft
            tenant.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded {formatDateTime(previewData.loadedAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Tenant" value={previewData.tenant.displayName} />
        <MetricCard title="Mailbox" value={previewData.mailbox.displayName} />
        <MetricCard title="Recent mail" value={String(previewData.recentMessages.length)} />
        <MetricCard title="Teams" value={String(previewData.joinedTeams.length)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <PreviewListCard
          title="Recent inbox messages"
          items={previewData.recentMessages.map((message) => ({
            primary: message.subject,
            secondary: [message.from.name, formatDateTime(message.receivedDateTime)]
              .filter(Boolean)
              .join(" • ") || null,
          }))}
          empty="No inbox messages returned yet."
        />
        <PreviewListCard
          title="Upcoming events"
          items={previewData.upcomingEvents.map((event) => ({
            primary: event.subject,
            secondary:
              [event.location.displayName, formatDateTime(event.start.dateTime)]
                .filter(Boolean)
                .join(" • ") || null,
          }))}
          empty="No events returned yet."
        />
        <PreviewListCard
          title="Joined Teams"
          items={previewData.joinedTeams.map((team) => ({
            primary: team.displayName,
            secondary: team.description,
          }))}
          empty="No Teams returned yet."
        />
        <PreviewListCard
          title="First team activity"
          items={[
            ...previewData.firstTeamChannels.map((channel) => ({
              primary: channel.displayName,
              secondary: channel.membershipType ? `Channel • ${channel.membershipType}` : "Channel",
            })),
            ...previewData.recentChannelMessages.map((message) => ({
              primary: message.bodyPreview || "(empty message)",
              secondary:
                [message.from.displayName, formatDateTime(message.createdDateTime)]
                  .filter(Boolean)
                  .join(" • ") || null,
            })),
          ]}
          empty="No channel activity returned yet."
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
