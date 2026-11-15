// apps/web/lib/tak/route-context/providers/mailroom.ts
// Mailroom page context for the coworker (BI-2A815481).
//
// The coworker beside /workspace/mailroom used to get the generic page label
// and nothing else. It went looking with unrelated tools, found no "email
// provider" and told the owner the mailbox connector did not exist. This block
// gives it the page's own facts: which mailboxes are connected and how their
// last read went, or that none is. It also states plainly that the connector
// on this page is DPF's own. Credentials and message content are never included.

import { prisma } from "@dpf/db";

export type MailroomContextMailbox = {
  address: string;
  purposeKey: string;
  provider: string;
  status: string;
  lastPolledAt: Date | null;
  lastPollStatus: string | null;
  lastError: string | null;
};

export type MailroomContextInput = {
  mailboxes: MailroomContextMailbox[];
  purposes: Array<{ purposeKey: string; label: string }>;
  openItems: number;
};

/** Pure: the PAGE DATA block for the Mailroom. */
export function formatMailroomContext(input: MailroomContextInput): string {
  const purposeLabel = (key: string) => input.purposes.find((p) => p.purposeKey === key)?.label ?? key;
  const lines = ["\nPAGE DATA — Mailroom (Operations › Mailroom):"];
  lines.push(
    "This page is DPF's own mailbox connector. The \"Connect a mailbox\" form on it reads a mailbox over IMAP (Gmail, Google Workspace, Outlook.com, most servers), Microsoft 365 (Graph) or a Postmark inbound stream, then triages and routes each message.",
    "The capability exists and is on this page. Do not say email is not wired into DPF, and do not suggest Zapier, Make or any other third-party bridge.",
    "When the form is open you receive its fields and current values. Help the owner fill them in. The owner types the password or client secret personally; never ask for, repeat or fill a password.",
  );
  if (input.mailboxes.length === 0) {
    lines.push("No mailbox is connected yet, so nothing is being read.");
  } else {
    lines.push(`${input.mailboxes.length} mailbox(es) connected:`);
    for (const m of input.mailboxes) {
      const lastRead = m.lastPolledAt ? `last read ${m.lastPolledAt.toISOString()} (${m.lastPollStatus ?? "unknown"})` : "not read yet";
      const error = m.lastError ? `; last error: ${m.lastError}` : "";
      lines.push(`- ${m.address} · ${purposeLabel(m.purposeKey)} · ${m.provider} · ${m.status} · ${lastRead}${error}`);
    }
  }
  lines.push(`${input.openItems} routed messages are waiting to be acknowledged.`);
  lines.push(`Mailbox purposes this business uses: ${input.purposes.map((p) => `${p.label} (${p.purposeKey})`).join(", ")}.`);
  return lines.join("\n");
}

export async function getMailroomContext(): Promise<string | null> {
  const { resolveMailroomOrganizationId, resolveOrganizationMailroomProfile } = await import("@/lib/mailroom/runtime.server");
  const organizationId = await resolveMailroomOrganizationId();
  if (!organizationId) return null;
  const [profile, mailboxes, openItems] = await Promise.all([
    resolveOrganizationMailroomProfile(organizationId),
    prisma.mailboxAccount.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { address: true, purposeKey: true, provider: true, status: true, lastPolledAt: true, lastPollStatus: true, lastError: true },
    }),
    prisma.inboundChannelMessage.count({ where: { organizationId, domain: "mailroom", mailroomStatus: "routed" } }),
  ]);
  return formatMailroomContext({
    mailboxes: mailboxes.map((m) => ({ ...m, provider: String(m.provider), status: String(m.status), lastPollStatus: m.lastPollStatus ? String(m.lastPollStatus) : null })),
    purposes: profile.expectedMailboxes.map((p) => ({ purposeKey: p.purposeKey, label: p.label })),
    openItems,
  });
}
