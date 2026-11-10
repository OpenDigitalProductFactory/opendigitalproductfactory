import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ALL_ARCHETYPES, deriveTwinProfile } from "@dpf/storefront-templates";

import { buildDemoTwinSnapshot } from "@/lib/twin/demo-twin-snapshot";
import { TwinView } from "./TwinView";
import { projectCustomerOperations } from "@dpf/storefront-templates/operations";
import { DPF_CUSTOMER_RECORD_LINKS, loadCustomerOperatingFacts } from "@/lib/twin/customer-operations-loader";

const byCategory = (category: string) => ALL_ARCHETYPES.find((a) => a.category === category)!;

describe("buildDemoTwinSnapshot — totality + determinism", () => {
  it("produces a renderable snapshot for EVERY seeded archetype", () => {
    for (const a of ALL_ARCHETYPES) {
      const profile = deriveTwinProfile(a);
      const snap = buildDemoTwinSnapshot(profile);
      expect(snap.capacityChips.length, `${a.archetypeId} chips`).toBeGreaterThan(0);
      expect(snap.zones.length, `${a.archetypeId} zones`).toBe(profile.zones.length);
      expect(snap.queues.length, `${a.archetypeId} queues`).toBe(profile.queues.length);
      // every zone binds to a real profile zone key
      const zoneKeys = new Set(profile.zones.map((z) => z.key));
      for (const zs of snap.zones) expect(zoneKeys.has(zs.key), `${a.archetypeId} zone ${zs.key}`).toBe(true);
      expect(snap.utility.length).toBeGreaterThan(0);
      expect(snap.presence.some((p) => p.kind === "ai"), `${a.archetypeId} has an AI coworker`).toBe(true);
    }
  });

  it("is deterministic (same profile → identical snapshot)", () => {
    const profile = deriveTwinProfile(byCategory("food-hospitality"));
    expect(buildDemoTwinSnapshot(profile)).toEqual(buildDemoTwinSnapshot(profile));
  });
});

describe("TwinView — one renderer, both lenses", () => {
  it("labels a healthy account's upcoming renewal as attention without inventing risk", () => {
    const profile = deriveTwinProfile(byCategory("software-platform"));
    const snapshot = projectCustomerOperations({
      accounts: [{ id: "healthy-account", name: "Healthy customer", status: "active" }],
      commitments: [{ id: "upcoming-renewal", accountId: "healthy-account", status: "active", renewalAt: "2026-10-25T00:00:00Z", autoRenew: true }],
      serviceWork: [],
    }, new Date("2026-10-20T00:00:00Z"), DPF_CUSTOMER_RECORD_LINKS);
    const html = renderToStaticMarkup(<TwinView profile={profile} snapshot={snapshot} />);
    expect(snapshot.queues.find((queue) => queue.key === "renewals")?.items).toHaveLength(1);
    expect(html).toMatch(/<h4[^>]*>Renewal attention<\/h4>/);
    expect(html).toContain("Healthy customer");
    expect(html).not.toContain("Renewals at risk");
  });
  it("renders actual host-shaped customer work, record links and commitments with bounded density", async () => {
    const profile = deriveTwinProfile(byCategory("software-platform"));
    const facts = await loadCustomerOperatingFacts({
      viewer: { platformRole: "HR-000", isSuperuser: false },
      runtime: { read: async (_source, operation) => operation, unavailable: () => undefined },
      db: {
        customerAccount: { findMany: async () => Array.from({ length: 20 }, (_, i) => ({ id: `account-${i}`, name: `Synthetic customer ${i}`, status: "at_risk" })) },
        subscription: { findMany: async () => [{ id: "renewal-1", accountId: "account-0", status: "active", autoRenew: false, renewalDate: new Date("2026-10-25") }] },
        serviceTicket: { findMany: async () => [{ id: "work-1", customerAccountId: "account-0", title: "Restore customer report", ticketId: "TKT-1", status: "waiting-customer", priority: "high", slaDueAt: new Date("2026-10-19"), ownerPrincipalId: "principal-actual", description: "PRIVATE DETAILS" }] },
      },
    });
    const snapshot = projectCustomerOperations(facts, new Date("2026-10-20"), DPF_CUSTOMER_RECORD_LINKS);
    const html = renderToStaticMarkup(<TwinView profile={profile} snapshot={snapshot} />);
    expect(html).toContain("Restore customer report"); expect(html).toContain("principal-actual"); expect(html).toContain("Priority: high"); expect(html).toContain("Manual renewal");
    expect(html).toContain("Overdue SLA"); expect(html).toContain("Waiting for customer");
    expect(html).toContain("<ol"); expect(html).toContain("<li"); expect(html).toContain("<h4");
    expect(snapshot.zones[0].units).toHaveLength(12); expect(html).not.toContain("Synthetic customer 19");
    expect(html).not.toContain("Confirm assignment"); expect(html).not.toContain("PRIVATE DETAILS");
    expect(html).toContain('href="/platform/service-desk"'); expect(html).toContain('href="/customer/account-0"');
  });
  it("renders a physical FLOOR twin with its profile vocabulary and queues", () => {
    const profile = deriveTwinProfile(byCategory("food-hospitality"));
    expect(profile.template).toBe("FLOOR");
    const html = renderToStaticMarkup(
      <TwinView profile={profile} snapshot={buildDemoTwinSnapshot(profile)} />,
    );
    // zone label from the profile grammar
    expect(html).toContain("Dining room");
    // queue label from the profile grammar
    expect(html).toContain("Waitlist");
    // the shared utility band
    expect(html).toContain("Bills due");
    // the cog proposal references the profile's resource noun
    expect(html).toContain(profile.resourceNoun.singular);
  });

  it("renders a non-physical TENANTS board from the same component", () => {
    const profile = deriveTwinProfile(byCategory("software-platform"));
    expect(profile.template).toBe("TENANTS");
    expect(profile.physical).toBe(false);
    const html = renderToStaticMarkup(
      <TwinView profile={profile} snapshot={buildDemoTwinSnapshot(profile)} />,
    );
    expect(html).toContain("Account health board");
    expect(html).toContain("Renewal attention");
    // still shows the needs-you + activity surfaces
    expect(html).toContain("Needs you");
    expect(html).toContain("Activity");
  });

  it("uses the shared physical-scene slot instead of rendering a duplicate resource grid", () => {
    const profile = deriveTwinProfile(byCategory("food-hospitality"));
    const snapshot = buildDemoTwinSnapshot(profile);
    const hiddenGridLabel = snapshot.zones[0]?.units[0]?.label;
    const html = renderToStaticMarkup(
      <TwinView
        profile={profile}
        snapshot={snapshot}
        physicalScene={<div>Authored restaurant floor</div>}
      />,
    );

    expect(html).toContain("Authored restaurant floor");
    if (hiddenGridLabel) expect(html).not.toContain(hiddenGridLabel);
    expect(html).toContain("Waitlist");
  });
});
