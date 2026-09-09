// /workspace/mailroom — the Mailroom (design 2026-09-09 §4.9/§6, BI-727D5FD9).
//
// Answers, in order: which mailboxes are being read and when; what arrived that
// nobody has acknowledged, worst first; what arrived by reason. With no mailbox
// the page is the education state — what the Mailroom does, the mailboxes a
// business of this kind usually runs, and a connect action — never an empty
// table. The same page is the `mailroom` setup step.

import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { MAILBOX_PROVIDER_KEY } from "@dpf/db/mailroom-enums";

import { auth } from "@/lib/auth";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";
import { resolveMailroomOrganizationId, resolveOrganizationMailroomProfile } from "@/lib/mailroom/runtime.server";
import { ButtonLink } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { EmptyState } from "@/components/ui/report-kit/EmptyState";
import { Notice } from "@/components/ui/report-kit/Notice";
import { MailboxConnectForm } from "@/components/mailroom/MailboxConnectForm";
import { MailboxControls } from "@/components/mailroom/MailboxControls";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ reason?: string; urgency?: string; queue?: string; all?: string }> };

const timeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function when(d: Date | null): string {
  return d ? timeFormat.format(d) : "never";
}

function agePast(now: Date, by: Date | null): string | null {
  if (!by || by.getTime() > now.getTime()) return null;
  const minutes = Math.round((now.getTime() - by.getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min past its window`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h past its window` : `${Math.round(hours / 24)} d past its window`;
}

const PROVIDER_LABEL: Record<string, string> = { imap: "IMAP", microsoft365: "Microsoft 365", "postmark-inbound": "Postmark inbound" };

export default async function MailroomPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const params = await searchParams;
  const now = new Date();

  const organizationId = await resolveMailroomOrganizationId();
  if (!organizationId) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">Mailroom</h1>
        <Notice variant="info" title="Finish setup first">The Mailroom needs the business to exist before it can read its mail.</Notice>
      </main>
    );
  }

  const [profile, mailboxes] = await Promise.all([
    resolveOrganizationMailroomProfile(organizationId),
    prisma.mailboxAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
  ]);
  const reasonLabel = new Map(profile.reasons.map((r) => [r.key, r.label] as const));
  const queueLabel = new Map(profile.queues.map((q) => [q.key, q.label] as const));
  const purposeLabel = new Map(profile.expectedMailboxes.map((m) => [m.purposeKey, m.label] as const));

  const filters = {
    ...(params.reason ? { reasonKey: params.reason } : {}),
    ...(params.urgency ? { urgency: params.urgency as "immediate" | "hours" | "days" | "weeks" } : {}),
    ...(params.queue ? { queueKey: params.queue } : {}),
  };
  const [waiting, recent] = mailboxes.length
    ? await Promise.all([
        prisma.inboundChannelMessage.findMany({
          where: { organizationId, domain: "mailroom", mailroomStatus: "routed", ...filters },
          orderBy: [{ acknowledgeBy: "asc" }],
          take: 100,
        }),
        prisma.inboundChannelMessage.findMany({
          where: { organizationId, domain: "mailroom", mailroomStatus: { in: params.all ? ["routed", "acknowledged", "replied", "noise", "quarantined", "closed"] : ["acknowledged", "replied"] }, ...filters },
          orderBy: [{ receivedAt: "desc" }],
          take: 50,
        }),
      ])
    : [[], []];

  const educate = mailboxes.length === 0;
  const oldest = waiting[0] ?? null;
  const oldestPast = oldest ? agePast(now, oldest.acknowledgeBy) : null;
  const failing = mailboxes.filter((m) => m.status === "error").length;
  const lead = educate
    ? { text: "No mailbox is connected yet. Nothing is being read until one is.", href: "#connect-mailbox", label: "Connect a mailbox", actionKey: "connect-mailbox" }
    : oldest
      ? {
          text: `${waiting.length} message${waiting.length === 1 ? "" : "s"} waiting for someone${oldestPast ? `; the oldest is ${oldestPast}` : ""}.${failing ? ` ${failing} mailbox${failing === 1 ? "" : "es"} failed its last read.` : ""}`,
          href: `/workspace/mailroom/items/${oldest.inboundId}`,
          label: "Open the oldest",
          actionKey: "open-oldest-waiting",
        }
      : {
          text: `Nothing is waiting. ${mailboxes.length} mailbox${mailboxes.length === 1 ? "" : "es"} read on schedule.${failing ? ` ${failing} failed its last read.` : ""}`,
          href: "#all-items",
          label: "See handled mail",
          actionKey: "see-handled",
        };

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">Mailroom</h1>
        <p className="text-sm text-[var(--dpf-text-muted)]">
          The mailboxes the business reads, what arrived, and who has acknowledged it.
        </p>
      </header>

      <Surface data-dpf-lead padding="md" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--dpf-text)]">{lead.text}</p>
        <ButtonLink href={lead.href} size="sm" {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: lead.actionKey }}>
          {lead.label}
        </ButtonLink>
      </Surface>

      {educate ? (
        <section aria-labelledby="mailroom-education" data-evidence-key="education-notice" className="space-y-4">
          <Surface padding="lg">
            <h2 id="mailroom-education" className="text-lg font-medium text-[var(--dpf-text)]">What the Mailroom does</h2>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              It reads the mailboxes you name about once an hour. It works out why each sender wrote and how urgent it is.
              It puts the message in front of the right person and chases anything nobody has acknowledged inside its window.
              A reply can be drafted and approved here. Nothing is sent without a person&apos;s approval.
            </p>
            <h3 className="mt-4 text-sm font-medium text-[var(--dpf-text-muted)]">Mailboxes a business like yours usually runs</h3>
            <ul data-evidence-key="expected-mailboxes" className="mt-2 grid gap-3 sm:grid-cols-2">
              {profile.expectedMailboxes.map((m) => (
                <li key={m.purposeKey} className="rounded-md border border-[var(--dpf-border)] p-3">
                  <div className="text-sm font-medium text-[var(--dpf-text)]">{m.label}</div>
                  <div className="text-xs text-[var(--dpf-text-muted)]">{m.examples.join(", ")}</div>
                  <p className="mt-1 text-xs text-[var(--dpf-text-muted)]">{m.why}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-[var(--dpf-text-muted)]">
              No mailbox to connect yet? That is fine — skip for now and come back here when you have one.
            </p>
          </Surface>
        </section>
      ) : (
        <section aria-labelledby="mailboxes-heading" data-evidence-key="mailbox-list" className="space-y-3">
          <h2 id="mailboxes-heading" className="text-lg font-medium text-[var(--dpf-text)]">Mailboxes</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {mailboxes.map((m) => {
              const paused = m.status === "paused";
              return (
                <li key={m.id}>
                  <Surface as="div" padding="md" className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-[var(--dpf-text)]">{m.displayName ?? m.address}</div>
                        <div className="text-xs text-[var(--dpf-text-muted)]">{m.address} · {purposeLabel.get(m.purposeKey) ?? m.purposeKey} · {PROVIDER_LABEL[MAILBOX_PROVIDER_KEY[m.provider]]}</div>
                      </div>
                      <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-xs text-[var(--dpf-text-muted)]">{m.status}</span>
                    </div>
                    <div data-evidence-key="last-polled" className="text-xs text-[var(--dpf-text-muted)]">
                      Last read {when(m.lastPolledAt)} · every {m.pollIntervalMinutes} min · next {when(m.nextPollAt)}
                    </div>
                    {m.status === "error" && m.lastError ? <Notice variant="warn" title="Last read failed">{m.lastError}</Notice> : null}
                    <MailboxControls mailboxRef={m.mailboxRef} paused={paused} />
                  </Surface>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <details id="connect-mailbox" data-evidence-key="connect-mailbox" open={educate} className="rounded-lg border border-[var(--dpf-border)] p-4">
        <summary className="cursor-pointer text-sm font-medium text-[var(--dpf-text)]">Connect a mailbox</summary>
        <div className="mt-4">
          <MailboxConnectForm purposes={profile.expectedMailboxes} />
        </div>
      </details>

      {!educate ? (
        <>
          <section aria-labelledby="waiting-heading" data-evidence-key="unacknowledged-items" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="waiting-heading" className="text-lg font-medium text-[var(--dpf-text)]">Waiting for someone ({waiting.length})</h2>
              <form className="flex flex-wrap gap-2 text-xs" aria-label="Filter items">
                <select name="reason" defaultValue={params.reason ?? ""} className="rounded-md border border-[var(--dpf-border)] bg-transparent px-2 py-1 text-[var(--dpf-text)]">
                  <option value="">Any reason</option>
                  {profile.reasons.filter((r) => !r.noise).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <select name="urgency" defaultValue={params.urgency ?? ""} className="rounded-md border border-[var(--dpf-border)] bg-transparent px-2 py-1 text-[var(--dpf-text)]">
                  <option value="">Any urgency</option>
                  {["immediate", "hours", "days", "weeks"].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <select name="queue" defaultValue={params.queue ?? ""} className="rounded-md border border-[var(--dpf-border)] bg-transparent px-2 py-1 text-[var(--dpf-text)]">
                  <option value="">Any queue</option>
                  {profile.queues.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
                </select>
                <button type="submit" className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-[var(--dpf-text)]">Filter</button>
              </form>
            </div>
            {waiting.length === 0 ? (
              <EmptyState size="sm" title="Nothing is waiting" description="Every routed message has been acknowledged." />
            ) : (
              <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)]">
                {waiting.map((item) => {
                  const past = agePast(now, item.acknowledgeBy);
                  return (
                    <li key={item.inboundId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <Link href={`/workspace/mailroom/items/${item.inboundId}`} className="text-sm font-medium text-[var(--dpf-text)] underline-offset-2 hover:underline">
                          {item.triageSummary ?? item.subject ?? "(no subject)"}
                        </Link>
                        <div className="text-xs text-[var(--dpf-text-muted)]">
                          {item.fromDisplayName ?? item.fromAddress ?? "unknown sender"} · {reasonLabel.get(item.reasonKey ?? "") ?? item.reasonKey} · {item.urgency}
                          {item.subjectRef ? ` · about ${item.subjectRef}` : ""} · {queueLabel.get(item.queueKey ?? "") ?? item.queueKey}
                          {item.triageFlagged ? " · reason guessed" : ""}
                        </div>
                      </div>
                      <div data-evidence-key="age-past-window" className={`text-xs ${past ? "text-[var(--dpf-danger)]" : "text-[var(--dpf-text-muted)]"}`}>
                        {past ?? `acknowledge by ${when(item.acknowledgeBy)}`}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <details id="all-items" data-evidence-key="all-items" className="rounded-lg border border-[var(--dpf-border)] p-4">
            <summary className="cursor-pointer text-sm font-medium text-[var(--dpf-text)]">
              {params.all ? "All items" : "Handled items"} ({recent.length}) {params.all ? null : <Link href="?all=1" className="ml-2 text-xs underline">show everything, including noise</Link>}
            </summary>
            {recent.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--dpf-text-muted)]">Nothing here yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--dpf-border)]">
                {recent.map((item) => (
                  <li key={item.inboundId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/workspace/mailroom/items/${item.inboundId}`} className="text-sm text-[var(--dpf-text)] underline-offset-2 hover:underline">
                      {item.triageSummary ?? item.subject ?? "(no subject)"}
                    </Link>
                    <span className="text-xs text-[var(--dpf-text-muted)]">
                      {item.fromDisplayName ?? item.fromAddress ?? "unknown"} · {reasonLabel.get(item.reasonKey ?? "") ?? item.reasonKey ?? "—"} · {item.mailroomStatus} · {when(item.receivedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      ) : null}
    </main>
  );
}
