import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { LocalTime } from "@/components/ui/LocalTime";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { loadWhatsAppBusinessPreview } from "@/lib/integrations/whatsapp-business/preview";
import {
  WhatsAppBusinessConnectPanel,
  type WhatsAppBusinessConnectionState,
} from "@/components/integrations/WhatsAppBusinessConnectPanel";

export default async function WhatsAppBusinessPage() {
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
    where: { integrationId: "whatsapp-business" },
  });

  const baseState = toConnectionState(record);
  const preview = baseState.status === "connected" ? await loadWhatsAppBusinessPreview() : null;
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
          <span>WhatsApp Business</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">WhatsApp Business</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured localized messaging readiness for WhatsApp Business. DPF stores
          the Meta token encrypted in this install and performs read-first phone and template
          probes before any outbound message, automation, or webhook subscription workflows are added.
        </p>
      </div>

      <WhatsAppBusinessConnectPanel initialState={initialState} />
      <WhatsAppBusinessPreviewSection preview={preview} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies the local WhatsApp Business phone number and Cloud API readiness posture.</li>
          <li>Surfaces approved, pending, and rejected message templates by language and category.</li>
          <li>Helps operators spot missing localized templates before customer outreach is designed.</li>
          <li>Keeps outbound messaging and webhook changes out of scope until governance is explicit.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): WhatsAppBusinessConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      wabaId: null,
      phoneNumberId: null,
      displayPhoneNumber: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const decoded = decryptJson<{
    wabaId?: string;
    phoneNumberId?: string;
    displayPhoneNumber?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error"
        ? record.status
        : "unconfigured",
    wabaId: typeof decoded?.wabaId === "string" ? decoded.wabaId : null,
    phoneNumberId:
      typeof decoded?.phoneNumberId === "string" ? decoded.phoneNumberId : null,
    displayPhoneNumber:
      typeof decoded?.displayPhoneNumber === "string" ? decoded.displayPhoneNumber : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
  };
}

function applyPreviewToConnectionState(
  state: WhatsAppBusinessConnectionState,
  preview: Awaited<ReturnType<typeof loadWhatsAppBusinessPreview>> | null,
): WhatsAppBusinessConnectionState {
  if (!preview) return state;

  if (preview.state === "available") {
    return {
      ...state,
      status: "connected",
      phoneNumberId: preview.preview.phoneNumber.id,
      displayPhoneNumber: preview.preview.phoneNumber.displayPhoneNumber,
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

function WhatsAppBusinessPreviewSection({
  preview,
}: {
  preview: Awaited<ReturnType<typeof loadWhatsAppBusinessPreview>> | null;
}) {
  if (!preview) return null;

  if (preview.state === "error") {
    return (
      <section className="rounded-lg border border-[var(--dpf-error)]/40 bg-[color-mix(in_srgb,var(--dpf-error)_10%,transparent)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">Preview unavailable</h2>
        <p className="mt-1 text-[var(--dpf-muted)]">
          DPF could not refresh the WhatsApp Business readiness preview.
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
          Connect WhatsApp Business credentials to load phone, quality, and template readiness.
        </p>
      </section>
    );
  }

  const { preview: previewData } = preview;

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--dpf-text)]">Live WhatsApp readiness</h2>
          <p className="mt-1 text-[var(--dpf-muted)]">
            Read-first phone readiness, quality signal, and localized template context from Meta.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Loaded <LocalTime value={previewData.loadedAt} options={{ year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} />
        </p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <PreviewCard title="Phone readiness" fallback="No phone readiness returned.">
          <PreviewRow label="Phone" value={previewData.phoneNumber.displayPhoneNumber} />
          <PreviewRow label="Phone ID" value={previewData.phoneNumber.id} />
          <PreviewRow label="Verified name" value={previewData.phoneNumber.verifiedName} />
          <PreviewRow label="Quality" value={previewData.phoneNumber.qualityRating} />
          <PreviewRow label="Verification" value={previewData.phoneNumber.codeVerificationStatus} />
          <PreviewRow label="Platform" value={previewData.phoneNumber.platformType} />
        </PreviewCard>
        <PreviewCard title="Localized templates" fallback="No message templates returned yet.">
          <LocaleSummaryList items={previewData.localeSummary} />
        </PreviewCard>
        <PreviewCard title="Recent templates" fallback="No template details returned yet.">
          <TemplateList items={previewData.templates.slice(0, 5)} />
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

function LocaleSummaryList({
  items,
}: {
  items: Array<{ language: string; approved: number; pending: number; rejected: number }>;
}) {
  if (!items.length) return null;

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.language} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <p className="font-medium text-[var(--dpf-text)]">{item.language}</p>
          <p className="text-xs text-[var(--dpf-muted)]">
            {item.approved} approved / {item.pending} pending / {item.rejected} rejected
          </p>
        </li>
      ))}
    </ul>
  );
}

function TemplateList({
  items,
}: {
  items: Array<{
    id: string;
    name: string;
    language: string | null;
    status: string | null;
    category: string | null;
    bodyText?: string | null;
  }>;
}) {
  if (!items.length) return null;

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-[var(--dpf-text)]">{item.name}</p>
            {item.status && <StatusPill>{item.status}</StatusPill>}
          </div>
          <p className="text-xs text-[var(--dpf-muted)]">
            {[item.language, item.category].filter(Boolean).join(" / ")}
          </p>
          {item.bodyText && (
            <p className="mt-2 text-xs text-[var(--dpf-muted)]">{item.bodyText}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
      {children}
    </span>
  );
}

function hasContent(content: React.ReactNode): boolean {
  if (Array.isArray(content)) return content.length > 0;
  return Boolean(content);
}

