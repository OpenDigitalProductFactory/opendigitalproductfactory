import { describe, expect, it } from "vitest";

import {
  DELIVERY_SHAPE_KEYS,
  DELIVERY_SHAPE_REFS,
  DELIVERY_SHAPES,
  DELIVERY_SHAPE_VERSION,
  isDeliveryShapeKey,
} from "./delivery-shapes";
import { getWorkShape, readWorkShapeDefinitionContract, validateWorkShape } from "./work-shapes";
import { parseWorkShapeRef, resolveWorkShapeClaim } from "./workroom-shape-claim";

describe("the five delivery shapes (BI-B90F7CBB, design §3.0)", () => {
  it("resolve from the canonical registry as key@1.0.0", () => {
    expect(DELIVERY_SHAPE_KEYS).toEqual([
      "delivery-break-fix", "delivery-small", "delivery-medium", "delivery-large", "delivery-xlarge",
    ]);
    for (const key of DELIVERY_SHAPE_KEYS) {
      const shape = getWorkShape(key);
      expect(shape, key).not.toBeNull();
      expect(shape?.version).toBe(DELIVERY_SHAPE_VERSION);
      expect(readWorkShapeDefinitionContract(shape!).key).toBe(key);
    }
    expect(DELIVERY_SHAPE_REFS).toContain("delivery-small@1.0.0");
  });

  it("satisfy the §8.11 conformance rules and are claim-triggered", () => {
    for (const key of DELIVERY_SHAPE_KEYS) {
      const shape = DELIVERY_SHAPES[key];
      expect(validateWorkShape(shape), key).toEqual([]);
      expect(shape.triggers).toEqual(["claim"]);
      expect(shape.stopConditions.map((stop) => stop.kind)).toEqual(expect.arrayContaining(["success", "failure", "budget"]));
      for (const stage of shape.stages) expect(stage.evidence.length, `${key}/${stage.key}`).toBeGreaterThan(0);
    }
  });

  it("make every merge, deploy and authority-changing advance a governed decision", () => {
    for (const key of DELIVERY_SHAPE_KEYS) {
      for (const stage of DELIVERY_SHAPES[key].stages) {
        if (["merge", "deploy", "accept", "post-implementation-review", "spec-approval", "decompose", "reconcile"].includes(stage.key)) {
          expect(stage.advance.kind, `${key}/${stage.key}`).toBe("governed-decision");
        }
      }
    }
  });

  it("never let the author hold the receipt writer", () => {
    for (const key of DELIVERY_SHAPE_KEYS) {
      for (const stage of DELIVERY_SHAPES[key].stages) {
        if (["accept", "post-implementation-review", "spec-approval"].includes(stage.key)) {
          expect(stage.accountablePrincipalRef, `${key}/${stage.key}`).not.toBe("role:author");
        }
      }
    }
  });

  it("encode the §4 gate table: shape-specific stages, budgets and collaboration shapes", () => {
    const stageKeys = (key: (typeof DELIVERY_SHAPE_KEYS)[number]) => DELIVERY_SHAPES[key].stages.map((stage) => stage.key);
    expect(stageKeys("delivery-break-fix")).toEqual(["reproduce", "repair", "merge", "post-implementation-review"]);
    expect(stageKeys("delivery-small")).toEqual(["reproduce", "repair", "merge", "runtime-check"]);
    expect(stageKeys("delivery-medium")).toEqual(["design-note", "implement", "merge", "accept"]);
    expect(stageKeys("delivery-large")).toEqual(["spec", "spec-approval", "plan", "implement", "merge", "deploy", "accept"]);
    expect(stageKeys("delivery-xlarge")).toEqual(["hypothesis", "decompose", "children", "reconcile"]);
    expect(DELIVERY_SHAPES["delivery-break-fix"].budgets).toEqual([{ kind: "cycles-per-window", limit: 1, unit: "open break-fix per installation" }]);
    expect(DELIVERY_SHAPES["delivery-break-fix"].collaborationShape).toBe("escalation");
    expect(DELIVERY_SHAPES["delivery-small"].collaborationShape).toBeNull();
    expect(DELIVERY_SHAPES["delivery-medium"].collaborationShape).toBe("outward-review");
    expect(DELIVERY_SHAPES["delivery-large"].collaborationShape).toBe("change-consequential");
    expect(DELIVERY_SHAPES["delivery-xlarge"].collaborationShape).toBe("approval-sign-off");
    expect(DELIVERY_SHAPES["delivery-xlarge"].stages.map((stage) => stage.key)).not.toContain("implement");
  });

  it("refuse a malformed reference at normalization and accept a registered one", () => {
    expect(parseWorkShapeRef("delivery-small")).toBeNull();
    expect(parseWorkShapeRef("delivery-small@1.0.0")).toEqual({ key: "delivery-small", version: "1.0.0" });
    expect(resolveWorkShapeClaim([{ workShape: "delivery-small@1.0.0" }])?.key).toBe("delivery-small");
    expect(resolveWorkShapeClaim([{ workShape: "delivery-small@9.9.9" }])).toBeNull();
    expect(resolveWorkShapeClaim([{ workShape: "delivery-huge@1.0.0" }])).toBeNull();
    expect(isDeliveryShapeKey("delivery-medium")).toBe(true);
    expect(isDeliveryShapeKey("obligation-assurance-watch")).toBe(false);
  });
});
