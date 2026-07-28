// The no-pollution guarantee.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md §4
//
// A `data-path` probe performs REAL writes. The only thing standing between the
// watchdog and a synthetic booking landing in the owner's reservation queue is
// the rollback sentinel. If these tests fail, the watchdog must not ship.

import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  storefrontInquiry: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  storefrontBooking: {
    create: vi.fn(),
  },
};

/** Stand-in for Prisma's interactive transaction: runs the callback and lets a
 *  throw propagate, exactly as a real rollback does. */
const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: (cb: (t: typeof tx) => Promise<unknown>) => transaction(cb),
  },
}));

const CTX = {
  organizationId: "org_1",
  organizationSlug: "acme",
  baseUrl: "https://example.test",
  storefrontId: "sf_1",
  storefrontPublished: true,
  archetypeIds: ["field-service"],
  bookableItemId: "item_1",
  hasInquirySurface: true,
  hasPaymentConfiguration: true,
  fetchImpl: vi.fn() as unknown as typeof fetch,
  now: () => new Date(0),
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.storefrontInquiry.create.mockResolvedValue({ id: "i1", inquiryRef: "ref", status: "new" });
  tx.storefrontInquiry.findUnique.mockResolvedValue({ inquiryRef: "ref" });
  tx.storefrontBooking.create.mockResolvedValue({ id: "b1" });
});

describe("inquiry data-path probe", () => {
  it("writes a real enquiry and forces the transaction to roll back", async () => {
    const { inquiryDataPathProbe } = await import("./probes");

    const result = await inquiryDataPathProbe(CTX);

    expect(tx.storefrontInquiry.create).toHaveBeenCalledTimes(1);
    expect(result.passed).toBe(true);
    // The callback must have thrown — that throw IS the rollback.
    await expect(transaction.mock.results[0].value).rejects.toThrow(/deliberate rollback/);
  });

  it("uses an unmistakably synthetic identity so a stray row is never read as a customer", async () => {
    const { inquiryDataPathProbe, JOURNEY_SYNTHETIC_IDENTITY } = await import("./probes");

    await inquiryDataPathProbe(CTX);

    const args = tx.storefrontInquiry.create.mock.calls[0][0] as {
      data: { customerEmail: string; customerName: string };
    };
    expect(args.data.customerEmail).toBe(JOURNEY_SYNTHETIC_IDENTITY.email);
    // RFC 2606 reserved TLD — cannot resolve, so it can never reach a real person.
    expect(args.data.customerEmail).toMatch(/\.invalid$/);
    expect(args.data.customerName).toMatch(/watchdog/i);
  });

  it("fails with evidence when the written record cannot be read back", async () => {
    tx.storefrontInquiry.findUnique.mockResolvedValue(null);
    const { inquiryDataPathProbe } = await import("./probes");

    const result = await inquiryDataPathProbe(CTX);

    expect(result.passed).toBe(false);
    expect(result.actual).toContain("not found");
  });

  it("reports an unexpected database error as a failure instead of escaping the sweep", async () => {
    tx.storefrontInquiry.create.mockRejectedValue(new Error("relation does not exist"));
    const { inquiryDataPathProbe } = await import("./probes");

    const result = await inquiryDataPathProbe(CTX);

    expect(result.passed).toBe(false);
    expect(result.actual).toContain("relation does not exist");
  });
});

describe("booking data-path probe", () => {
  /** SQLSTATE 23P01 — what Postgres raises when the gist EXCLUDE constraint
   *  rejects an overlapping booking. */
  function exclusionViolation() {
    return Object.assign(new Error("conflicting key value violates exclusion constraint"), {
      code: "23P01",
    });
  }

  it("passes when the second overlapping booking is rejected by the database", async () => {
    tx.storefrontBooking.create
      .mockResolvedValueOnce({ id: "b1" })
      .mockRejectedValueOnce(exclusionViolation());
    const { bookingDataPathProbe } = await import("./probes");

    const result = await bookingDataPathProbe(CTX);

    expect(result.passed).toBe(true);
    expect(tx.storefrontBooking.create).toHaveBeenCalledTimes(2);
    await expect(transaction.mock.results[0].value).rejects.toThrow(/deliberate rollback/);
  });

  it("FAILS LOUDLY when double-booking protection has lapsed", async () => {
    // Both inserts succeed => the no-overlap constraint is gone. This is the
    // production defect no reachability check could ever see.
    tx.storefrontBooking.create.mockResolvedValue({ id: "b1" });
    const { bookingDataPathProbe } = await import("./probes");

    const result = await bookingDataPathProbe(CTX);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("double-booking protection is not in force");
    expect(result.actual).toContain("both bookings were accepted");
  });

  it("books into a far-future slot so it cannot contend with a real reservation", async () => {
    tx.storefrontBooking.create
      .mockResolvedValueOnce({ id: "b1" })
      .mockRejectedValueOnce(exclusionViolation());
    const { bookingDataPathProbe } = await import("./probes");

    await bookingDataPathProbe(CTX);

    const args = tx.storefrontBooking.create.mock.calls[0][0] as {
      data: { scheduledAt: Date };
    };
    expect(args.data.scheduledAt.getUTCFullYear()).toBeGreaterThan(2090);
  });

  it("does not attempt a rehearsal when there is no bookable item", async () => {
    const { bookingDataPathProbe } = await import("./probes");

    const result = await bookingDataPathProbe({ ...CTX, bookableItemId: null });

    expect(result.passed).toBe(false);
    expect(tx.storefrontBooking.create).not.toHaveBeenCalled();
  });
});
