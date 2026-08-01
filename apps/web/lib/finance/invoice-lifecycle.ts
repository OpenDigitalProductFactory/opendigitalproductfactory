import { INVOICE_STATUSES } from "@/lib/finance/finance-validation";

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * The one declared source of truth for invoice status movement.
 *
 * Before this map existed, `updateInvoiceStatus` accepted ANY status -> ANY status
 * and `sendInvoice` would happily re-send an already-paid or voided invoice. Every
 * caller that moves an invoice consults this map rather than re-deriving its own
 * rules, so the lifecycle stays one thing rather than several drifting opinions.
 *
 * Terminal states map to an empty list. `void` is deliberately terminal: correcting
 * a voided invoice means issuing a new one (or a credit note), not resurrecting it.
 */
export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ["approved", "sent", "void"],
  // An approved invoice can drop back to draft while it still has not left the building.
  approved: ["draft", "sent", "void"],
  sent: ["viewed", "partially_paid", "paid", "overdue", "void"],
  viewed: ["partially_paid", "paid", "overdue", "void"],
  partially_paid: ["paid", "overdue", "void", "written_off"],
  overdue: ["partially_paid", "paid", "void", "written_off"],
  // A paid invoice is not voidable — issue a credit note instead, so the ledger keeps
  // both halves of the story. Write-off covers the clawback/bad-debt case.
  paid: ["written_off"],
  // Recovery of a written-off debt is real, so this is not terminal.
  written_off: ["paid"],
  void: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

export type TransitionCheck =
  | { allowed: true }
  | { allowed: false; reason: string };

export function checkInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): TransitionCheck {
  if (from === to) return { allowed: true };
  if (canTransitionInvoice(from, to)) return { allowed: true };

  const permitted = INVOICE_TRANSITIONS[from];
  const detail = permitted.length
    ? `Permitted from "${from}": ${permitted.join(", ")}.`
    : `"${from}" is a terminal status.`;
  return { allowed: false, reason: `Cannot move an invoice from "${from}" to "${to}". ${detail}` };
}

// ─── Deletion gate ────────────────────────────────────────────────────────────

/**
 * Facts the deletion gate needs. Kept as plain counts so the rule is pure and
 * unit-testable without a database.
 */
export type InvoiceDeletionFacts = {
  status: InvoiceStatus;
  allocationCount: number;
  dunningCount: number;
  journalEntryCount: number;
};

export type DeletionCheck =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Deletion is for the mistake that never became a business record. Anything that
 * has touched a customer, a payment, or the ledger must be VOIDED instead, so the
 * audit trail survives.
 */
export function checkInvoiceDeletion(facts: InvoiceDeletionFacts): DeletionCheck {
  if (facts.status !== "draft") {
    return {
      allowed: false,
      reason: `Only a draft invoice can be deleted; this one is "${facts.status}". Void it instead to keep the audit trail.`,
    };
  }
  if (facts.allocationCount > 0) {
    return {
      allowed: false,
      reason: `This invoice has ${facts.allocationCount} payment allocation(s) against it. Void it instead so the payment record survives.`,
    };
  }
  if (facts.journalEntryCount > 0) {
    return {
      allowed: false,
      reason: `This invoice has ${facts.journalEntryCount} general-ledger posting(s). Void it instead so the ledger can be reversed rather than orphaned.`,
    };
  }
  if (facts.dunningCount > 0) {
    return {
      allowed: false,
      reason: `This invoice has ${facts.dunningCount} dunning record(s), so a customer has already been contacted about it. Void it instead.`,
    };
  }
  return { allowed: true };
}

// ─── Edit scope ───────────────────────────────────────────────────────────────

/**
 * Fields that stay editable after an invoice has left the building. They are the
 * ones that carry no economic claim: nothing here changes what the customer owes.
 */
export const POST_DRAFT_EDITABLE_FIELDS = [
  "notes",
  "internalNotes",
  "paymentTerms",
  "dueDate",
] as const;

export type InvoiceEditableField =
  | (typeof POST_DRAFT_EDITABLE_FIELDS)[number]
  | "lineItems"
  | "accountId"
  | "contactId"
  | "type"
  | "currency";

export type EditScopeCheck =
  | { allowed: true }
  | { allowed: false; reason: string; rejectedFields: string[] };

/**
 * A draft is fully editable. Once an invoice is sent, its economics are frozen:
 * the customer is holding a PDF stating what they owe, and silently changing the
 * total underneath that document is the audit failure this whole epic exists to
 * close. Terminal invoices (void) are not editable at all.
 */
export function checkInvoiceEditScope(
  status: InvoiceStatus,
  fields: readonly string[],
): EditScopeCheck {
  if (status === "draft") return { allowed: true };

  if (status === "void") {
    return {
      allowed: false,
      reason: "A voided invoice cannot be edited. Raise a new invoice instead.",
      rejectedFields: [...fields],
    };
  }

  const safe = new Set<string>(POST_DRAFT_EDITABLE_FIELDS);
  const rejectedFields = fields.filter((f) => !safe.has(f));
  if (rejectedFields.length === 0) return { allowed: true };

  return {
    allowed: false,
    reason:
      `This invoice is "${status}", so its economics are frozen — the customer already has a document stating what they owe. ` +
      `Cannot change: ${rejectedFields.join(", ")}. Still editable: ${POST_DRAFT_EDITABLE_FIELDS.join(", ")}. ` +
      `To change the amounts, void this invoice and raise a new one, or issue a credit note.`,
    rejectedFields,
  };
}

// ─── Consequence description ──────────────────────────────────────────────────

export type InvoiceConsequenceFacts = {
  lineItemCount: number;
  timesheetEntryCount: number;
  journalEntryCount: number;
  allocationCount: number;
};

/**
 * Human-readable consequences for the confirmation prompt. A destructive control
 * should tell the operator what it is about to do to what, not just ask "are you sure".
 */
export function describeInvoiceDeletionConsequences(facts: InvoiceConsequenceFacts): string[] {
  const out: string[] = [];
  if (facts.lineItemCount > 0) {
    out.push(`Removes ${facts.lineItemCount} line item${facts.lineItemCount === 1 ? "" : "s"}.`);
  }
  if (facts.timesheetEntryCount > 0) {
    out.push(
      `Returns ${facts.timesheetEntryCount} billable timesheet entr${facts.timesheetEntryCount === 1 ? "y" : "ies"} to the unbilled pool.`,
    );
  }
  out.push("This cannot be undone.");
  return out;
}

export function describeInvoiceVoidConsequences(facts: InvoiceConsequenceFacts): string[] {
  const out: string[] = ["Keeps the invoice on record with status “void”."];
  if (facts.allocationCount > 0) {
    out.push(
      `Unallocates ${facts.allocationCount} payment${facts.allocationCount === 1 ? "" : "s"}; the payment record itself is kept.`,
    );
  }
  if (facts.journalEntryCount > 0) {
    out.push(
      `Posts ${facts.journalEntryCount} reversing journal entr${facts.journalEntryCount === 1 ? "y" : "ies"} to the general ledger.`,
    );
  }
  if (facts.timesheetEntryCount > 0) {
    out.push(
      `Returns ${facts.timesheetEntryCount} billable timesheet entr${facts.timesheetEntryCount === 1 ? "y" : "ies"} to the unbilled pool.`,
    );
  }
  return out;
}
