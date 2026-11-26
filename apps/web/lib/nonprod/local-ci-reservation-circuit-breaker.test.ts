import { expect, it } from "vitest";
import * as statuses from "../../../../scripts/lib/local-integration-status.mjs";
import { contractLocalCiPoolAfterGateResult } from "./local-ci-pool-circuit-breaker";

it("a slot-1 DPF2 wait timeout never updates capacity, including on an older portal", async () => {
  // The older breaker trips for every non-pass tagged with slotManifest.slotKey
  // slot-1, plus the two global pressure statuses regardless of the slot.
  const original = { status: "blocked_dpf2_reservation" as const, summary: "DPF2 quiet window", evidence: { slotManifest: { schemaVersion: 1, slotKey: "slot-1" } } };
  const platformConfig = {
    findUnique: async () => { throw new Error("must not consult capacity"); },
    updateMany: async () => { throw new Error("must not shrink capacity"); },
  };
  expect(await contractLocalCiPoolAfterGateResult({ platformConfig, ...original })).toEqual({ status: "not-applicable" });
  const fallback = statuses.fallbackRecordForUnknownStatus(original);
  expect(fallback.status).toBe("blocked_sandbox_drift");
  expect(fallback.evidence).toEqual({ reservationBlockedSlotManifest: original.evidence.slotManifest });
  expect(original.evidence.slotManifest.slotKey).toBe("slot-1");
  expect(await contractLocalCiPoolAfterGateResult({ platformConfig, ...fallback })).toEqual({ status: "not-applicable" });
});
