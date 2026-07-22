// UX owner-fit checks for the Restaurant owner cockpit. Encodes the heuristic
// lenses from docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md as
// assertions: repeated generic labels, technical-detail leakage, small controls
// (Fitts-law >=44px), and route-to-route signal consistency (BI-3BCAF95F,
// BI-353610C6).

import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deriveServiceReadiness,
  BANNED_GENERIC_LABELS,
  BUILDER_TOKENS,
  type ServiceReadinessInput,
  type ReadinessVocabulary,
} from "./service-readiness";
import { ServiceReadinessCockpit } from "@/components/restaurant-cockpit/ServiceReadinessCockpit";

// next/link → plain anchor that forwards href + children (and any rest props).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const VOCAB: ReadinessVocabulary = {
  inboxLabel: "Reservations",
  stakeholderLabel: "Guests",
  teamLabel: "Staff",
  portalLabel: "Venue Portal",
  resourceLabel: "Tables & capacity",
};

// A deliberately busy input so every signal + the next action are populated.
const BUSY: ServiceReadinessInput = {
  vocabulary: VOCAB,
  demand: { pendingInquiries: 2, unconfirmedBookings: 3 },
  serviceLoad: { confirmedUpcoming: 5, scheduledToday: 4 },
  resources: { count: 8, operatingHoursConfigured: true },
  staffing: { rostered: 0 },
  finance: { billsDue: 1, overdueInvoices: 2 },
};

describe("cockpit UX — repeated generic labels", () => {
  it("renders no banned generic decision label", () => {
    const html = renderToStaticMarkup(
      <ServiceReadinessCockpit summary={deriveServiceReadiness(BUSY)} />,
    );
    for (const banned of BANNED_GENERIC_LABELS) {
      expect(html).not.toContain(banned);
    }
  });

  it("gives every signal a unique owner-facing label", () => {
    const s = deriveServiceReadiness(BUSY);
    const labels = s.signals.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("cockpit UX — technical-detail leakage", () => {
  it("hides the technical block and its figures in Simple mode", () => {
    const summary = deriveServiceReadiness(BUSY);
    const html = renderToStaticMarkup(
      <ServiceReadinessCockpit summary={summary} simple />,
    );
    expect(html).not.toContain("Behind the numbers");
    for (const t of summary.technical) {
      expect(html).not.toContain(t.label);
    }
    for (const token of BUILDER_TOKENS) {
      expect(html).not.toContain(token);
    }
  });

  it("keeps the technical block available in Full mode (progressive disclosure)", () => {
    const html = renderToStaticMarkup(
      <ServiceReadinessCockpit summary={deriveServiceReadiness(BUSY)} />,
    );
    expect(html).toContain("Behind the numbers");
    expect(html).toContain("<details");
  });
});

describe("cockpit UX — small controls (Fitts-law >=44px)", () => {
  it("renders the primary next-action control at >=44px tap size", () => {
    const html = renderToStaticMarkup(
      <ServiceReadinessCockpit summary={deriveServiceReadiness(BUSY)} />,
    );
    expect(html).toMatch(/min-height:44px/);
    expect(html).toMatch(/min-width:44px/);
  });
});

describe("cockpit UX — route-to-route signal consistency", () => {
  it("reports demand counts that match the source booking/inquiry inputs", () => {
    const s = deriveServiceReadiness(BUSY);
    const tech = Object.fromEntries(s.technical.map((t) => [t.label, t.value]));
    // The cockpit must not drift from the /storefront/inbox source counts.
    expect(tech["Unconfirmed bookings"]).toBe(String(BUSY.demand.unconfirmedBookings));
    expect(tech["Pending inquiries"]).toBe(String(BUSY.demand.pendingInquiries));
  });

  it("routes every signal to a real owner surface", () => {
    const s = deriveServiceReadiness(BUSY);
    for (const sig of s.signals) {
      expect(sig.href).toMatch(/^\/(storefront|finance|employee)/);
    }
    expect(s.nextAction?.href).toMatch(/^\/(storefront|finance|employee)/);
  });
});
