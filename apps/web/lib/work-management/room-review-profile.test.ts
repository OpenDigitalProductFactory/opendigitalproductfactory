import { describe, expect, it } from "vitest";
import { WORK_CASE_SOURCE_REGISTRY } from "./source-registry";
import { composeRoomReviewProfile, listRoomReviewDefinitions } from "./room-review-profile";
import { roomReviewLayers } from "./room-review-profile-catalog";

describe("Workroom review profiles", () => {
  it("keeps common obligations when a scoped layer supplies an empty evidence list", () => {
    const layers = roomReviewLayers("backlog-item");
    const common = layers[0]!.requirements[0]!;
    const result = composeRoomReviewProfile("backlog-item", [...layers, {
      ref: "org:example@1", kind: "organization", requirements: [{ ...common, evidence: [] }],
    }]);
    expect(result.status).toBe("resolved");
    expect(result.requirements.find(r => r.ref === common.ref)?.evidence).toEqual([...common.evidence].sort());
  });

  it("makes facet order irrelevant and retains every contributor", () => {
    const requirement = { ref: "freshness", outcome: "Evidence is current", denominator: "eligible cycles", evidence: ["timestamp"], criticalFailures: [], maxAgeSeconds: 60 };
    const facets = [
      { ref: "facet:b@1", kind: "facet" as const, requirements: [{ ...requirement, maxAgeSeconds: 30 }] },
      { ref: "facet:a@1", kind: "facet" as const, requirements: [requirement] },
    ];
    const a = composeRoomReviewProfile("scheduled", [...roomReviewLayers("scheduled"), ...facets]);
    const b = composeRoomReviewProfile("scheduled", [...facets.reverse(), ...roomReviewLayers("scheduled")]);
    expect(a).toEqual(b);
    expect(a.requirements.find(r => r.ref === "freshness")).toMatchObject({ maxAgeSeconds: 30, provenance: ["facet:a@1", "facet:b@1"] });
  });

  it("rejects incompatible denominators instead of silently selecting an overlay", () => {
    const layers = roomReviewLayers("booking");
    const original = layers[0]!.requirements[0]!;
    const result = composeRoomReviewProfile("booking", [...layers, {
      ref: "org:bad@1", kind: "organization", requirements: [{ ...original, denominator: "successful bookings only" }],
    }]);
    expect(result.status).toBe("unresolved");
    expect(result.fingerprint).toBeNull();
    expect(result.conflicts).toContain(`requirement-conflict:${original.ref}`);
  });

  it("rejects contradictory payloads with the same versioned layer reference", () => {
    const layers = roomReviewLayers("booking");
    expect(composeRoomReviewProfile("booking", [...layers, { ...layers[0]!, requirements: [] }]).status).toBe("unresolved");
  });

  it("does not resolve an unknown definition and always supplies the common profile", () => {
    expect(composeRoomReviewProfile("unknown", roomReviewLayers("booking")).status).toBe("unsupported");
    expect(composeRoomReviewProfile("booking", []).requirements.map(r => r.ref)).toContain("attributed-outcome");
  });

  it("changes cohort fingerprint when evidence obligations change", () => {
    const layers = roomReviewLayers("booking");
    const a = composeRoomReviewProfile("booking", layers);
    const b = composeRoomReviewProfile("booking", [...layers, { ref: "facet:new@1", kind: "facet", requirements: [{ ref: "new", outcome: "Verify capacity", denominator: "bookings", evidence: ["capacity"], criticalFailures: ["overbooked"] }] }]);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("counts the booking alias once without removing compatibility source entries", () => {
    const page = listRoomReviewDefinitions({ limit: 200 });
    expect(page.total).toBe(WORK_CASE_SOURCE_REGISTRY.length - 1);
    expect(page.items.find(r => r.sourceKey === "booking")?.aliases).toContain("storefront-booking");
    expect(page.items.some(r => r.sourceKey === "storefront-booking")).toBe(false);
    expect(composeRoomReviewProfile("storefront-booking", roomReviewLayers("storefront-booking"))).toEqual(composeRoomReviewProfile("booking", roomReviewLayers("booking")));
    expect(WORK_CASE_SOURCE_REGISTRY.some(r => r.sourceKey === "storefront-booking")).toBe(true);
  });

  it("enumerates every canonical definition over bounded pages without claiming exercised coverage", () => {
    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = listRoomReviewDefinitions({ limit: 3, after });
      expect(page.items.length).toBeLessThanOrEqual(3);
      expect(page.items.every(r => r.assessment === "not-exercised")).toBe(true);
      seen.push(...page.items.map(r => r.sourceKey));
      after = page.nextCursor ?? undefined;
    } while (after);
    expect(new Set(seen).size).toBe(listRoomReviewDefinitions({ limit: 200 }).total);
    expect(() => listRoomReviewDefinitions({ limit: 201 })).toThrow();
    expect(() => listRoomReviewDefinitions({ after: "missing", limit: 3 })).toThrow();
    const first = listRoomReviewDefinitions({ limit: 3 });
    expect(() => listRoomReviewDefinitions({ after: first.nextCursor!.replace(/^[^|]+/, "old-inventory"), limit: 3 })).toThrow("Stale");
  });

  it.each([
    ["backlog-item", undefined, "development-acceptance", "installed-version"],
    ["bookkeeping-period", undefined, "period-reconciliation", "reconciliation"],
    ["booking", "pet-rescue", "welfare-capacity", "custody"],
    ["booking", "campground", "site-fit", "rig-fit"],
  ])("retains domain evidence for %s/%s", (sourceKey, archetypeId, ref, evidence) => {
    const result = composeRoomReviewProfile(sourceKey!, roomReviewLayers(sourceKey!, archetypeId));
    expect(result.status).toBe("resolved");
    expect(result.requirements.find(r => r.ref === ref)?.evidence).toContain(evidence);
    expect(result.requirements.find(r => r.ref === ref)?.criticalFailures.length).toBeGreaterThan(0);
  });

  it("does not treat missing evidence as a zero-defect assessment", () => {
    expect(listRoomReviewDefinitions({ limit: 200 }).items.every(r => r.assessment === "not-exercised")).toBe(true);
  });

  it("does not allow a caller's replacement common layer to remove baseline obligations", () => {
    const result = composeRoomReviewProfile("booking", [{ ref: "caller:common@1", kind: "common", requirements: [] }]);
    expect(result.requirements.map(r => r.ref)).toContain("safe-continuation");
    expect(result.requirements.map(r => r.ref)).toContain("source-contract");
  });

  it("rejects invalid freshness values and preserves the stricter inherited limit", () => {
    const r = { ref: "fresh", outcome: "Fresh evidence", denominator: "cycles", evidence: ["timestamp"], criticalFailures: [], maxAgeSeconds: 10 };
    const good = { ref: "facet:fresh@1", kind: "facet" as const, requirements: [r] };
    expect(composeRoomReviewProfile("scheduled", [good, { ref: "org:looser@1", kind: "organization", requirements: [{ ...r, maxAgeSeconds: 100 }] }]).requirements.find(v => v.ref === "fresh")?.maxAgeSeconds).toBe(10);
    expect(composeRoomReviewProfile("scheduled", [{ ...good, requirements: [{ ...r, maxAgeSeconds: -1 }] }]).status).toBe("unresolved");
  });

  it("returns independent layer payloads", () => {
    const first = roomReviewLayers("booking");
    (first[0]!.requirements[0]!.evidence as string[]).length = 0;
    expect(roomReviewLayers("booking")[0]!.requirements[0]!.evidence.length).toBeGreaterThan(0);
  });

  it("reports unavailable archetype extensions instead of silently using common coverage", () => {
    expect(() => roomReviewLayers("booking", "unknown-archetype")).toThrow("applicability is unknown");
  });

  it("resolves ten thousand occurrences without growing the definition inventory", () => {
    const total = listRoomReviewDefinitions({ limit: 200 }).total;
    const expected = composeRoomReviewProfile("booking", []);
    for (let i = 0; i < 10_000; i++) {
      expect(composeRoomReviewProfile(i % 2 ? "booking" : "storefront-booking", []).fingerprint).toBe(expected.fingerprint);
    }
    expect(listRoomReviewDefinitions({ limit: 200 }).total).toBe(total);
  });
});
