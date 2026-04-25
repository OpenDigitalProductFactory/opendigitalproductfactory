import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadMailchimpPreview } from "@/lib/integrate/mailchimp/preview";
import {
  MailchimpConnectPanel,
  type MailchimpConnectionState,
} from "@/components/integrations/MailchimpConnectPanel";

export default async function MailchimpIntegrationPage() {
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
    where: { integrationId: "mailchimp-marketing" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadMailchimpPreview() : null;
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
          <span>Mailchimp</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">Mailchimp Marketing</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured email marketing integration. DPF stores your Mailchimp API key
          encrypted in this install and uses read-first marketing probes before any campaign-write
          workflows are added.
        </p>
      </div>

      <MailchimpConnectPanel initialState={initialState} />
      <MailchimpPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies Mailchimp account connectivity with customer-supplied marketing API keys.</li>
          <li>Reads account details, recent audiences, and recent campaigns through official Mailchimp APIs.</li>
          <li>Supports a marketing workspace with approved campaign context instead of ad hoc prompt guesses.</li>
          <li>Sets the platform up for later list, segment, and email automation without skipping governance.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): MailchimpConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      serverPrefix: null,
      accountName: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{
    serverPrefix?: string;
    accountName?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error"
        ? record.status
        : "unconfigured",
    serverPrefix: typeof decoded?.serverPrefix === "string" ? decoded.serverPrefix : null,
    accountName: typeof decoded?.accountName === "string" ? decoded.accountName : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: MailchimpConnectionState,
  preview: Awaited<ReturnType<typeof loadMailchimpPreview>> | null,
): MailchimpConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      accountName:
        typeof preview.preview.account.accountName === "string"
          ? preview.preview.account.accountName
          : state.accountName,
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

function MailchimpPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadMailchimpPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section
        className="rounded-lg border p-4 text-sm"
        style={{
          borderColor: "var(--dpf-warning)",
          backgroundColor: "color-mix(in srgb, var(--dpf-warning) 10%, transparent)",
        }}
      >
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh Mailchimp preview data for this account.
        </p>
        <p className="mt-2 font-medium text-[var(--dpf-text)]">{preview.error}</p>
      </section>
    );
  }

  if (preview.state === "unavailable") {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          Connect Mailchimp credentials to load live audience and campaign context.
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
            Read-first sample data from the connected Mailchimp account.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded {formatDateTime(previewData.loadedAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <PreviewCard title="Account" fallback="No account details returned.">
          <PreviewRow label="Account" value={previewData.account.accountName ?? null} />
          <PreviewRow label="Login" value={previewData.account.loginName ?? null} />
          <PreviewRow label="Email" value={previewData.account.email ?? null} />
        </PreviewCard>
        <PreviewCard title="Recent audiences" fallback="No audiences returned yet.">
          <PreviewList
            items={previewData.audiences.map((audience) => ({
              primary: audience.name,
              secondary:
                typeof audience.stats?.member_count === "number"
                  ? `${new Intl.NumberFormat().format(audience.stats.member_count)} members`
                  : null,
            }))}
          />
        </PreviewCard>
        <PreviewCard title="Recent campaigns" fallback="No campaigns returned yet.">
          <PreviewList
            items={previewData.campaigns.map((campaign) => ({
              primary: campaign.settings?.title,
              secondary: campaign.status ?? null,
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
