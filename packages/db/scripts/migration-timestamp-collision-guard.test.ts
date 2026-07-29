import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs guard, no types
import {
  findCollisions,
  HISTORICAL_COLLISION_RESTORATIONS,
} from "./migration-timestamp-collision-guard.mjs";

const newSet = (...dirs: string[]) => new Set(dirs);

describe("migration-timestamp-collision-guard", () => {
  it("FLAGS a new migration colliding with an EXISTING one (the BI-BFDCE0A9 case)", () => {
    const all = [
      "20260706070000_add_opportunity_next_activity",
      "20260706080000_add_mdm_steward_substrate", // pre-existing
      "20260706080000_add_quote_accept_token", // new, same timestamp
    ];
    const f = findCollisions(all, newSet("20260706080000_add_quote_accept_token"));
    expect(f).toHaveLength(1);
    expect(f[0].dir).toBe("20260706080000_add_quote_accept_token");
    expect(f[0].timestamp).toBe("20260706080000");
    expect(f[0].collidesWith).toEqual(["20260706080000_add_mdm_steward_substrate"]);
  });

  it("FLAGS both when two NEW migrations collide with each other", () => {
    const all = [
      "20260707120000_add_alpha",
      "20260707120000_add_beta",
    ];
    const f = findCollisions(all, newSet("20260707120000_add_alpha", "20260707120000_add_beta"));
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.dir).sort()).toEqual([
      "20260707120000_add_alpha",
      "20260707120000_add_beta",
    ]);
  });

  it("does NOT flag the 19 legacy collisions — pre-existing pairs are never 'new'", () => {
    // Both share a timestamp but neither is new → self-baselined.
    const all = [
      "20260704120000_add_mdm_normalized_columns_and_trgm",
      "20260704120000_add_subscription_support_contract",
    ];
    expect(findCollisions(all, newSet())).toHaveLength(0);
  });

  it("PASSES a new migration with a unique timestamp", () => {
    const all = [
      "20260706080000_add_mdm_steward_substrate",
      "20260706080000_add_quote_accept_token",
      "20260707120000_add_fresh_thing", // new, unique
    ];
    expect(findCollisions(all, newSet("20260707120000_add_fresh_thing"))).toHaveLength(0);
  });

  it("reports every colliding sibling, sorted, for a triple collision", () => {
    const all = [
      "20260708090000_add_one", // existing
      "20260708090000_add_two", // existing
      "20260708090000_add_three", // new
    ];
    const f = findCollisions(all, newSet("20260708090000_add_three"));
    expect(f).toHaveLength(1);
    expect(f[0].collidesWith).toEqual([
      "20260708090000_add_one",
      "20260708090000_add_two",
    ]);
  });

  it("ignores dirs without a 14-digit timestamp prefix", () => {
    const all = ["migration_lock.toml_notadir", "20260707120000_add_alpha"];
    expect(findCollisions(all, newSet("20260707120000_add_alpha"))).toHaveLength(0);
  });

  it("allows the exact historical inventory repair restoration", () => {
    const restored = "20260728120000_repair_inventory_entity_index_integrity";
    const all = [
      "20260728120000_add_business_product_hierarchy",
      restored,
    ];
    const checksums = new Map([
      [restored, HISTORICAL_COLLISION_RESTORATIONS[restored]],
    ]);
    expect(findCollisions(all, newSet(restored), checksums)).toHaveLength(0);
  });

  it("rejects any byte drift in the historical restoration", () => {
    const restored = "20260728120000_repair_inventory_entity_index_integrity";
    const all = [
      "20260728120000_add_business_product_hierarchy",
      restored,
    ];
    const findings = findCollisions(
      all,
      newSet(restored),
      new Map([[restored, "0".repeat(64)]]),
    );
    expect(findings).toHaveLength(1);
  });
});
