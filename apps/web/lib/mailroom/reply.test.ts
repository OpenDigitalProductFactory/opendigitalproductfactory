// Mailroom reply — design 2026-09-09 §4.8 (BI-DFEFAE1C; AC-MAIL-DRAFT-REPLY,
// AC-MAIL-APPROVED-SEND, AC-MAIL-NO-SMTP-HONEST).

import { describe, expect, it, vi } from "vitest";

import { COMMON_MAILROOM_PROFILE } from "@dpf/storefront-templates";

import { draftMailroomReply, replySubject, sendApprovedMailroomReply, type MailroomItemForReply, type ReplyDb, type SendMailPort } from "./reply";

const item: MailroomItemForReply = {
  inboundId: "in-1",
  organizationId: "org-1",
  fromAddress: "adopter@example.test",
  fromDisplayName: "Sam Adopter",
  subject: "About Scout",
  body: "Is Scout still available?",
  reasonKey: "customer-enquiry",
  subjectRef: null,
  routedWorkItemId: "WI-1",
  metadata: { messageIdHeader: "<orig@x>", references: ["<older@x>"] },
};

function fakeDb() {
  const drafts: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  const itemUpdates: Array<Record<string, unknown>> = [];
  const roomMessages: Array<Record<string, unknown>> = [];
  const db: ReplyDb = {
    outboundDraft: {
      async findFirst(args) {
        const where = (args as { where: { draftId?: string; sourceId?: string; status?: { in: string[] } } }).where;
        const row = drafts.find((d) => (where.draftId ? d.draftId === where.draftId : d.sourceId === where.sourceId && (where.status?.in ?? []).includes(d.status as string)));
        return row ? { draftId: row.draftId as string, status: row.status as string, body: row.body as string, metadata: row.metadata } : null;
      },
      async create(args) {
        const data = (args as { data: Record<string, unknown> }).data;
        const row = { ...data, draftId: `d-${drafts.length + 1}` };
        drafts.push(row);
        return { draftId: row.draftId };
      },
      async update(args) {
        const { where, data } = args as { where: { draftId: string }; data: Record<string, unknown> };
        Object.assign(drafts.find((d) => d.draftId === where.draftId)!, data);
        return {};
      },
    },
    outboundApprovalDecision: { async create(args) { decisions.push((args as { data: Record<string, unknown> }).data); return {}; } },
    inboundChannelMessage: { async update(args) { itemUpdates.push((args as { data: Record<string, unknown> }).data); return {}; } },
    workItem: { async findFirst() { return { id: "wi-row" }; } },
    workItemMessage: { async create(args) { roomMessages.push((args as { data: Record<string, unknown> }).data); return {}; } },
  };
  return { db, drafts, decisions, itemUpdates, roomMessages };
}

describe("draftMailroomReply", () => {
  it("creates one pending-review draft with threading metadata and never sends", async () => {
    const f = fakeDb();
    const first = await draftMailroomReply({ db: f.db, profile: COMMON_MAILROOM_PROFILE, item, businessName: "Second Chance", agentId: "AGT-WS-MAILROOM" });
    const again = await draftMailroomReply({ db: f.db, profile: COMMON_MAILROOM_PROFILE, item, businessName: "Second Chance", agentId: "AGT-WS-MAILROOM" });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(f.drafts).toHaveLength(1);
    const d = f.drafts[0];
    expect(d.status).toBe("pending-review");
    expect(d.domain).toBe("mailroom");
    expect((d.metadata as { inReplyTo: string }).inReplyTo).toBe("<orig@x>");
    expect((d.metadata as { references: string[] }).references).toEqual(["<older@x>", "<orig@x>"]);
    expect((d.metadata as { subject: string }).subject).toBe("Re: About Scout");
    expect(first.body).toContain("Hi Sam,");
    expect(first.body).toContain("Second Chance");
  });

  it("uses the composer's text when it returns one, and the fallback when it throws", async () => {
    const f = fakeDb();
    const composed = await draftMailroomReply({ db: f.db, profile: COMMON_MAILROOM_PROFILE, item, businessName: "B", agentId: "a", compose: async () => "Scout is still available; come meet him Saturday." });
    expect(composed.body).toBe("Scout is still available; come meet him Saturday.");
    const g = fakeDb();
    const fell = await draftMailroomReply({ db: g.db, profile: COMMON_MAILROOM_PROFILE, item, businessName: "B", agentId: "a", compose: async () => { throw new Error("model down"); } });
    expect(fell.body).toContain("Thank you for writing to B");
  });

  it("replySubject prefixes once", () => {
    expect(replySubject("Hello")).toBe("Re: Hello");
    expect(replySubject("RE: Hello")).toBe("RE: Hello");
    expect(replySubject(null)).toBe("Re: your message");
  });
});

describe("sendApprovedMailroomReply", () => {
  it("sends with In-Reply-To and References, records the approval, marks the item replied and posts on the room", async () => {
    const f = fakeDb();
    const { draftId } = await draftMailroomReply({ db: f.db, profile: COMMON_MAILROOM_PROFILE, item, businessName: "B", agentId: "a" });
    const sendMail = vi.fn<SendMailPort>(async () => ({ messageId: "<sent@x>" }));
    const result = await sendApprovedMailroomReply({
      db: f.db,
      item,
      draftId,
      reviewerUserId: "user-1",
      isEmailConfigured: async () => true,
      sendMail,
      now: new Date("2026-09-09T12:00:00Z"),
    });
    expect(result).toEqual({ status: "sent", messageId: "<sent@x>" });
    const sent = sendMail.mock.calls[0][0];
    expect(sent.to).toBe("adopter@example.test");
    expect(sent.subject).toBe("Re: About Scout");
    expect(sent.inReplyTo).toBe("<orig@x>");
    expect(sent.references).toEqual(["<older@x>", "<orig@x>"]);
    expect(f.decisions[0]).toMatchObject({ draftId, reviewerUserId: "user-1", decision: "approved" });
    expect(f.drafts[0].status).toBe("approved");
    expect(f.itemUpdates[0]).toMatchObject({ mailroomStatus: "replied", draftedReplyId: draftId });
    expect(f.roomMessages).toHaveLength(1);
  });

  it("with no outbound email configured it reports the gap and records nothing", async () => {
    const f = fakeDb();
    const { draftId } = await draftMailroomReply({ db: f.db, profile: COMMON_MAILROOM_PROFILE, item, businessName: "B", agentId: "a" });
    const sendMail = vi.fn(async () => ({ messageId: "x" }));
    const result = await sendApprovedMailroomReply({ db: f.db, item, draftId, reviewerUserId: "u", isEmailConfigured: async () => false, sendMail });
    expect(result).toEqual({ status: "not-configured", settingsRoute: "/admin/settings" });
    expect(sendMail).not.toHaveBeenCalled();
    expect(f.decisions).toHaveLength(0);
    expect(f.itemUpdates).toHaveLength(0);
    expect(f.drafts[0].status).toBe("pending-review");
  });

  it("refuses a draft that is not pending", async () => {
    const f = fakeDb();
    const { draftId } = await draftMailroomReply({ db: f.db, profile: COMMON_MAILROOM_PROFILE, item, businessName: "B", agentId: "a" });
    await f.db.outboundDraft.update({ where: { draftId }, data: { status: "rejected" } });
    const result = await sendApprovedMailroomReply({ db: f.db, item, draftId, reviewerUserId: "u", isEmailConfigured: async () => true, sendMail: async () => ({ messageId: "x" }) });
    expect(result).toEqual({ status: "draft-not-pending" });
  });
});
