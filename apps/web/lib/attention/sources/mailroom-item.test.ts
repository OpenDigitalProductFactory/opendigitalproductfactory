// Mailroom-item attention source — design 2026-09-09 §4.7 (BI-12B0AE91, AC-MAIL-NEEDS-YOU).

import { describe, expect, it } from "vitest";

import { mailroomItemNeedsAttention, mailroomItemToAttentionItem, type MailroomItemRow } from "./mailroom-item";

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
});
