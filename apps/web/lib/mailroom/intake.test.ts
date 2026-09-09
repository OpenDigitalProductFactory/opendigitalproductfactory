// Mailroom intake + dispatch — design 2026-09-09 §4.4/§4.6 (BI-9C362E23,
// BI-9BD223B1; AC-MAIL-POLL-SCHEDULE, AC-MAIL-IDEMPOTENT, AC-MAIL-QUEUE-ROOM,
// AC-MAIL-KNOWN-SENDER, AC-MAIL-OWNER-NOTIFIED, AC-MAIL-ACK-WINDOW).

import { describe, expect, it, vi } from "vitest";

import { ALL_ARCHETYPES, resolveMailroomProfile } from "@dpf/storefront-templates";

import { ingestNormalizedMail, pollDueMailboxes, pollMailbox, type IntakeDb, type IntakeDeps, type MailboxRecord } from "./intake";
import { createMailboxProviderAdapters } from "./providers/registry";
import type { MailboxProviderAdapter, NormalizedInboundMail } from "./providers/types";
import { MAILROOM_QUEUE_SOURCE_TYPE } from "./queue-room";

const profile = resolveMailroomProfile(ALL_ARCHETYPES.find((a) => a.archetypeId === "pet-rescue")!);

function mail(overrides: Partial<NormalizedInboundMail> = {}): NormalizedInboundMail {
  return {
    providerMessageId: "u-1",
    messageIdHeader: "<u1@x>",
    inReplyTo: null,
    references: [],
    from: { address: "finder@example.test", name: "Finder" },
    to: [{ address: "info@rescue.example", name: null }],
    subject: "Found a dog",
    textBody: "I found a dog on Elm St, no collar.",
    htmlBody: null,
    receivedAt: new Date("2026-09-09T10:00:00Z"),
    headers: {},
    attachments: [],
    ...overrides,
  };
}

/** In-memory database double covering exactly what the loop touches. */
function fakeDb() {
  const inbound: Array<Record<string, unknown>> = [];
  const workItems: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const mailboxUpdates: Array<Record<string, unknown>> = [];
  let seq = 0;
  const db: IntakeDb = {
    inboundChannelMessage: {
      async findFirst(args) {
        const where = (args as { where: { channelId: string; externalMessageId: string } }).where;
        const row = inbound.find((r) => r.channelId === where.channelId && r.externalMessageId === where.externalMessageId);
        return row ? { inboundId: row.inboundId as string } : null;
      },
      async create(args) {
        const data = (args as { data: Record<string, unknown> }).data;
        const row = { ...data, inboundId: `in-${++seq}` };
        inbound.push(row);
        return { inboundId: row.inboundId };
      },
      async update(args) {
        const { where, data } = args as { where: { inboundId: string }; data: Record<string, unknown> };
        const row = inbound.find((r) => r.inboundId === where.inboundId)!;
        Object.assign(row, data);
        return row;
      },
    },
    mailboxAccount: {
      async update(args) {
        mailboxUpdates.push((args as { data: Record<string, unknown> }).data);
        return {};
      },
    },
    workQueue: { async upsert() { return { id: "wq-1" }; } },
    workItem: {
      async findFirst(args) {
        const where = (args as { where: { sourceType: string; sourceId: string } }).where;
        const row = workItems.find((w) => w.sourceType === where.sourceType && w.sourceId === where.sourceId);
        return row ? { id: row.id as string, itemId: row.itemId as string, assignedToUserId: (row.assignedToUserId as string | null) ?? null } : null;
      },
      async create(args) {
        const data = (args as { data: Record<string, unknown> }).data;
        const row = { ...data, id: `wi-${workItems.length + 1}`, itemId: `WI-${workItems.length + 1}`, assignedToUserId: null };
        workItems.push(row);
        return { id: row.id, itemId: row.itemId, assignedToUserId: null };
      },
    },
    workItemMessage: {
      async upsert(args) {
        const { where, create } = args as { where: { messageId: string }; create: Record<string, unknown> };
        if (!messages.some((m) => m.messageId === where.messageId)) messages.push(create);
        return {};
      },
    },
  };
  return { db, inbound, workItems, messages, mailboxUpdates };
}

const mailbox: MailboxRecord = {
  id: "mbx-row",
  mailboxId: "MBX-1",
  organizationId: "org-1",
  address: "info@rescue.example",
  provider: "imap",
  settings: { host: "h", port: 993, secure: true, user: "info@rescue.example" },
  cursor: null,
  pollIntervalMinutes: 60,
};

function deps(db: IntakeDb, imap: Partial<MailboxProviderAdapter<"imap">>, extra: Partial<IntakeDeps> = {}): IntakeDeps {
  const base: MailboxProviderAdapter<"imap"> = {
    provider: "imap",
    pollable: true,
    async probe() { return { ok: true, mailboxLabel: "x" }; },
    async fetchNew() { return { messages: [], cursor: null }; },
    ...imap,
  };
  return {
    db,
    profile,
    adapters: createMailboxProviderAdapters({ imap: base }),
    readSecrets: () => ({ password: "p" }) as never,
    now: () => new Date("2026-09-09T12:00:00Z"),
    ...extra,
  };
}

describe("ingestNormalizedMail", () => {
  it("persists once, triages by rule, opens the queue room once and reuses it, sets the acknowledge window", async () => {
    const f = fakeDb();
    const d = deps(f.db, {});
    const first = await ingestNormalizedMail(d, mailbox, mail());
    const again = await ingestNormalizedMail(d, mailbox, mail({ providerMessageId: "u-2", subject: "Another found dog", textBody: "found a stray cat" }));
    expect(first.created).toBe(true);
    expect(first.triage?.reasonKey).toBe("found-animal");
    expect(first.target?.kind).toBe("queue-room");
    expect(f.workItems).toHaveLength(1);
    expect(f.workItems[0].sourceType).toBe(MAILROOM_QUEUE_SOURCE_TYPE);
    expect(f.workItems[0].sourceId).toBe("intake");
    expect(again.target?.kind).toBe("queue-room");
    expect(f.workItems).toHaveLength(1);
    expect(f.messages).toHaveLength(2);
    const row = f.inbound[0];
    expect(row.domain).toBe("mailroom");
    expect(row.channelId).toBe("mailroom-imap");
    expect(row.mailroomStatus).toBe("routed");
    expect(row.urgency).toBe("hours");
    expect((row.acknowledgeBy as Date).toISOString()).toBe("2026-09-09T14:00:00.000Z");
    expect(row.routedWorkItemId).toBe("WI-1");
  });

  it("the same provider message twice yields one item", async () => {
    const f = fakeDb();
    const d = deps(f.db, {});
    await ingestNormalizedMail(d, mailbox, mail());
    const second = await ingestNormalizedMail(d, mailbox, mail());
    expect(second.created).toBe(false);
    expect(f.inbound).toHaveLength(1);
    expect(f.messages).toHaveLength(1);
  });

  it("noise is stored as noise and opens no room", async () => {
    const f = fakeDb();
    const d = deps(f.db, {});
    const out = await ingestNormalizedMail(d, mailbox, mail({ headers: { "auto-submitted": "auto-replied" } }));
    expect(out.triage?.noise).toBe(true);
    expect(out.target?.kind).toBe("none");
    expect(f.workItems).toHaveLength(0);
    expect(f.inbound[0].mailroomStatus).toBe("noise");
    expect(f.inbound[0].queueKey).toBeNull();
  });

  it("a known sender lands on their existing room and no queue room is opened", async () => {
    const f = fakeDb();
    const d = deps(f.db, {}, {
      knownSenderIngress: async () => ({
        status: "accepted",
        eventId: "e",
        principalRef: "p",
        room: { caseKey: "ck", caseId: "c", workItemId: "WI-KNOWN" },
        activity: { kind: "external-event", summary: "s" },
        requestedAction: null,
        deliveryAcknowledged: false,
        actionCompleted: false,
      }),
    });
    const out = await ingestNormalizedMail(d, mailbox, mail());
    expect(out.target).toEqual({ kind: "known-sender-room", workItemId: "WI-KNOWN", caseKey: "ck" });
    expect(f.workItems).toHaveLength(0);
    expect(f.inbound[0].routedWorkItemId).toBe("WI-KNOWN");
  });

  it("a bound queue owner receives exactly one notification with a deep link to the item", async () => {
    const f = fakeDb();
    // Pre-seed an owned queue room.
    f.workItems.push({ sourceType: MAILROOM_QUEUE_SOURCE_TYPE, sourceId: "intake", id: "wi-owned", itemId: "WI-OWNED", assignedToUserId: "user-7" });
    const notify = vi.fn<NonNullable<IntakeDeps["notify"]>>(async () => undefined);
    const d = deps(f.db, {}, { notify, portalOrigin: "https://rescue.example/" });
    await ingestNormalizedMail(d, mailbox, mail());
    expect(notify).toHaveBeenCalledTimes(1);
    const n = notify.mock.calls[0][0];
    expect(n.recipientUserId).toBe("user-7");
    expect(n.urgency).toBe("urgent");
    expect(n.deepLink).toBe("https://rescue.example/workspace/mailroom/items/in-1");
  });
});

describe("pollMailbox", () => {
  it("fetches after the cursor, ingests, advances cursor and next poll on success", async () => {
    const f = fakeDb();
    const fetchNew = vi.fn<MailboxProviderAdapter<"imap">["fetchNew"]>(async () => ({ messages: [mail(), mail({ providerMessageId: "u-2" })], cursor: { uidValidity: "1", lastUid: 2 } }));
    const d = deps(f.db, { fetchNew });
    const out = await pollMailbox(d, { ...mailbox, cursor: { uidValidity: "1", lastUid: 0 } });
    expect(out).toEqual({ mailboxId: "MBX-1", ok: true, fetched: 2, ingested: 2, skipped: 0 });
    expect(fetchNew.mock.calls[0][2]).toEqual({ uidValidity: "1", lastUid: 0 });
    const update = f.mailboxUpdates[0];
    expect(update.cursor).toEqual({ uidValidity: "1", lastUid: 2 });
    expect(update.status).toBe("connected");
    expect((update.nextPollAt as Date).toISOString()).toBe("2026-09-09T13:00:00.000Z");
    expect(update.lastPollStatus).toBe("ok");
  });

  it("a provider throw marks that mailbox error and the next mailbox still polls", async () => {
    const f = fakeDb();
    let calls = 0;
    const d = deps(f.db, {
      fetchNew: async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection refused password=zzz");
        return { messages: [mail()], cursor: null };
      },
    });
    const outcomes = await pollDueMailboxes(d, [mailbox, { ...mailbox, id: "mbx-2", mailboxId: "MBX-2", address: "adopt@rescue.example" }]);
    expect(outcomes[0].ok).toBe(false);
    if (!outcomes[0].ok) expect(outcomes[0].error).not.toContain("zzz");
    expect(outcomes[1]).toMatchObject({ ok: true, ingested: 1 });
    expect(f.mailboxUpdates[0].status).toBe("error");
    expect(f.mailboxUpdates[1].status).toBe("connected");
  });

  it("a webhook-fed provider is skipped by the poller", async () => {
    const f = fakeDb();
    const d = deps(f.db, {});
    const out = await pollMailbox(d, { ...mailbox, provider: "postmark-inbound", settings: { inboundAddress: "x@y" } });
    expect(out).toEqual({ mailboxId: "MBX-1", ok: true, fetched: 0, ingested: 0, skipped: 0 });
    expect(f.mailboxUpdates).toHaveLength(0);
  });
});
