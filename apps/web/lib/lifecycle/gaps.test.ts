import { describe, it, expect } from "vitest";
import { reconcileGaps, buildGapKey, type ExistingGap, type LifecycleGapInput } from "./gaps";
import { generateTechnologyCurrencyGaps, type CurrencyMember } from "./gap-generators/technology-currency";
import { resolveLifecycle } from "../lifecycle";

function gapInput(over: Partial<LifecycleGapInput> & Pick<LifecycleGapInput, "gapKey">): LifecycleGapInput {
  return {
    kind: "change",
    dimension: "technology-currency",
    severity: "medium",
    scopeLevel: "portfolio",
    governedThingKind: "InventoryEntity",
    governedThingId: "x",
    title: "t",
    ...over,
  };
}

describe("buildGapKey", () => {
  it("is stable and one-per-thing without signalId", () => {
    const k = buildGapKey({ dimension: "technology-currency", ref: { kind: "InventoryEntity", id: "srv-1" } });
    expect(k).toBe("technology-currency:InventoryEntity:srv-1");
  });
  it("distinguishes multiple signals on one thing", () => {
    const k = buildGapKey({ dimension: "vulnerability", ref: { kind: "InventoryEntity", id: "srv-1" }, signalId: "CVE-2026-1" });
    expect(k).toBe("vulnerability:InventoryEntity:srv-1:CVE-2026-1");
  });
});

describe("reconcileGaps", () => {
  it("creates gaps that don't exist yet", () => {
    const plan = reconcileGaps([gapInput({ gapKey: "g1" })], []);
    expect(plan.summary.created).toBe(1);
    expect(plan.material).toBe(true);
  });

  it("is idempotent for identical gaps", () => {
    const existing: ExistingGap[] = [{ id: "e1", gapKey: "g1", status: "open", severity: "medium", title: "t", detail: null }];
    const plan = reconcileGaps([gapInput({ gapKey: "g1" })], existing);
    expect(plan.material).toBe(false);
    expect(plan.summary.unchanged).toBe(1);
  });

  it("updates when severity escalates", () => {
    const existing: ExistingGap[] = [{ id: "e1", gapKey: "g1", status: "open", severity: "medium", title: "t", detail: null }];
    const plan = reconcileGaps([gapInput({ gapKey: "g1", severity: "critical" })], existing);
    expect(plan.summary.updated).toBe(1);
    expect(plan.ops[0]).toMatchObject({ op: "update", id: "e1" });
  });

  it("resolves gaps no longer generated (signal cleared)", () => {
    const existing: ExistingGap[] = [{ id: "e1", gapKey: "g1", status: "open", severity: "medium", title: "t", detail: null }];
    const plan = reconcileGaps([], existing);
    expect(plan.summary.resolved).toBe(1);
    expect(plan.ops[0]).toMatchObject({ op: "resolve", gapKey: "g1" });
  });

  it("resolves a scoped gap whose signal cleared (gap never blocks on work status)", () => {
    const existing: ExistingGap[] = [{ id: "e1", gapKey: "g1", status: "scoped", severity: "high", title: "t", detail: null }];
    const plan = reconcileGaps([], existing);
    expect(plan.summary.resolved).toBe(1);
  });
});

describe("generateTechnologyCurrencyGaps", () => {
  function member(id: string, supportStatus: string, supportEndsAt?: string): CurrencyMember {
    return {
      kind: "InventoryEntity",
      id,
      name: `host-${id}`,
      canonical: resolveLifecycle({ kind: "InventoryEntity", status: "active", supportStatus, supportEndsAt, now: new Date("2026-06-07T00:00:00Z") }),
      evidenceRef: "discovery-run:R1",
    };
  }

  it("raises no gap for current/unknown things", () => {
    expect(generateTechnologyCurrencyGaps([member("a", "supported"), member("b", "unknown")])).toHaveLength(0);
  });

  it("maps currency to severity", () => {
    const gaps = generateTechnologyCurrencyGaps([
      member("a", "deprecated"), // approaching-eol → medium
      member("b", "unsupported"), // high
      member("c", "end-of-life"), // critical
    ]);
    expect(gaps.map((g) => g.severity).sort()).toEqual(["critical", "high", "medium"]);
    for (const g of gaps) {
      expect(g.dimension).toBe("technology-currency");
      expect(g.kind).toBe("change");
      expect(g.gapKey.startsWith("technology-currency:InventoryEntity:")).toBe(true);
    }
  });

  it("escalates severity via an explicit past EOL date over supportStatus", () => {
    const [g] = generateTechnologyCurrencyGaps([member("a", "supported", "2026-01-01T00:00:00Z")]);
    expect(g.severity).toBe("critical"); // EOL date in the past wins
  });

  it("scopes product-level when bound to a digital product", () => {
    const m = { ...member("a", "deprecated"), digitalProductId: "dp-1" };
    const [g] = generateTechnologyCurrencyGaps([m]);
    expect(g.scopeLevel).toBe("product");
    expect(g.digitalProductId).toBe("dp-1");
  });

  it("end-to-end: generated EOL gaps reconcile to creates then noop", () => {
    const gaps = generateTechnologyCurrencyGaps([member("a", "end-of-life")]);
    const first = reconcileGaps(gaps, []);
    expect(first.summary.created).toBe(1);
    const existing: ExistingGap[] = gaps.map((g, i) => ({ id: `e${i}`, gapKey: g.gapKey, status: "open", severity: g.severity, title: g.title, detail: g.detail ?? null }));
    const second = reconcileGaps(gaps, existing);
    expect(second.material).toBe(false);
  });
});
