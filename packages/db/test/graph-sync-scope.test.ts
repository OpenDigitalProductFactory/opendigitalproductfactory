import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BET-5: syncInventoryEntityAsInfraCI now UPSERTs the InfraCI node into the
// Postgres graph mirror via prisma.$executeRawUnsafe. Mock the client seam and
// assert the customer-scope fields land in the node props JSON.
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));

vi.mock("../src/client", () => ({
  prisma: {
    $executeRawUnsafe: execMock,
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    taxonomyNode: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { syncInventoryEntityAsInfraCI } from "../src/graph-sync";

beforeEach(() => {
  execMock.mockReset();
  execMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Find the InfraCI node upsert and parse its props JSON. */
function findNodeUpsert() {
  const call = execMock.mock.calls.find(
    ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO graph_node"),
  );
  expect(call).toBeDefined();
  const [, key, labels, propsJson] = call as [string, string, string[], string];
  return { key, labels, props: JSON.parse(propsJson) as Record<string, unknown> };
}

describe("syncInventoryEntityAsInfraCI customer scope projection", () => {
  it("projects scopeKey, customerAccountId, and customerSiteId onto InfraCI nodes", async () => {
    await syncInventoryEntityAsInfraCI({
      entityKey: "customer:cust_a:site:site_austin:host:arp:192.168.1.1",
      name: "Default Gateway",
      entityType: "gateway",
      status: "active",
      properties: {
        scopeKey: "customer:cust_a:site:site_austin",
        customerAccountId: "cust_a",
        customerSiteId: "site_austin",
      },
    });

    const { key, labels, props } = findNodeUpsert();
    expect(labels).toContain("InfraCI");
    expect(key).toBe("customer:cust_a:site:site_austin:host:arp:192.168.1.1");
    expect(props).toMatchObject({
      ciId: "customer:cust_a:site:site_austin:host:arp:192.168.1.1",
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    });
  });

  it("does not project scope fields when properties carry none", async () => {
    await syncInventoryEntityAsInfraCI({
      entityKey: "host:arp:10.0.0.5",
      name: "Internal host",
      entityType: "host",
      status: "active",
      properties: {},
    });

    const { props } = findNodeUpsert();
    expect(props).not.toHaveProperty("scopeKey");
  });
});
