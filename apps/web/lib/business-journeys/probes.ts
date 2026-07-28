// Journey probes — the three depths this slice can actually establish.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md §3–§4
//
// Cheapest first: a `reachability` probe is one HTTP call, a `contract` probe is
// one indexed query, and a `data-path` probe opens a transaction. The runner
// only reaches the expensive ones when the cheap ones for that journey passed.

import { prisma, type Prisma } from "@dpf/db";
import { newId } from "@/lib/shared/new-id";
import { isExclusionViolation } from "@/lib/db/exclusion-violation";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { JourneyProbeContext, StepProbeResult } from "./types";

/**
 * Thrown to force a `data-path` probe's transaction to roll back.
 *
 * This is the mechanism that keeps the watchdog from polluting the business: a
 * synthetic booking sitting in the owner's reservation queue would be a defect,
 * not evidence. Every write a probe performs is inside a transaction that ends
 * by throwing this.
 */
class RollbackSentinel extends Error {
  /** The probe verdict, carried OUT on the throw.
   *
   *  Carrying the result on the sentinel rather than assigning to a closure
   *  variable keeps the rollback and the result on one path: there is no way to
   *  return a verdict without also having thrown, so a future edit cannot
   *  accidentally commit by returning early. */
  constructor(readonly result: StepProbeResult) {
    super("journey-watchdog: deliberate rollback");
    this.name = "RollbackSentinel";
  }
}

/**
 * Recognisably synthetic identity, so a row that somehow escaped rollback is
 * obviously the watchdog's and never mistaken for a real customer. `.invalid` is
 * reserved by RFC 2606 and can never resolve, so even a bug that committed one
 * of these rows could not mail a real person.
 */
const SYNTHETIC = {
  name: "DPF Journey Watchdog",
  email: "journey-watchdog@dpf.invalid",
} as const;

/** Far-future slot: cannot contend with a genuine booking for locks, and cannot
 *  be mistaken for a real reservation if it were ever inspected mid-transaction. */
function syntheticSlot(): Date {
  return new Date(Date.UTC(2099, 0, 1, 12, 0, 0));
}

// ── reachability ─────────────────────────────────────────────────────────────

/**
 * The install's own loopback origin.
 *
 * The watchdog runs INSIDE the install, so the public address may be
 * unreachable from here for reasons that are not an outage — split-horizon DNS,
 * a proxy that only accepts external traffic, a hairpin-NAT gap. Probing the
 * public origin is still right (that is the customer's actual path), but a
 * connection-level failure alone is not proof the site is down.
 *
 * So a network failure is re-tried against loopback, and the two cases are
 * reported DIFFERENTLY: "down for everyone" and "up inside, unreachable at its
 * public address" are different problems with different fixes, and collapsing
 * them would send the operator hunting the wrong one.
 */
function loopbackOrigin(): string {
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

/**
 * The entry surface responds. Proves the door opens — nothing more, which is
 * exactly why this returns depth `reachability` and can never lift a journey's
 * achieved depth above it.
 */
export function reachabilityProbe(pathFor: (ctx: JourneyProbeContext) => string | null) {
  return async (ctx: JourneyProbeContext): Promise<StepProbeResult> => {
    const path = pathFor(ctx);
    if (!path) {
      return {
        passed: false,
        detail: "Could not build the customer-facing URL for this journey.",
        expected: "a resolvable public path",
        actual: "the install has no organization slug",
      };
    }
    if (!ctx.baseUrl) {
      return {
        passed: false,
        detail:
          "This install has no public base URL configured, so the customer-facing page cannot be checked.",
        expected: "NEXT_PUBLIC_BASE_URL or NEXT_PUBLIC_APP_URL to be set",
        actual: "neither is set and the install is running in production mode",
      };
    }
    const url = `${ctx.baseUrl}${path}`;
    try {
      const res = await ctx.fetchImpl(url, { redirect: "follow" });
      if (res.status >= 400) {
        return {
          passed: false,
          detail: `The page a customer would open returned ${res.status}.`,
          expected: `${url} to respond with a status below 400`,
          actual: `${res.status} ${res.statusText}`,
        };
      }
      return { passed: true, detail: `${url} responded ${res.status}.` };
    } catch (err) {
      const publicError = getErrorMessage(err);
      // Could not connect at all. Ask the install about itself before calling
      // this an outage — see `loopbackOrigin`.
      const internalUrl = `${loopbackOrigin()}${path}`;
      try {
        const internal = await ctx.fetchImpl(internalUrl, { redirect: "follow" });
        if (internal.status < 400) {
          return {
            passed: false,
            detail:
              "The page works inside the install but could not be reached at its public web address. Customers on the internet would not get through.",
            expected: `${url} to be reachable from the internet`,
            actual: `${publicError} (the same page answered ${internal.status} at ${internalUrl}, so the app is running — this looks like a DNS, proxy, or certificate problem rather than an outage)`,
          };
        }
      } catch {
        // Loopback failed too — fall through to the plain outage verdict.
      }
      return {
        passed: false,
        detail: "The page a customer would open could not be reached at all.",
        expected: `${url} to respond`,
        actual: publicError,
      };
    }
  };
}

// ── contract ─────────────────────────────────────────────────────────────────

/**
 * The substrate behind the door is coherent. A pure predicate over the resolved
 * install context — no I/O, so this is the cheapest useful check there is.
 */
export function contractProbe(
  check: (ctx: JourneyProbeContext) => { ok: boolean; expected: string; actual: string },
  passDetail: string,
  failDetail: string,
) {
  return async (ctx: JourneyProbeContext): Promise<StepProbeResult> => {
    const { ok, expected, actual } = check(ctx);
    return ok
      ? { passed: true, detail: passDetail }
      : { passed: false, detail: failDetail, expected, actual };
  };
}

// ── data-path ────────────────────────────────────────────────────────────────

/**
 * Run a probe body inside a transaction that is ALWAYS rolled back.
 *
 * The body may perform real writes through the real schema; the sentinel throw
 * guarantees none of them commit. A body that itself throws is reported as a
 * failure rather than escaping — a broken journey must produce evidence, not an
 * unhandled rejection in a cron.
 */
async function inRolledBackTransaction(
  body: (tx: Prisma.TransactionClient) => Promise<StepProbeResult>,
): Promise<StepProbeResult> {
  try {
    await prisma.$transaction(async (tx) => {
      throw new RollbackSentinel(await body(tx));
    });
  } catch (err) {
    if (err instanceof RollbackSentinel) return err.result;
    return {
      passed: false,
      detail: "The journey's data path failed before it could be assessed.",
      expected: "the journey's records to be creatable against the live schema",
      actual: getErrorMessage(err),
    };
  }
  // Unreachable: the callback always throws. Kept as a typed guard rather than a
  // cast, so a future edit that stops throwing fails loudly instead of silently
  // committing a rehearsal.
  return {
    passed: false,
    detail: "The journey's data path did not roll back as required.",
    expected: "the rehearsal transaction to be rolled back",
    actual: "the transaction completed without the rollback sentinel",
  };
}

/**
 * Inquiry data path: a real `StorefrontInquiry` is created against the real
 * schema, read back, and rolled back. Catches migration drift, a broken
 * storefront foreign key, and required-column regressions — the failures that
 * silently stop enquiries reaching the owner.
 */
export async function inquiryDataPathProbe(ctx: JourneyProbeContext): Promise<StepProbeResult> {
  const storefrontId = ctx.storefrontId;
  if (!storefrontId) {
    return {
      passed: false,
      detail: "No storefront to record an enquiry against.",
      expected: "a storefront configuration",
      actual: "none found",
    };
  }
  return inRolledBackTransaction(async (tx) => {
    const ref = `INQ-WD${newId(8).toUpperCase()}`;
    const created = await tx.storefrontInquiry.create({
      data: {
        inquiryRef: ref,
        storefrontId,
        customerEmail: SYNTHETIC.email,
        customerName: SYNTHETIC.name,
        message: "Scheduled journey watchdog rehearsal. This record is never committed.",
      },
      select: { id: true, inquiryRef: true, status: true },
    });
    const readBack = await tx.storefrontInquiry.findUnique({
      where: { inquiryRef: ref },
      select: { inquiryRef: true },
    });
    if (!readBack) {
      return {
        passed: false,
        detail: "An enquiry was written but could not be read back.",
        expected: `an enquiry readable by its reference ${ref}`,
        actual: "the record was not found after creation",
      };
    }
    return {
      passed: true,
      detail: `A real enquiry record was created (${created.status}) and rolled back cleanly.`,
    };
  });
}

/**
 * Booking data path: creates a real `StorefrontBooking`, then deliberately
 * attempts an OVERLAPPING second booking and requires the database to reject it.
 *
 * The second half is the valuable half. `StorefrontBooking_no_overlap` is a gist
 * EXCLUDE constraint and is the single authoritative arbiter of slot contention
 * (EP-056D2A5E). If a migration ever drops it, bookings keep succeeding and the
 * business quietly starts double-booking customers — a failure no reachability
 * check could ever see. This probe fails loudly in that case.
 */
export async function bookingDataPathProbe(ctx: JourneyProbeContext): Promise<StepProbeResult> {
  const { storefrontId, organizationId, bookableItemId } = ctx;
  if (!storefrontId || !organizationId || !bookableItemId) {
    return {
      passed: false,
      detail: "No bookable item to rehearse a booking against.",
      expected: "a published storefront with an active bookable item",
      actual: `storefront=${storefrontId ?? "none"} item=${bookableItemId ?? "none"}`,
    };
  }
  const scheduledAt = syntheticSlot();
  return inRolledBackTransaction(async (tx) => {
    await tx.storefrontBooking.create({
      data: {
        bookingRef: `BK-WD${newId(8).toUpperCase()}`,
        organizationId,
        storefrontId,
        itemId: bookableItemId,
        customerEmail: SYNTHETIC.email,
        customerName: SYNTHETIC.name,
        scheduledAt,
        durationMinutes: 60,
        notes: "Scheduled journey watchdog rehearsal. This record is never committed.",
      },
      select: { id: true },
    });

    // Now prove double-booking is actually prevented.
    let overlapRejected = false;
    try {
      await tx.storefrontBooking.create({
        data: {
          bookingRef: `BK-WD${newId(8).toUpperCase()}`,
          organizationId,
          storefrontId,
          itemId: bookableItemId,
          customerEmail: SYNTHETIC.email,
          customerName: SYNTHETIC.name,
          // Deliberately inside the first booking's window.
          scheduledAt: new Date(scheduledAt.getTime() + 15 * 60 * 1000),
          durationMinutes: 60,
        },
        select: { id: true },
      });
    } catch (err) {
      if (isExclusionViolation(err)) overlapRejected = true;
      else throw err;
    }

    if (!overlapRejected) {
      return {
        passed: false,
        detail:
          "The database accepted two overlapping bookings — double-booking protection is not in force.",
        expected: "the no-overlap constraint to reject a second booking in the same window",
        actual: "both bookings were accepted",
      };
    }
    return {
      passed: true,
      detail:
        "A real booking was created and an overlapping one was correctly rejected; both rolled back.",
    };
  });
}

/** Exported for the no-pollution regression test. */
export const JOURNEY_SYNTHETIC_IDENTITY = SYNTHETIC;
