import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    dunningSequence: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    dunningStep: {},
    dunningLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    bill: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  composeDunningEmail: vi.fn().mockReturnValue({
    to: "customer@example.com",
    subject: "Reminder",
    text: "Please pay",
    html: "<p>Please pay</p>",
  }),
  sendEmail: vi.fn().mockResolvedValue({ messageId: "msg-1" }),
}));

import { prisma } from "@dpf/db";
import { composeDunningEmail, sendEmail } from "@/lib/email";
import {
  seedDefaultDunningSequence,
  getDefaultDunningSequence,
  runDunning,
  getAgedDebtors,
} from "./dunning";

const mockPrisma = prisma as any;
const mockComposeDunningEmail = vi.mocked(composeDunningEmail);
const mockSendEmail = vi.mocked(sendEmail);

// Helper: build a dunning sequence with steps
const makeSequence = (stepOverrides: Partial<(typeof DEFAULT_STEPS)[0]>[] = []) => ({
  id: "seq-1",
  name: "Standard Credit Control",
  isDefault: true,
  isActive: true,
  steps: DEFAULT_STEPS.map((step, idx) => ({
    id: `step-${idx}`,
    sequenceId: "seq-1",
    ...step,
    ...(stepOverrides[idx] ?? {}),
  })),
});

const DEFAULT_STEPS = [
  { dayOffset: -3, subject: "Upcoming reminder", emailTemplate: "friendly_predue", severity: "friendly", sortOrder: 0 },
  { dayOffset: 7, subject: "Payment reminder", emailTemplate: "first_overdue", severity: "friendly", sortOrder: 1 },
  { dayOffset: 14, subject: "Second reminder", emailTemplate: "firm_reminder", severity: "firm", sortOrder: 2 },
  { dayOffset: 30, subject: "Final notice", emailTemplate: "final_notice", severity: "final", sortOrder: 3 },
  { dayOffset: 45, subject: "Escalation notice", emailTemplate: "escalation", severity: "escalation", sortOrder: 4 },
];

// Helper: build an invoice with a dueDate N days ago
function makeInvoice(daysPastDue: number, overrides: Record<string, unknown> = {}) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() - daysPastDue);
  return {
    id: "inv-1",
    invoiceRef: "INV-2026-0001",
    status: "sent",
    dueDate,
    amountDue: 1000,
    currency: "USD",
    payToken: "tok123",
    accountId: "acc-1",
    account: { id: "acc-1", name: "Acme Ltd" },
    contact: { email: "customer@example.com", firstName: "Jane", lastName: "Smith" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── seedDefaultDunningSequence ───────────────────────────────────────────────

describe("seedDefaultDunningSequence", () => {
  it("creates 5 steps when no default sequence exists", async () => {
    mockPrisma.dunningSequence.findFirst.mockResolvedValue(null);
    mockPrisma.dunningSequence.create.mockResolvedValue({ id: "seq-1" });

    await seedDefaultDunningSequence();

    expect(mockPrisma.dunningSequence.create).toHaveBeenCalledOnce();
    const createCall = mockPrisma.dunningSequence.create.mock.calls[0][0];
    expect(createCall.data.steps.create).toHaveLength(5);
    expect(createCall.data.isDefault).toBe(true);
  });

  it("does not create a second sequence if default already exists (idempotent)", async () => {
    mockPrisma.dunningSequence.findFirst.mockResolvedValue({ id: "seq-existing" });

    const result = await seedDefaultDunningSequence();

    expect(mockPrisma.dunningSequence.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "seq-existing" });
  });

  it("creates step with dayOffset=-3 as first step (pre-due reminder)", async () => {
    mockPrisma.dunningSequence.findFirst.mockResolvedValue(null);
    mockPrisma.dunningSequence.create.mockResolvedValue({ id: "seq-1" });

    await seedDefaultDunningSequence();

    const createCall = mockPrisma.dunningSequence.create.mock.calls[0][0];
    const firstStep = createCall.data.steps.create[0];
    expect(firstStep.dayOffset).toBe(-3);
    expect(firstStep.severity).toBe("friendly");
  });

  it("creates escalation step at dayOffset=45", async () => {
    mockPrisma.dunningSequence.findFirst.mockResolvedValue(null);
    mockPrisma.dunningSequence.create.mockResolvedValue({ id: "seq-1" });

    await seedDefaultDunningSequence();

    const createCall = mockPrisma.dunningSequence.create.mock.calls[0][0];
    const lastStep = createCall.data.steps.create[4];
    expect(lastStep.dayOffset).toBe(45);
    expect(lastStep.severity).toBe("escalation");
  });
});

// ─── runDunning ───────────────────────────────────────────────────────────────

describe("runDunning", () => {
  // Setup: getDefaultDunningSequence calls seedDefaultDunningSequence first,
  // then findFirst with include. We mock findFirst to return sequence with steps.
  const setupSequenceMock = () => {
    // First call: seedDefaultDunningSequence → findFirst (check exists)
    // Second call: getDefaultDunningSequence → findFirst (get with steps)
    mockPrisma.dunningSequence.findFirst
      .mockResolvedValueOnce({ id: "seq-1" }) // idempotency check
      .mockResolvedValueOnce(makeSequence()); // get with steps
  };

  it("sends reminder for overdue invoice at the correct step", async () => {
    setupSequenceMock();
    // Invoice 10 days past due → step at dayOffset=7 applies
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(10)]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null); // not already sent
    mockPrisma.dunningLog.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    const result = await runDunning();

    expect(result.remindersSent).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockComposeDunningEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceRef: "INV-2026-0001",
        severity: "friendly", // step at dayOffset=7 is "friendly"
      }),
    );
  });

  it("skips already-sent reminders (checks DunningLog)", async () => {
    setupSequenceMock();
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(10)]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue({ id: "log-existing" }); // already sent

    const result = await runDunning();

    expect(result.remindersSent).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("marks invoice status as overdue when past due and currently sent", async () => {
    setupSequenceMock();
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(10, { status: "sent" })]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null);
    mockPrisma.dunningLog.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    await runDunning();

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("overdue");
  });

  it("marks invoice status as overdue when past due and currently viewed", async () => {
    setupSequenceMock();
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(10, { status: "viewed" })]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null);
    mockPrisma.dunningLog.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    await runDunning();

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("overdue");
  });

  it("does not change status when invoice is already overdue", async () => {
    setupSequenceMock();
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(10, { status: "overdue" })]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null);
    mockPrisma.dunningLog.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    await runDunning();

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it("applies pre-due step when invoice is not yet due (daysPastDue = -2)", async () => {
    setupSequenceMock();
    // daysPastDue = -2, so step at dayOffset=-3 applies (since -3 <= -2)
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(-2)]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null);
    mockPrisma.dunningLog.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    const result = await runDunning();

    expect(result.remindersSent).toBe(1);
    expect(mockComposeDunningEmail).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "friendly" }),
    );
  });

  it("skips invoice where no step applies (too far before due)", async () => {
    setupSequenceMock();
    // daysPastDue = -10, no step at dayOffset <= -10
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(-10)]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null);

    const result = await runDunning();

    expect(result.remindersSent).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("applies final notice step for invoice 35 days overdue", async () => {
    setupSequenceMock();
    // daysPastDue = 35 → highest step with dayOffset <= 35 is step at 30 (final)
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(35, { status: "overdue" })]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null);
    mockPrisma.dunningLog.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    await runDunning();

    expect(mockComposeDunningEmail).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "final" }),
    );
  });

  it("increments reminderCount on invoice", async () => {
    setupSequenceMock();
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(10)]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null);
    mockPrisma.dunningLog.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    await runDunning();

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.reminderCount).toEqual({ increment: 1 });
    expect(updateCall.data.lastReminderAt).toBeInstanceOf(Date);
  });

  it("skips email send when invoice has no contact", async () => {
    setupSequenceMock();
    mockPrisma.invoice.findMany.mockResolvedValue([makeInvoice(10, { contact: null })]);
    mockPrisma.dunningLog.findFirst.mockResolvedValue(null);
    mockPrisma.dunningLog.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    const result = await runDunning();

    // Still logs the dunning action, but doesn't send email
    expect(result.remindersSent).toBe(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

// ─── getAgedDebtors ───────────────────────────────────────────────────────────

describe("getAgedDebtors", () => {
  function makeInvoiceWithDue(daysAgo: number, accountId: string, accountName: string, amount: number) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - daysAgo);
    return {
      id: `inv-${daysAgo}-${accountId}`,
      accountId,
      amountDue: amount,
      dueDate,
      account: { id: accountId, name: accountName },
    };
  }

  it("buckets invoices correctly into current, 30d, 60d, 90d, 90d+", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      makeInvoiceWithDue(0, "acc-1", "Acme", 100),      // current
      makeInvoiceWithDue(15, "acc-1", "Acme", 200),     // 1-30 days
      makeInvoiceWithDue(45, "acc-1", "Acme", 300),     // 31-60 days
      makeInvoiceWithDue(75, "acc-1", "Acme", 400),     // 61-90 days
      makeInvoiceWithDue(100, "acc-1", "Acme", 500),    // 90+ days
    ]);

    const { rows, grandTotals } = await getAgedDebtors();

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.current).toBe(100);
    expect(row.days30).toBe(200);
    expect(row.days60).toBe(300);
    expect(row.days90).toBe(400);
    expect(row.days90plus).toBe(500);
    expect(row.total).toBe(1500);

    expect(grandTotals.current).toBe(100);
    expect(grandTotals.days30).toBe(200);
    expect(grandTotals.total).toBe(1500);
  });

  it("groups multiple accounts separately", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      makeInvoiceWithDue(15, "acc-1", "Acme", 500),
      makeInvoiceWithDue(15, "acc-2", "Beta Corp", 300),
    ]);

    const { rows } = await getAgedDebtors();

    expect(rows).toHaveLength(2);
    const acme = rows.find((r) => r.accountId === "acc-1")!;
    const beta = rows.find((r) => r.accountId === "acc-2")!;
    expect(acme.days30).toBe(500);
    expect(beta.days30).toBe(300);
  });

  it("returns zero grand totals when no invoices", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    const { rows, grandTotals } = await getAgedDebtors();

    expect(rows).toHaveLength(0);
    expect(grandTotals.total).toBe(0);
    expect(grandTotals.current).toBe(0);
  });

  it("boundary: invoice due exactly 30 days ago goes in days30 bucket", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      makeInvoiceWithDue(30, "acc-1", "Acme", 100),
    ]);

    const { rows } = await getAgedDebtors();
    expect(rows[0]!.days30).toBe(100);
    expect(rows[0]!.days60).toBe(0);
  });

  it("boundary: invoice due 35 days ago goes in days60 bucket", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      makeInvoiceWithDue(35, "acc-1", "Acme", 100),
    ]);

    const { rows } = await getAgedDebtors();
    expect(rows[0]!.days60).toBe(100);
    expect(rows[0]!.days30).toBe(0);
  });

  it("sums multiple invoices for same account in same bucket", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      makeInvoiceWithDue(10, "acc-1", "Acme", 400),
      makeInvoiceWithDue(20, "acc-1", "Acme", 600),
    ]);

    const { rows } = await getAgedDebtors();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.days30).toBe(1000);
    expect(rows[0]!.total).toBe(1000);
  });
});
