import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    recurringSchedule: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    recurringLineItem: {},
    invoice: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/actions/finance", () => ({
  createInvoice: vi.fn(),
  sendInvoice: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { createInvoice, sendInvoice } from "@/lib/actions/finance";
import {
  createRecurringSchedule,
  getRecurringSchedule,
  listRecurringSchedules,
  updateScheduleStatus,
  calculateNextDate,
  generateDueInvoices,
} from "./recurring";

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);
const mockPrisma = prisma as any;
const mockCreateInvoice = vi.mocked(createInvoice);
const mockSendInvoice = vi.mocked(sendInvoice);

const authorizedSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

const baseScheduleInput = {
  accountId: "acc-1",
  name: "Monthly retainer",
  frequency: "monthly" as const,
  startDate: "2026-04-01",
  autoSend: true,
  currency: "USD",
  lineItems: [
    { description: "Consulting", quantity: 1, unitPrice: 2000, taxRate: 20 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authorizedSession as never);
  mockCan.mockReturnValue(true);
});

// ─── Auth checks ──────────────────────────────────────────────────────────────

describe("auth", () => {
  it("createRecurringSchedule throws when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    await expect(createRecurringSchedule(baseScheduleInput)).rejects.toThrow("Unauthorized");
  });

  it("createRecurringSchedule throws when unauthorized", async () => {
    mockCan.mockReturnValue(false);
    await expect(createRecurringSchedule(baseScheduleInput)).rejects.toThrow("Unauthorized");
  });
});

// ─── createRecurringSchedule ──────────────────────────────────────────────────

describe("createRecurringSchedule", () => {
  it("generates REC- prefixed scheduleId", async () => {
    mockPrisma.recurringSchedule.create.mockResolvedValue({
      id: "sch-1",
      scheduleId: "REC-abc12345",
    });

    await createRecurringSchedule(baseScheduleInput);

    expect(mockPrisma.recurringSchedule.create).toHaveBeenCalledOnce();
    const createCall = mockPrisma.recurringSchedule.create.mock.calls[0][0];
    expect(createCall.data.scheduleId).toMatch(/^REC-/);
    expect(createCall.data.scheduleId.length).toBe(12); // REC- (4) + nanoid(8) (8)
  });

  it("calculates amount from line items including tax", async () => {
    mockPrisma.recurringSchedule.create.mockResolvedValue({
      id: "sch-1",
      scheduleId: "REC-abc12345",
    });

    // qty=1, unitPrice=2000, taxRate=20 → 1 * 2000 * 1.20 = 2400
    await createRecurringSchedule(baseScheduleInput);

    const createCall = mockPrisma.recurringSchedule.create.mock.calls[0][0];
    expect(Number(createCall.data.amount)).toBe(2400);
  });

  it("calculates amount for multiple line items", async () => {
    mockPrisma.recurringSchedule.create.mockResolvedValue({
      id: "sch-1",
      scheduleId: "REC-abc12345",
    });

    const multiItemInput = {
      ...baseScheduleInput,
      lineItems: [
        { description: "Item A", quantity: 2, unitPrice: 500, taxRate: 20 }, // 2 * 500 * 1.2 = 1200
        { description: "Item B", quantity: 1, unitPrice: 100, taxRate: 0 },  // 1 * 100 * 1.0 = 100
      ],
    };

    await createRecurringSchedule(multiItemInput);

    const createCall = mockPrisma.recurringSchedule.create.mock.calls[0][0];
    expect(Number(createCall.data.amount)).toBe(1300);
  });

  it("sets nextInvoiceDate to startDate", async () => {
    mockPrisma.recurringSchedule.create.mockResolvedValue({
      id: "sch-1",
      scheduleId: "REC-abc12345",
    });

    await createRecurringSchedule(baseScheduleInput);

    const createCall = mockPrisma.recurringSchedule.create.mock.calls[0][0];
    expect(createCall.data.nextInvoiceDate).toEqual(new Date(baseScheduleInput.startDate));
  });

  it("nests line items in create call", async () => {
    mockPrisma.recurringSchedule.create.mockResolvedValue({
      id: "sch-1",
      scheduleId: "REC-abc12345",
    });

    await createRecurringSchedule(baseScheduleInput);

    const createCall = mockPrisma.recurringSchedule.create.mock.calls[0][0];
    expect(createCall.data.lineItems.create).toHaveLength(1);
    expect(createCall.data.lineItems.create[0].description).toBe("Consulting");
  });
});

// ─── calculateNextDate ────────────────────────────────────────────────────────

describe("calculateNextDate", () => {
  const base = new Date("2026-04-01");

  it("adds 7 days for weekly", () => {
    const result = calculateNextDate(base, "weekly");
    expect(result).toEqual(new Date("2026-04-08"));
  });

  it("adds 14 days for fortnightly", () => {
    const result = calculateNextDate(base, "fortnightly");
    expect(result).toEqual(new Date("2026-04-15"));
  });

  it("adds 1 month for monthly", () => {
    const result = calculateNextDate(base, "monthly");
    expect(result).toEqual(new Date("2026-05-01"));
  });

  it("adds 3 months for quarterly", () => {
    const result = calculateNextDate(base, "quarterly");
    expect(result).toEqual(new Date("2026-07-01"));
  });

  it("adds 1 year for annually", () => {
    const result = calculateNextDate(base, "annually");
    expect(result).toEqual(new Date("2027-04-01"));
  });

  it("handles month-end for monthly (Jan 31 → Feb 28)", () => {
    const jan31 = new Date("2026-01-31");
    const result = calculateNextDate(jan31, "monthly");
    // Feb 2026 has 28 days
    expect(result).toEqual(new Date("2026-02-28"));
  });

  it("handles month-end for quarterly (Nov 30 → Feb 28)", () => {
    const nov30 = new Date("2025-11-30");
    const result = calculateNextDate(nov30, "quarterly");
    // Feb 2026 has 28 days
    expect(result).toEqual(new Date("2026-02-28"));
  });

  it("throws for unknown frequency", () => {
    expect(() => calculateNextDate(base, "hourly")).toThrow("Unknown frequency");
  });
});

// ─── generateDueInvoices ──────────────────────────────────────────────────────

describe("generateDueInvoices", () => {
  const makeSchedule = (overrides = {}) => ({
    id: "sch-1",
    accountId: "acc-1",
    frequency: "monthly",
    currency: "USD",
    nextInvoiceDate: new Date("2026-03-01"), // past
    endDate: null,
    autoSend: true,
    status: "active",
    lineItems: [
      { description: "Consulting", quantity: 1, unitPrice: 2000, taxRate: 20, sortOrder: 0 },
    ],
    ...overrides,
  });

  it("creates invoices for due schedules and returns correct counts", async () => {
    mockPrisma.recurringSchedule.findMany.mockResolvedValue([makeSchedule()]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null); // no existing invoice
    mockCreateInvoice.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0001" });
    mockSendInvoice.mockResolvedValue({ payToken: "tok123" });
    mockPrisma.recurringSchedule.update.mockResolvedValue({});

    const result = await generateDueInvoices();

    expect(result.generated).toBe(1);
    expect(result.sent).toBe(1);
    expect(mockCreateInvoice).toHaveBeenCalledOnce();
    expect(mockSendInvoice).toHaveBeenCalledWith("inv-1");
  });

  it("advances nextInvoiceDate after generation", async () => {
    mockPrisma.recurringSchedule.findMany.mockResolvedValue([makeSchedule()]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockCreateInvoice.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0001" });
    mockSendInvoice.mockResolvedValue({ payToken: "tok123" });
    mockPrisma.recurringSchedule.update.mockResolvedValue({});

    await generateDueInvoices();

    const updateCall = mockPrisma.recurringSchedule.update.mock.calls[0][0];
    // monthly from 2026-03-01 → 2026-04-01
    expect(updateCall.data.nextInvoiceDate).toEqual(new Date("2026-04-01"));
    expect(updateCall.data.lastInvoicedAt).toBeInstanceOf(Date);
  });

  it("skips paused schedules (only active queried)", async () => {
    // The findMany mock only returns active schedules per the where clause
    mockPrisma.recurringSchedule.findMany.mockResolvedValue([]); // paused not returned
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const result = await generateDueInvoices();

    expect(result.generated).toBe(0);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it("skips already-generated invoices (idempotent)", async () => {
    mockPrisma.recurringSchedule.findMany.mockResolvedValue([makeSchedule()]);
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "existing-inv" }); // already exists

    const result = await generateDueInvoices();

    expect(result.generated).toBe(0);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it("does not call sendInvoice when autoSend is false", async () => {
    mockPrisma.recurringSchedule.findMany.mockResolvedValue([makeSchedule({ autoSend: false })]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockCreateInvoice.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0001" });
    mockPrisma.recurringSchedule.update.mockResolvedValue({});

    const result = await generateDueInvoices();

    expect(result.generated).toBe(1);
    expect(result.sent).toBe(0);
    expect(mockSendInvoice).not.toHaveBeenCalled();
  });

  it("marks schedule completed when nextDate exceeds endDate", async () => {
    const endDate = new Date("2026-03-31"); // before next monthly date
    mockPrisma.recurringSchedule.findMany.mockResolvedValue([
      makeSchedule({ endDate }),
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockCreateInvoice.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0001" });
    mockSendInvoice.mockResolvedValue({ payToken: "tok123" });
    mockPrisma.recurringSchedule.update.mockResolvedValue({});

    await generateDueInvoices();

    const updateCall = mockPrisma.recurringSchedule.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("completed");
  });

  it("keeps schedule active when nextDate is before endDate", async () => {
    const endDate = new Date("2027-01-01"); // well after next monthly date
    mockPrisma.recurringSchedule.findMany.mockResolvedValue([
      makeSchedule({ endDate }),
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockCreateInvoice.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0001" });
    mockSendInvoice.mockResolvedValue({ payToken: "tok123" });
    mockPrisma.recurringSchedule.update.mockResolvedValue({});

    await generateDueInvoices();

    const updateCall = mockPrisma.recurringSchedule.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("active");
  });

  it("passes sourceType=recurring and sourceId to createInvoice", async () => {
    mockPrisma.recurringSchedule.findMany.mockResolvedValue([makeSchedule()]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockCreateInvoice.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0001" });
    mockSendInvoice.mockResolvedValue({ payToken: "tok123" });
    mockPrisma.recurringSchedule.update.mockResolvedValue({});

    await generateDueInvoices();

    const createCall = mockCreateInvoice.mock.calls[0][0];
    expect(createCall.sourceType).toBe("recurring");
    expect(createCall.sourceId).toBe("sch-1");
  });
});
