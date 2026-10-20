import { describe, expect, it } from "vitest";
import { projectCustomerOperations, type CustomerOperatingFacts } from "./customer.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const facts: CustomerOperatingFacts = {
  accounts: [{ id: "customer-1", name: "Synthetic customer", status: "at_risk" }],
  commitments: [{ id: "commitment-1", accountId: "customer-1", status: "active", renewalAt: "2026-10-25T12:00:00Z", autoRenew: false }],
  serviceWork: [{ id: "ticket-1", reference: "TKT-1", accountId: "customer-1", title: "Restore report delivery", status: "waiting-customer", priority: "high", dueAt: "2026-10-20T11:00:00Z", owner: { name: "Case owner", kind: "human" }, ownerRef: "principal-1" }],
};
describe("customer operating projection", () => {
  it("uses the consumer's exact record-link adapter", () => {
    const result = projectCustomerOperations(facts, NOW, { account: (id) => ({ label: "Inspect account", href: `/consumer/accounts/${id}` }), serviceWork: (id) => ({ label: "Inspect work", href: `/consumer/work/${id}` }) });
    expect(result.zones[0].units[0].action?.href).toBe("/consumer/accounts/customer-1"); expect(result.workItems[0].action?.href).toBe("/consumer/work/ticket-1");
  });
  it("does not invent application routes without consumer-owned record links", () => {
    const result = projectCustomerOperations(facts, NOW);
    expect(result.zones[0].units[0].action).toBeUndefined(); expect(result.workItems[0].action).toBeUndefined();
    expect(result.queues.flatMap((q) => q.items).every((item) => item.action === undefined)).toBe(true);
  });
  it("calls overdue and unknown-date commitments renewal attention", () => {
    const result = projectCustomerOperations({ ...facts, commitments: [{ ...facts.commitments![0], id: "overdue", renewalAt: "2026-01-01" }, { ...facts.commitments![0], id: "unknown", renewalAt: "invalid" }] }, NOW);
    expect(result.capacityChips.find((c) => c.key === "renewals")?.label).toBe("Renewal attention");
    expect(result.queues[0].items).toHaveLength(2); expect(result.queues[0].items.find((c) => c.key === "unknown")?.meta).toContain("date unavailable");
  });
  it("cannot call dependent work empty when its authorized customer source is unavailable", () => {
    const result = projectCustomerOperations({ accounts: null, commitments: [], serviceWork: [] }, NOW);
    expect(result.queues.find((q) => q.key === "ctas")?.emptyLabel).toContain("unavailable");
  });
  it("shows stored risk, a real renewal commitment and owned overdue work", () => {
    const result = projectCustomerOperations(facts, NOW);
    expect(result.zones[0]?.units[0]).toMatchObject({ key: "customer-1", state: "At risk" });
    expect(result.queues.find((q) => q.key === "renewals")?.items[0]).toMatchObject({ key: "commitment-1", label: "Synthetic customer", meta: expect.stringContaining("Manual renewal") });
    expect(result.workItems[0]).toMatchObject({ key: "ticket-1", owner: { name: "Case owner", kind: "human" }, blockedOnExternal: true, sublabel: expect.stringContaining("Overdue") });
  });
  it("keeps unavailable sources distinct from a verified empty book", () => {
    const unavailable = projectCustomerOperations({ accounts: null, commitments: null, serviceWork: null }, NOW);
    const empty = projectCustomerOperations({ accounts: [], commitments: [], serviceWork: [] }, NOW);
    expect(unavailable.capacityChips[0]?.value).toBe("Unavailable");
    expect(empty.capacityChips[0]?.value).toBe(0);
    expect(unavailable.queues[0]?.emptyLabel).toContain("unavailable");
  });
  it("ignores relationships outside the authorized account set and closed work", () => {
    const result = projectCustomerOperations({ ...facts, serviceWork: [...facts.serviceWork!, { ...facts.serviceWork![0], id: "private", accountId: "other-customer", title: "Secret account" }, { ...facts.serviceWork![0], id: "closed", status: "closed" }], commitments: [...facts.commitments!, { ...facts.commitments![0], id: "private-renewal", accountId: "other-customer" }] }, NOW);
    expect(result.workItems.map((w) => w.key)).toEqual(["ticket-1"]);
    expect(JSON.stringify(result)).not.toContain("Secret account");
    expect(JSON.stringify(result)).not.toContain("private-renewal");
  });
  it("never treats a paid invoice as completed delivery", () => {
    expect(projectCustomerOperations(facts, NOW).outcomes).toBeUndefined();
  });
});
