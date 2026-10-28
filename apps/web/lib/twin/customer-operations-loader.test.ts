import { describe, expect, it, vi } from "vitest";
import { loadCustomerOperatingFacts } from "./customer-operations-loader";
import { createOperationsLoadRuntime } from "./operations-load-runtime";
import { loadVersionedOperationsSnapshot } from "./operations-loader";
import { ALL_ARCHETYPES, deriveTwinProfile } from "@dpf/storefront-templates";

const customer = { id: "account-1", name: "Synthetic customer", status: "at_risk" };
const manager = { platformRole: "HR-000", isSuperuser: false };
function fixture() {
  return {
    customerAccount: { findMany: vi.fn(async () => [customer]) },
    subscription: { findMany: vi.fn(async () => [{ id: "sub-1", accountId: customer.id, status: "active", renewalDate: new Date("2026-10-25"), autoRenew: false }]) },
    serviceTicket: { findMany: vi.fn(async () => [{ id: "ticket-1", ticketId: "TKT-1", customerAccountId: customer.id, title: "Restore delivery", status: "open", priority: "high", slaDueAt: new Date("2026-10-19"), ownerPrincipalId: "principal-1", description: "PRIVATE DETAIL", customerEmail: "secret@example.test" }]) },
  };
}
function runtime(client: object) { return createOperationsLoadRuntime({ client, observedAt: "2026-10-20T12:00:00Z", clock: () => 0 }); }
describe("customer operating host authority", () => {
  it.each([undefined, { platformRole: "HR-600", isSuperuser: false }])("does not query customer sources without current authority %j", async (viewer) => {
    const db = fixture(); const rt = runtime(db);
    expect(await loadCustomerOperatingFacts({ db, runtime: rt, viewer })).toEqual({ accounts: null, commitments: null, serviceWork: null });
    expect(db.customerAccount.findMany).not.toHaveBeenCalled(); expect(db.subscription.findMany).not.toHaveBeenCalled(); expect(db.serviceTicket.findMany).not.toHaveBeenCalled();
    expect(rt.complete().degradedSources).toHaveLength(3);
  });
  it("requires the existing service desk permission separately from customer viewing", async () => {
    const db = fixture();
    const facts = await loadCustomerOperatingFacts({ db, runtime: runtime(db), viewer: { platformRole: "HR-200", isSuperuser: false } });
    expect(facts.accounts).toEqual([customer]); expect(facts.commitments).toHaveLength(1);
    expect(facts.serviceWork).toBeNull(); expect(db.serviceTicket.findMany).not.toHaveBeenCalled();
  });
  it("uses canonical tombstones, bounded allow-listed fields and account-scoped commitments/work", async () => {
    const db = fixture(); const facts = await loadCustomerOperatingFacts({ db, runtime: runtime(db), viewer: manager });
    expect(db.customerAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { notIn: ["superseded", "archived"] }, mergedIntoId: null }, take: 65 }));
    expect(db.serviceTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerAccountId: { in: [customer.id] }, status: { notIn: ["resolved", "closed"] } } }));
    expect(facts.serviceWork?.[0]).toMatchObject({ ownerRef: "principal-1", dueAt: "2026-10-19T00:00:00.000Z" });
    expect(JSON.stringify(facts)).not.toContain("PRIVATE DETAIL"); expect(JSON.stringify(facts)).not.toContain("secret@example");
  });
  it("keeps an over-limit customer source unknown and skips dependent reads", async () => {
    const db = fixture(); db.customerAccount.findMany.mockResolvedValue(Array.from({ length: 65 }, (_, i) => ({ ...customer, id: String(i) })));
    const facts = await loadCustomerOperatingFacts({ db, runtime: runtime(db), viewer: manager });
    expect(facts.accounts).toBeNull(); expect(db.subscription.findMany).not.toHaveBeenCalled(); expect(db.serviceTicket.findMany).not.toHaveBeenCalled();
  });
  it("contains private source failures and distinguishes a verified empty source", async () => {
    const db = fixture(); db.serviceTicket.findMany.mockRejectedValue(new Error("postgres://secret"));
    const rt = runtime(db); const facts = await loadCustomerOperatingFacts({ db, runtime: rt, viewer: manager });
    expect(facts.serviceWork).toBeNull(); expect(JSON.stringify(rt.complete())).not.toContain("secret");
    db.customerAccount.findMany.mockResolvedValue([]);
    expect((await loadCustomerOperatingFacts({ db, runtime: runtime(db), viewer: manager })).accounts).toEqual([]);
  });
  it("serves the actual TENANTS snapshot path without booking/provider substitution", async () => {
    const archetype = ALL_ARCHETYPES.find((a) => deriveTwinProfile(a).template === "TENANTS")!;
    const db = { ...fixture(), storefrontConfig: { findFirst: async () => ({ id: "sf-1", organizationId: "org-1", timezone: "UTC", archetype: { archetypeId: archetype.archetypeId, name: archetype.name } }) }, storefrontBooking: { findMany: vi.fn(async () => { throw new Error("must not query bookings"); }) } };
    const snapshot = await loadVersionedOperationsSnapshot({ db: db as never, viewer: manager, now: new Date("2026-10-20T12:00:00Z") });
    expect(snapshot?.scene.zones[0]?.units[0]).toMatchObject({ key: customer.id, label: customer.name });
    expect(snapshot?.scene.workItems[0]).toMatchObject({ key: "ticket-1", ownerRef: "principal-1" });
    expect(snapshot?.freshness).toBe("current"); expect(db.storefrontBooking.findMany).not.toHaveBeenCalled();
  });
});
