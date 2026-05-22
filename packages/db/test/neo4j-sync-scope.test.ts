import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runCypherMock } = vi.hoisted(() => ({ runCypherMock: vi.fn() }));

vi.mock("../src/neo4j", () => ({
  runCypher: runCypherMock,
}));

import { syncInventoryEntityAsInfraCI } from "../src/neo4j-sync";

beforeEach(() => {
  runCypherMock.mockReset();
  runCypherMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

    const call = runCypherMock.mock.calls.find(([cypher]) =>
      typeof cypher === "string" && cypher.includes("MERGE (ci:InfraCI"),
    );
    expect(call).toBeDefined();
    const [cypherText, params] = call as [string, Record<string, unknown>];
    expect(cypherText).toContain("ci.scopeKey = $scopeKey");
    expect(cypherText).toContain("ci.customerAccountId = $customerAccountId");
    expect(cypherText).toContain("ci.customerSiteId = $customerSiteId");
    expect(params).toMatchObject({
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

    const call = runCypherMock.mock.calls.find(([cypher]) =>
      typeof cypher === "string" && cypher.includes("MERGE (ci:InfraCI"),
    );
    expect(call).toBeDefined();
    const [cypherText, params] = call as [string, Record<string, unknown>];
    expect(cypherText).not.toContain("ci.scopeKey = $scopeKey");
    expect(params).not.toHaveProperty("scopeKey");
  });
});
