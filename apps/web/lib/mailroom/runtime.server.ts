// Mailroom runtime wiring — the prisma-backed IntakeDeps (design 2026-09-09
// §4.4–§4.6). Everything pure lives beside this file; this is the one place
// the loop meets the database, the archetype registry, the routed classifier,
// the room-native ingress and the notification dispatcher.
//
// Server-only: reads the DB and decrypts mailbox secrets.

import { prisma } from "@dpf/db";
import { MAILBOX_PROVIDER_KEY, type MailboxProviderKey } from "@dpf/db/mailroom-enums";
import { ALL_ARCHETYPES, resolveMailroomProfile, type MailroomProfile } from "@dpf/storefront-templates";

import { decryptJson } from "@/lib/govern/credential-crypto";
import { sendQueueNotification } from "@/lib/queue/notification-adapter";
import { ingestPrismaWorkroomChannelEvent } from "@/lib/work-management/room-channel-ingress-prisma.server";

import { routedMailroomClassifier } from "./classifier";
import { pollDueMailboxes, pollMailbox, type IntakeDb, type IntakeDeps, type MailboxRecord, type PollOutcome } from "./intake";
import { createMailboxProviderAdapters } from "./providers/registry";

/** The organisation's Mailroom profile: its archetype's profile merged over the common one. */
export async function resolveOrganizationMailroomProfile(organizationId: string): Promise<MailroomProfile> {
  const config = await prisma.storefrontConfig.findFirst({
    where: { organizationId },
    select: { archetype: { select: { archetypeId: true } } },
  });
  const archetypeId = config?.archetype?.archetypeId ?? null;
  const archetype = archetypeId ? ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId) ?? null : null;
  return resolveMailroomProfile(archetype);
}

/** The install's organisation (single-tenant install: the oldest row). */
export async function resolveMailroomOrganizationId(): Promise<string | null> {
  const org = await prisma.organization.findFirst({
    where: { orgId: { not: "ORG-PLATFORM" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return org?.id ?? null;
}

/** Confirm a candidate animal reference against the roster; returns the canonical ref or null. */
async function lookupAnimalSubject(organizationId: string, candidate: string): Promise<string | null> {
  const token = candidate.trim();
  const byRef = await prisma.animalProfile.findFirst({
    where: { organizationId, animalRef: { equals: token, mode: "insensitive" } },
    select: { animalRef: true },
  });
  if (byRef) return byRef.animalRef;
  const listed = await prisma.adoptableAnimal.findFirst({
    where: { organizationId, animalRef: { equals: token, mode: "insensitive" } },
    select: { animalRef: true },
  });
  return listed?.animalRef ?? null;
}

export function toMailboxRecord(row: {
  id: string;
  mailboxId: string;
  organizationId: string;
  address: string;
  provider: "imap" | "microsoft365" | "postmark_inbound";
  settings: unknown;
  cursor: unknown;
  pollIntervalMinutes: number;
}): MailboxRecord {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    organizationId: row.organizationId,
    address: row.address,
    provider: MAILBOX_PROVIDER_KEY[row.provider],
    settings: row.settings,
    cursor: row.cursor,
    pollIntervalMinutes: row.pollIntervalMinutes,
  };
}

const secretsCache = new WeakMap<object, unknown>();

export async function buildMailroomIntakeDeps(organizationId: string): Promise<IntakeDeps> {
  const profile = await resolveOrganizationMailroomProfile(organizationId);
  const rows = new Map<string, { secretsEnc: string | null }>();
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.DPF_PORTAL_ORIGIN ?? "").replace(/\/$/, "");
  return {
    db: prisma as unknown as IntakeDb,
    profile,
    adapters: createMailboxProviderAdapters(),
    readSecrets: <P extends MailboxProviderKey>(mailbox: MailboxRecord) => {
      const cached = secretsCache.get(mailbox);
      if (cached) return cached as never;
      const row = rows.get(mailbox.id);
      const decrypted = row?.secretsEnc ? decryptJson<Record<string, string>>(row.secretsEnc) ?? {} : {};
      secretsCache.set(mailbox, decrypted);
      return decrypted as never;
    },
    classify: routedMailroomClassifier,
    lookupSubject: async (kind, candidate) => (kind === "animal" ? lookupAnimalSubject(organizationId, candidate) : null),
    knownSenderIngress: ingestPrismaWorkroomChannelEvent,
    notify: async (n) => sendQueueNotification(n),
    portalOrigin: origin,
    // The secrets rows are attached by the pollers below.
    ...({ __rows: rows } as object),
  } as IntakeDeps & { __rows?: Map<string, { secretsEnc: string | null }> };
}

type DepsWithRows = IntakeDeps & { __rows?: Map<string, { secretsEnc: string | null }> };

/** Poll every connected mailbox whose next-poll time has passed. */
export async function pollDueMailboxesForInstall(now: Date = new Date()): Promise<PollOutcome[]> {
  const organizationId = await resolveMailroomOrganizationId();
  if (!organizationId) return [];
  const due = await prisma.mailboxAccount.findMany({
    where: {
      organizationId,
      status: { in: ["connected", "error"] },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    orderBy: { nextPollAt: "asc" },
  });
  if (due.length === 0) return [];
  const deps = (await buildMailroomIntakeDeps(organizationId)) as DepsWithRows;
  for (const row of due) deps.__rows?.set(row.id, { secretsEnc: row.secretsEnc });
  return pollDueMailboxes(deps, due.map(toMailboxRecord));
}

/** Poll one mailbox now (connect flow's first read; the "Check now" action). */
export async function pollMailboxNow(mailboxId: string): Promise<PollOutcome | null> {
  const row = await prisma.mailboxAccount.findUnique({ where: { mailboxId } });
  if (!row || row.status === "paused") return null;
  const deps = (await buildMailroomIntakeDeps(row.organizationId)) as DepsWithRows;
  deps.__rows?.set(row.id, { secretsEnc: row.secretsEnc });
  return pollMailbox(deps, toMailboxRecord(row));
}
