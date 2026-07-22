import { describe, it, expect } from "vitest";
import {
  deriveServiceReadiness,
  BANNED_GENERIC_LABELS,
  type ServiceReadinessInput,
  type ReadinessVocabulary,
} from "./service-readiness";

const RESTAURANT_VOCAB: ReadinessVocabulary = {
  inboxLabel: "Reservations",
  stakeholderLabel: "Guests",
  teamLabel: "Staff",
  portalLabel: "Venue Portal",
  resourceLabel: "Tables & capacity",
};

function input(overrides: Partial<ServiceReadinessInput> = {}): ServiceReadinessInput {
  return {
    vocabulary: RESTAURANT_VOCAB,
    demand: { pendingInquiries: 0, unconfirmedBookings: 0 },
    serviceLoad: { confirmedUpcoming: 0, scheduledToday: 0 },
    resources: { count: 8, operatingHoursConfigured: true },
    staffing: { rostered: 5 },
    finance: { billsDue: 0, overdueInvoices: 0 },
    ...overrides,
  };
}

describe("deriveServiceReadiness", () => {
  it("reports ready with no next action when everything is set up and quiet", () => {
    const s = deriveServiceReadiness(input());
    expect(s.level).toBe("ready");
    expect(s.needsYouCount).toBe(0);
    expect(s.nextAction).toBeNull();
    expect(s.headline).toMatch(/ready/i);
    expect(s.signals).toHaveLength(5);
  });

  it("always emits the five owner signal groups in order", () => {
    const s = deriveServiceReadiness(input());
    expect(s.signals.map((x) => x.key)).toEqual([
      "demand",
      "service-load",
      "tables",
      "staffing",
      "finance",
    ]);
  });

  it("leads with confirming reservations when bookings are unconfirmed", () => {
    const s = deriveServiceReadiness(
      input({ demand: { pendingInquiries: 2, unconfirmedBookings: 3 } }),
    );
    expect(s.level).toBe("attention");
    expect(s.needsYouCount).toBeGreaterThanOrEqual(1);
    expect(s.nextAction?.label).toContain("Confirm");
    expect(s.nextAction?.label.toLowerCase()).toContain("reservation");
    expect(s.nextAction?.href).toBe("/storefront/inbox");
  });

  it("uses injected vocabulary, never a hardcoded archetype noun", () => {
    const s = deriveServiceReadiness(
      input({
        vocabulary: {
          inboxLabel: "Appointments",
          stakeholderLabel: "Patients",
          teamLabel: "Practitioners",
          portalLabel: "Patient Portal",
          resourceLabel: "Rooms",
        },
        demand: { pendingInquiries: 0, unconfirmedBookings: 1 },
      }),
    );
    expect(s.nextAction?.label.toLowerCase()).toContain("appointment");
    expect(s.signals[0].label.toLowerCase()).toContain("appointment");
    // No leaked restaurant noun.
    expect(JSON.stringify(s).toLowerCase()).not.toContain("reservation");
  });

  it("prioritises overdue invoices over bills, and bills over enquiries", () => {
    const overdue = deriveServiceReadiness(
      input({
        demand: { pendingInquiries: 4, unconfirmedBookings: 0 },
        finance: { billsDue: 2, overdueInvoices: 1 },
      }),
    );
    expect(overdue.nextAction?.label).toContain("overdue");

    const bills = deriveServiceReadiness(
      input({
        demand: { pendingInquiries: 4, unconfirmedBookings: 0 },
        finance: { billsDue: 2, overdueInvoices: 0 },
      }),
    );
    expect(bills.nextAction?.label).toContain("supplier bill");

    const enquiries = deriveServiceReadiness(
      input({ demand: { pendingInquiries: 4, unconfirmedBookings: 0 } }),
    );
    expect(enquiries.nextAction?.label).toContain("enquir");
  });

  it("blocks tables when no resources are set up, and routes setup to hours when missing", () => {
    const noResources = deriveServiceReadiness(
      input({ resources: { count: 0, operatingHoursConfigured: false } }),
    );
    const tables = noResources.signals.find((x) => x.key === "tables")!;
    expect(tables.level).toBe("blocked");
    expect(noResources.level).toBe("blocked");

    const hoursMissing = deriveServiceReadiness(
      input({ resources: { count: 6, operatingHoursConfigured: false } }),
    );
    const t2 = hoursMissing.signals.find((x) => x.key === "tables")!;
    expect(t2.level).toBe("attention");
    expect(t2.href).toBe("/storefront/settings/operations");
  });

  it("flags staffing attention when nobody is rostered", () => {
    const s = deriveServiceReadiness(input({ staffing: { rostered: 0 } }));
    const staffing = s.signals.find((x) => x.key === "staffing")!;
    expect(staffing.level).toBe("attention");
    expect(staffing.summary.toLowerCase()).toContain("no staff");
  });

  it("never renders a banned generic decision label in owner-facing copy", () => {
    const s = deriveServiceReadiness(
      input({
        demand: { pendingInquiries: 3, unconfirmedBookings: 2 },
        finance: { billsDue: 1, overdueInvoices: 1 },
        staffing: { rostered: 0 },
      }),
    );
    const ownerText = [
      s.headline,
      s.nextAction?.label ?? "",
      s.nextAction?.why ?? "",
      ...s.signals.flatMap((x) => [x.label, x.summary, x.detail ?? "", x.actionLabel ?? ""]),
    ].join(" | ");
    for (const banned of BANNED_GENERIC_LABELS) {
      expect(ownerText).not.toContain(banned);
    }
  });

  it("keeps the same summary for the same input (pure/deterministic)", () => {
    const i = input({ demand: { pendingInquiries: 1, unconfirmedBookings: 1 } });
    expect(deriveServiceReadiness(i)).toEqual(deriveServiceReadiness(i));
  });
});
