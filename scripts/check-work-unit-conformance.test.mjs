import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditWorkUnitConformance } from "./check-work-unit-conformance.mjs";

const registry = [
  "toWorkUnitFromCapsule", "toWorkUnitFromWorkItem", "toWorkUnitFromTaskRun",
].map((adapter) => `adapter: "${adapter}"\nfunction ${adapter}`).join("\n");

describe("WorkUnit conformance", () => {
  it("rejects a newly forked status projector", () => {
    const findings = auditWorkUnitConformance([{
      path: "apps/web/lib/new-domain/order-status-projection.ts",
      source: "export function projectOrderStatus() {}",
    }], registry);
    assert.match(findings.join("\n"), /bespoke projector/);
  });

  it("accepts a thin carrier adapter over the canonical authority", () => {
    assert.deepEqual(auditWorkUnitConformance([{
      path: "apps/web/lib/new-domain/order-status-projection.ts",
      source: "return projectWorkUnitState(toWorkUnitFromOrder(order));",
    }], registry), []);
  });

  it("rejects an unregistered carrier adapter", () => {
    assert.match(
      auditWorkUnitConformance([], registry.replace('adapter: "toWorkUnitFromTaskRun"', "")).join("\n"),
      /registered/,
    );
  });
});
