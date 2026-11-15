// Mailroom dispatch — privileged handling (BI-757C961E, AC-3).
//
// A privileged reason (counsel mail) still routes to its queue room and still
// notifies the owner, but the model's summary of the content never leaves the
// item: room messages and notifications carry the reason label and sender only.

import { describe, expect, it, vi } from "vitest";

import { COMMON_MAILROOM_PROFILE } from "@dpf/storefront-templates";

import { dispatchMailroomItem, type DispatchDb, type KnownSenderIngress } from "./dispatch";
import type { NormalizedInboundMail } from "./providers/types";
import type { TriageResult } from "./triage";

const SECRET_SUMMARY = "Counsel advises the IP clause is unenforceable against the founder";

function fakeDb() {
  const messages: Array<Record<string, unknown>> = [];
  const db: DispatchDb = {
    workQueue: { async upsert() { return { id: "q-1" }; } },
    workItem: {
      async findFirst() { return null; },
      async create() { return { id: "wi-row", itemId: "WI-1", assignedToUserId: "owner-1" }; },
    },
    workItemMessage: {
      async upsert(args) {
        messages.push((args as { create: Record<string, unknown> }).create);
        return {};
      },
    },
  };
  return { db, messages };
}

const mail = {
  providerMessageId: "1",
  messageIdHeader: "<1@x>",
  inReplyTo: null,
  references: [],
  from: { address: "partner@lawfirm.example", name: "A Partner" },
  to: [],
  subject: "RE: Engagement Letter",
  textBody: "Privileged and confidential analysis.",
  htmlBody: null,
  receivedAt: new Date("2026-11-04T18:45:00Z"),
  headers: {},
  attachments: [],
} as NormalizedInboundMail;

function triage(reasonKey: string, queueKey: string): TriageResult {
  return { reasonKey, urgency: "days", queueKey, noise: false, summary: SECRET_SUMMARY, subjectRef: null, source: "rule-hint", flagged: false };
}

const item = { inboundId: "in-1", channelId: "mailbox:MBX-1", providerAccountId: "MBX-1", receivedAt: new Date("2026-11-04T18:45:00Z") };

describe("dispatch of a privileged reason", () => {
  it("routes to the Legal room and notifies the owner without the content summary", async () => {
    const f = fakeDb();
    const notify = vi.fn(async () => undefined);
    const { target } = await dispatchMailroomItem({
      db: f.db,
      profile: COMMON_MAILROOM_PROFILE,
      item,
      mail,
      triage: triage("legal-correspondence", "legal"),
      notify,
    });
    expect(target).toMatchObject({ kind: "queue-room", queueKey: "legal", notified: true });
    const roomBody = String(f.messages[0]?.body);
    expect(roomBody).not.toContain(SECRET_SUMMARY);
    expect(roomBody).toContain("Correspondence from counsel");
    expect(roomBody).toContain("partner@lawfirm.example");
    const n = (notify.mock.calls[0] as unknown as [{ title: string; body: string }])[0];
    expect(n.title).not.toContain(SECRET_SUMMARY);
    expect(n.body).not.toContain(SECRET_SUMMARY);
    expect(n.title).toContain("Correspondence from counsel");
  });

  it("never hands the content summary to a known-sender room either", async () => {
    const f = fakeDb();
    const ingress = vi.fn<KnownSenderIngress>(async () => ({ status: "accepted", room: { workItemId: "WI-9", caseKey: "c" } }) as never);
    await dispatchMailroomItem({
      db: f.db,
      profile: COMMON_MAILROOM_PROFILE,
      item,
      mail,
      triage: triage("legal-correspondence", "legal"),
      knownSenderIngress: ingress,
    });
    expect(ingress.mock.calls[0]![0].body).not.toContain(SECRET_SUMMARY);
  });

  it("a non-privileged reason keeps the summary, as before", async () => {
    const f = fakeDb();
    const notify = vi.fn(async () => undefined);
    await dispatchMailroomItem({ db: f.db, profile: COMMON_MAILROOM_PROFILE, item, mail, triage: triage("customer-enquiry", "owner-desk"), notify });
    expect(String(f.messages[0]?.body)).toContain(SECRET_SUMMARY);
    expect((notify.mock.calls[0] as unknown as [{ title: string }])[0].title).toContain(SECRET_SUMMARY);
  });
});
