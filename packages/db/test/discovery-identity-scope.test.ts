import { describe, expect, it } from "vitest";

import { buildInventoryEntityKey } from "../src/discovery-identity";

describe("buildInventoryEntityKey with scope", () => {
  it("prefixes inventory keys with scope when a scopeKey is supplied", () => {
    expect(
      buildInventoryEntityKey({
        scopeKey: "customer:cust_a:site:site_austin",
        entityType: "host",
        naturalKey: "arp:192.168.1.1",
      }),
    ).toBe("customer:cust_a:site:site_austin:host:arp:192.168.1.1");
  });

  it("stays backward compatible when no scopeKey is supplied", () => {
    expect(buildInventoryEntityKey({ entityType: "host", naturalKey: "arp:192.168.1.1" })).toBe(
      "host:arp:192.168.1.1",
    );
    expect(
      buildInventoryEntityKey({
        scopeKey: null,
        entityType: "host",
        naturalKey: "arp:192.168.1.1",
      }),
    ).toBe("host:arp:192.168.1.1");
  });

  it("normalizes whitespace inside the scopeKey", () => {
    expect(
      buildInventoryEntityKey({
        scopeKey: "customer:cust a:site:site austin",
        entityType: "host",
        naturalKey: "arp:192.168.1.1",
      }),
    ).toBe("customer:cust_a:site:site_austin:host:arp:192.168.1.1");
  });
});
