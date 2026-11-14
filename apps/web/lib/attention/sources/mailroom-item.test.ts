// Mailroom-item attention source — design 2026-09-09 §4.7 (BI-12B0AE91, AC-MAIL-NEEDS-YOU).

import { describe, expect, it } from "vitest";

import { loadMailroomItemAttentionItems, mailroomItemNeedsAttention, mailroomItemToAttentionItem, type MailroomItemRow } from "./mailroom-item";

const now = new Date("2026-09-09T15:00:00Z");

function row(overrides: Partial<MailroomItemRow> = {}): MailroomItemRow {
  return {
    inboundId: "in-9",
    fromAddress: "finder@example.test",
    fromDisplayName: "Pat Finder",
    subject: "Found a dog",
    triageSummary: "Found a dog on Elm St",
    reasonKey: "found-animal",
    urgency: "hours",
    queueKey: "intake",
    subjectRef: null,
    receivedAt: new Date("2026-09-09T10:00:00Z"),
    acknowledgeBy: new Date("2026-09-09T14:00:00Z"),
    ...overrides,
  };
}

describe("mailroom-item attention source", () => {
  it("an item past its acknowledge-by surfaces as overdue with the age past its window", () => {
    expect(mailroomItemNeedsAttention(row(), now)).toBe(true);
    const item = mailroomItemToAttentionItem(row(), now);
    expect(item.source).toBe("mailroom-item");
    expect(item.title).toBe("Acknowledge Pat Finder");
    expect(item.context).toContain("found animal");
    expect(item.context).toContain("1 h past its window");
    expect(item.triage.timeToAct).toBe("overdue");
    expect(item.deepLink).toBe("/workspace/mailroom/items/in-9");
    expect(item.portfolio).toBe("products-and-services-sold");
  });

  it("an immediate item surfaces at once, before its window", () => {
    const r = row({ urgency: "immediate", acknowledgeBy: new Date("2026-09-09T16:00:00Z"), subjectRef: "A-1234" });
    expect(mailroomItemNeedsAttention(r, now)).toBe(true);
    const item = mailroomItemToAttentionItem(r, now);
    expect(item.triage.timeToAct).toBe("due-today");
    expect(item.title).toBe("Acknowledge Pat Finder about A-1234");
    expect(item.context).toContain("needs a person now");
  });

  it("an item still inside its window does not surface", () => {
    expect(mailroomItemNeedsAttention(row({ acknowledgeBy: new Date("2026-09-09T16:00:00Z") }), now)).toBe(false);
  });

  // BI-4647EC04: an emailed supplier invoice is a bill to pay, surfaced when it arrives.
  describe("supplier invoices", () => {
    const invoice = (overrides: Partial<MailroomItemRow> = {}) =>
      row({
        fromAddress: "billing@supplier.example",
        fromDisplayName: "Acme Supplies",
        subject: "Your November invoice",
        triageSummary: "November invoice is available",
        reasonKey: "supplier-invoice",
        urgency: "days",
        queueKey: "finance",
        acknowledgeBy: new Date("2026-09-11T10:00:00Z"),
        ...overrides,
      });

    it("surfaces as soon as it is routed, before its acknowledge-by window", () => {
      expect(mailroomItemNeedsAttention(invoice(), now)).toBe(true);
    });

    it("says a bill arrived and leads with recording it in Bills", () => {
      const item = mailroomItemToAttentionItem(invoice(), now);
      expect(item.title).toBe("A bill arrived from Acme Supplies: record it to pay");
      expect(item.triage.timeToAct).toBe("due-today");
      expect(item.actions[0]).toEqual({ kind: "open-in-context", label: "Record the bill", href: "/finance/bills/new" });
      expect(item.actions[1]).toEqual({ kind: "open-in-context", label: "Open in Mailroom", href: "/workspace/mailroom/items/in-9" });
      expect(item.portfolio).toBe("for-employees");
    });

    it("past its window it is overdue and still a bill to pay", () => {
      const item = mailroomItemToAttentionItem(invoice({ acknowledgeBy: new Date("2026-09-09T14:00:00Z") }), now);
      expect(item.triage.timeToAct).toBe("overdue");
      expect(item.title).toBe("A bill arrived from Acme Supplies: record it to pay");
    });

    it("other reasons keep the acknowledge-by rule", () => {
      expect(mailroomItemNeedsAttention(row({ reasonKey: "customer-enquiry", urgency: "days", acknowledgeBy: new Date("2026-09-11T10:00:00Z") }), now)).toBe(false);
    });

    it("the loader asks for routed supplier invoices regardless of window, and only routed items", async () => {
      let where: unknown = null;
      const db = {
        inboundChannelMessage: {
          async findMany(args: { where: unknown }) {
            where = args.where;
            return [invoice()];
          },
        },
      };
      const items = await loadMailroomItemAttentionItems(db as never, now);
      expect(items.map((i) => i.title)).toEqual(["A bill arrived from Acme Supplies: record it to pay"]);
      expect(where).toMatchObject({ domain: "mailroom", mailroomStatus: "routed" });
      expect((where as { OR: unknown[] }).OR).toContainEqual({ reasonKey: "supplier-invoice" });
    });
  });
});
