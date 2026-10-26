import assert from "node:assert/strict";
import test from "node:test";
import { observeHostReservation } from "./host-reservation-observation.mjs";

const binding = { leaseId: "NPEL-OWN", claimKey: "host-resource:v2:attempt:fingerprint",
  environmentKey: "host-heavy-resource", ownerProvider: "codex", ownerSessionId: "own-session",
  worktreePath: "D:/DPF-worktrees/own", branchName: "fix/own" };
const response = row => ({ success: true, entityId: binding.leaseId, data: { lease: row } });

for (const status of ["expired", "released", "cancelled"]) {
  test(`exact persisted ${status} settles only the reservation, including cleared process fields`, async () => {
    let calls = 0;
    const result = await observeHostReservation({ binding, call: async (name, args) => {
      ++calls;
      assert.equal(name, "list_nonprod_environment_leases");
      assert.deepEqual(args, { leaseId: binding.leaseId });
      return response({ ...binding, status, activeKey: null, ownerPid: null });
    } });
    assert.equal(calls, 1);
    assert.equal(result.reservationState, "settled");
    assert.equal(result.leaseStatus, status);
    assert.equal(result.processCleanupVerified, false);
    assert.ok(!("commandSucceeded" in result));
  });
}
for (const status of ["active", "queued"]) {
  test(`persisted ${status} stays pending even after reported expiry time`, async () => {
    const result = await observeHostReservation({ binding, call: async () => response({ ...binding, status,
      expiresAt: "2000-01-01T00:00:00Z" }) });
    assert.equal(result.reservationState, "pending");
    assert.equal(result.processCleanupVerified, false);
  });
}
for (const key of Object.keys(binding)) {
  test(`mismatched retained ${key} cannot settle another reservation`, async () => {
    const result = await observeHostReservation({ binding, call: async () => response({ ...binding,
      [key]: "foreign", status: "expired", activeKey: null }) });
    assert.equal(result.reservationState, "unknown");
    assert.equal(result.reason, "binding-mismatch");
  });
}
for (const reply of [null, { success: true }, { success: true, data: { leases: [], queued: [] } },
  { success: false, error: "not_found" }, { success: true, entityId: "OTHER", data: { lease: binding } }]) {
  test(`unproven readback ${JSON.stringify(reply)} never proves expiry`, async () => {
    assert.equal((await observeHostReservation({ binding, call: async () => reply })).reservationState, "unknown");
  });
}
test("reader failure stays bounded and redacted", async () => {
  let calls = 0;
  const result = await observeHostReservation({ binding, call: async () => { ++calls; throw new Error("private error"); } });
  assert.equal(calls, 1);
  assert.equal(result.reservationState, "unknown");
  assert.doesNotMatch(JSON.stringify(result), /private error/);
});
test("terminal row still occupying a slot is inconsistent", async () => {
  assert.equal((await observeHostReservation({ binding, call: async () => response({ ...binding,
    status: "expired", activeKey: "host-heavy-resource:slot-0" }) })).reservationState, "unknown");
});
test("missing admitted binding does not issue a broad list or release", async () => {
  let calls = 0;
  const result = await observeHostReservation({ binding: { leaseId: "NPEL-OWN" }, call: async () => { ++calls; } });
  assert.equal(calls, 0);
  assert.equal(result.reservationState, "unknown");
});
