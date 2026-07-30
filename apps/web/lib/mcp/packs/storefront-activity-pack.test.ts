import { describe, expect, it } from "vitest";
import { rollupOrderItems, storefrontActivityPack } from "./storefront-activity-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

describe("storefront-activity pack", () => {
  it("registers list_storefront_activity as a read-only view_storefront tool", () => {
    const def = storefrontActivityPack.definitions.find(
      (d) => d.name === "list_storefront_activity",
    );
    expect(def).toBeDefined();
    expect(def!.requiredCapability).toBe("view_storefront");
    expect(def!.sideEffect).toBe(false);
    expect(storefrontActivityPack.handlers.list_storefront_activity).toBeTypeOf("function");
  });

  it("gates the tool behind storefront_read and mirrors the shared grant map", () => {
    expect(storefrontActivityPack.grants.list_storefront_activity).toEqual(["storefront_read"]);
    expect(isToolAllowedByGrants("list_storefront_activity", ["storefront_read"])).toBe(true);
    expect(isToolAllowedByGrants("list_storefront_activity", ["marketing_read"])).toBe(false);
    expect(isToolAllowedByGrants("list_storefront_activity", ["backlog_read"])).toBe(false);
  });

  it("keeps the tool description provenance-free (no BI/phase/source-path leakage)", () => {
    const def = storefrontActivityPack.definitions[0]!;
    expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
  });
});

describe("rollupOrderItems", () => {
  it("sums quantities per item across orders, best-seller first", () => {
    expect(
      rollupOrderItems([
        [{ qty: 2, name: "Margherita Pizza" }],
        [{ qty: 3, name: "Margherita Pizza" }, { qty: 1, name: "Tiramisu" }],
        [{ qty: 4, name: "Margherita Pizza" }],
        [{ qty: 2, name: "Tiramisu" }],
      ]),
    ).toEqual([
      { name: "Margherita Pizza", qty: 9 },
      { name: "Tiramisu", qty: 3 },
    ]);
  });

  it("defaults a missing quantity to 1 and skips nameless/malformed lines", () => {
    expect(
      rollupOrderItems([
        [{ name: "Caesar Salad" }],
        [{ qty: 5 }],
        "not-an-array",
        null,
        [{ qty: 2, name: "Caesar Salad" }],
      ]),
    ).toEqual([{ name: "Caesar Salad", qty: 3 }]);
  });

  it("returns empty for no usable payloads", () => {
    expect(rollupOrderItems([])).toEqual([]);
    expect(rollupOrderItems([null, undefined, {}])).toEqual([]);
  });
});
