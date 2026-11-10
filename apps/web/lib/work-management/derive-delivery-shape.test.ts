import { describe, expect, it } from "vitest";

import { DELIVERY_SHAPE_PICK_LIST, buildDeliveryShapeClaim, deriveDeliveryShape, resolveDeliveryShape } from "./derive-delivery-shape";
import { readWorkShapeClaim } from "./workroom-shape-claim";

describe("deriveDeliveryShape (design §3.4)", () => {
  it("rule 1: a bug is small; expedited it is break-fix; a bug sized otherwise is not derivable", () => {
    expect(deriveDeliveryShape({ workType: "bug" })?.key).toBe("delivery-small");
    expect(deriveDeliveryShape({ workType: "bug", expedite: true })?.key).toBe("delivery-break-fix");
    expect(deriveDeliveryShape({ workType: "bug", effortSize: "large" })).toBeNull();
  });

  it("rule 2: doc and chore are small unless effortSize says otherwise", () => {
    expect(deriveDeliveryShape({ workType: "doc" })?.key).toBe("delivery-small");
    expect(deriveDeliveryShape({ workType: "chore", effortSize: "medium" })?.key).toBe("delivery-medium");
  });

  it("rule 3: effortSize drives everything else; nothing is derived without it", () => {
    expect(deriveDeliveryShape({ workType: "feature", effortSize: "large" })?.key).toBe("delivery-large");
    expect(deriveDeliveryShape({ workType: "refactor", effortSize: "xlarge" })?.key).toBe("delivery-xlarge");
    expect(deriveDeliveryShape({ workType: "feature" })).toBeNull();
    expect(deriveDeliveryShape(null)).toBeNull();
  });

  it("rule 4: adding substrate is at least large", () => {
    expect(deriveDeliveryShape({ workType: "feature", effortSize: "small", addsSubstrate: true })?.key).toBe("delivery-large");
    expect(deriveDeliveryShape({ workType: "feature", effortSize: "xlarge", addsSubstrate: true })?.key).toBe("delivery-xlarge");
  });
});

describe("resolveDeliveryShape", () => {
  it("prefers a declared shape and refuses a malformed or unknown one", () => {
    expect(resolveDeliveryShape({ declared: "delivery-large@1.0.0", signals: { workType: "bug" } })).toEqual({ kind: "declared", key: "delivery-large", ref: "delivery-large@1.0.0" });
    expect(resolveDeliveryShape({ declared: "delivery-large", signals: {} }).kind).toBe("invalid");
    expect(resolveDeliveryShape({ declared: "delivery-huge@1.0.0", signals: {} }).kind).toBe("invalid");
    expect(resolveDeliveryShape({ declared: "dependency-advisory-watch@1.0.0", signals: {} }).kind).toBe("invalid");
  });

  it("is ambiguous, never a guess, when the rules do not agree", () => {
    const resolution = resolveDeliveryShape({ declared: null, signals: { workType: "feature" } });
    expect(resolution.kind).toBe("ambiguous");
  });

  it("builds a claim entry the existing reader parses and the pick list names every shape", () => {
    const derived = resolveDeliveryShape({ declared: undefined, signals: { workType: "chore" } });
    expect(derived.kind).toBe("derived");
    const entry = buildDeliveryShapeClaim(derived as Extract<typeof derived, { kind: "derived" }>, new Date("2026-09-06T00:00:00Z"));
    expect(entry).toMatchObject({ workShape: "delivery-small@1.0.0", source: "derived", reasonCode: "derived_doc_chore_small" });
    expect(readWorkShapeClaim([entry])).toEqual({ key: "delivery-small", version: "1.0.0" });
    expect(DELIVERY_SHAPE_PICK_LIST.map((pick) => pick.key)).toEqual([
      "delivery-break-fix", "delivery-small", "delivery-medium", "delivery-large", "delivery-xlarge",
    ]);
  });
});
