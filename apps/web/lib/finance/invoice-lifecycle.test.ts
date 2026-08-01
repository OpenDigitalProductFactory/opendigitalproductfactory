import { describe, it, expect } from "vitest";
import { INVOICE_STATUSES } from "@/lib/finance/finance-validation";
import {
  INVOICE_TRANSITIONS,
  POST_DRAFT_EDITABLE_FIELDS,
  canTransitionInvoice,
  checkInvoiceTransition,
  checkInvoiceDeletion,
  checkInvoiceEditScope,
  describeInvoiceDeletionConsequences,
  describeInvoiceVoidConsequences,
  type InvoiceStatus,
} from "@/lib/finance/invoice-lifecycle";

const cleanFacts = {
  status: "draft" as InvoiceStatus,
  allocationCount: 0,
  dunningCount: 0,
  journalEntryCount: 0,
};

describe("INVOICE_TRANSITIONS", () => {
  it("covers every declared invoice status", () => {
    expect(Object.keys(INVOICE_TRANSITIONS).sort()).toEqual([...INVOICE_STATUSES].sort());
  });

  it("only ever targets declared statuses", () => {
    for (const [from, targets] of Object.entries(INVOICE_TRANSITIONS)) {
      for (const to of targets) {
        expect(INVOICE_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it("never lets a status transition to itself", () => {
    for (const [from, targets] of Object.entries(INVOICE_TRANSITIONS)) {
      expect(targets, `${from} lists itself`).not.toContain(from);
    }
  });

  it("treats void as terminal", () => {
    expect(INVOICE_TRANSITIONS.void).toEqual([]);
  });
});

describe("canTransitionInvoice", () => {
  it.each([
    ["draft", "sent"],
    ["draft", "void"],
    ["draft", "approved"],
    ["approved", "draft"],
    ["sent", "paid"],
    ["sent", "void"],
    ["partially_paid", "paid"],
    ["overdue", "written_off"],
    ["written_off", "paid"],
  ] as const)("permits %s -> %s", (from, to) => {
    expect(canTransitionInvoice(from, to)).toBe(true);
  });

  it.each([
    // The bug this map exists to close: any status -> any status was accepted.
    ["paid", "draft"],
    ["paid", "sent"],
    ["paid", "void"],
    ["void", "draft"],
    ["void", "sent"],
    ["void", "paid"],
    ["sent", "draft"],
    ["written_off", "draft"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransitionInvoice(from, to)).toBe(false);
  });
});

describe("checkInvoiceTransition", () => {
  it("allows a no-op transition", () => {
    expect(checkInvoiceTransition("paid", "paid")).toEqual({ allowed: true });
  });

  it("explains what is permitted when it rejects", () => {
    const result = checkInvoiceTransition("paid", "sent");
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected rejection");
    expect(result.reason).toContain("written_off");
  });

  it("names a terminal status as terminal rather than listing nothing", () => {
    const result = checkInvoiceTransition("void", "draft");
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected rejection");
    expect(result.reason).toContain("terminal");
  });
});

describe("checkInvoiceDeletion", () => {
  it("permits deleting a clean draft", () => {
    expect(checkInvoiceDeletion(cleanFacts)).toEqual({ allowed: true });
  });

  it.each(["sent", "paid", "void", "overdue", "approved"] as const)(
    "refuses to delete a %s invoice and points at void",
    (status) => {
      const result = checkInvoiceDeletion({ ...cleanFacts, status });
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error("expected rejection");
      expect(result.reason).toContain("Void it instead");
    },
  );

  it("refuses a draft that already has a payment allocation", () => {
    const result = checkInvoiceDeletion({ ...cleanFacts, allocationCount: 1 });
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected rejection");
    expect(result.reason).toContain("payment allocation");
  });

  it("refuses a draft that already posted to the ledger", () => {
    const result = checkInvoiceDeletion({ ...cleanFacts, journalEntryCount: 2 });
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected rejection");
    expect(result.reason).toContain("general-ledger");
  });

  it("refuses a draft the customer has already been chased about", () => {
    const result = checkInvoiceDeletion({ ...cleanFacts, dunningCount: 1 });
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected rejection");
    expect(result.reason).toContain("dunning");
  });
});

describe("checkInvoiceEditScope", () => {
  it("lets a draft change anything, line items included", () => {
    expect(checkInvoiceEditScope("draft", ["lineItems", "accountId", "dueDate"])).toEqual({
      allowed: true,
    });
  });

  it.each(["sent", "viewed", "partially_paid", "paid", "overdue"] as const)(
    "freezes the economics of a %s invoice",
    (status) => {
      const result = checkInvoiceEditScope(status, ["lineItems"]);
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error("expected rejection");
      expect(result.rejectedFields).toEqual(["lineItems"]);
      expect(result.reason).toContain("credit note");
    },
  );

  it("still allows the non-economic fields after sending", () => {
    expect(checkInvoiceEditScope("sent", [...POST_DRAFT_EDITABLE_FIELDS])).toEqual({
      allowed: true,
    });
  });

  it("rejects only the offending fields in a mixed edit", () => {
    const result = checkInvoiceEditScope("sent", ["notes", "lineItems", "accountId"]);
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected rejection");
    expect(result.rejectedFields).toEqual(["lineItems", "accountId"]);
    expect(result.rejectedFields).not.toContain("notes");
  });

  it("refuses every edit to a voided invoice", () => {
    const result = checkInvoiceEditScope("void", ["notes"]);
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected rejection");
    expect(result.reason).toContain("Raise a new invoice");
  });

  it("permits an empty edit regardless of status", () => {
    expect(checkInvoiceEditScope("paid", [])).toEqual({ allowed: true });
  });
});

describe("consequence descriptions", () => {
  it("names line items and re-billable time for a deletion", () => {
    const lines = describeInvoiceDeletionConsequences({
      lineItemCount: 3,
      timesheetEntryCount: 8,
      journalEntryCount: 0,
      allocationCount: 0,
    });
    expect(lines.join(" ")).toContain("3 line items");
    expect(lines.join(" ")).toContain("8 billable timesheet entries");
    expect(lines.join(" ")).toContain("cannot be undone");
  });

  it("singularises a one-item deletion", () => {
    const lines = describeInvoiceDeletionConsequences({
      lineItemCount: 1,
      timesheetEntryCount: 1,
      journalEntryCount: 0,
      allocationCount: 0,
    });
    expect(lines.join(" ")).toContain("1 line item.");
    expect(lines.join(" ")).toContain("1 billable timesheet entry");
  });

  it("names ledger reversal and payment unallocation for a void", () => {
    const lines = describeInvoiceVoidConsequences({
      lineItemCount: 3,
      timesheetEntryCount: 0,
      journalEntryCount: 1,
      allocationCount: 2,
    });
    expect(lines.join(" ")).toContain("Unallocates 2 payments");
    expect(lines.join(" ")).toContain("reversing journal entry");
  });

  it("does not claim a ledger reversal when nothing was posted", () => {
    const lines = describeInvoiceVoidConsequences({
      lineItemCount: 1,
      timesheetEntryCount: 0,
      journalEntryCount: 0,
      allocationCount: 0,
    });
    expect(lines.join(" ")).not.toContain("journal");
  });
});
