// BI-40230C6F — the gate must stop waiting on an executor that is gone.
//
// "finalizing evidence" only means the slot holder has not published yet. It does
// NOT mean anything is still running. When the executor dies mid-run — the portal
// restarting is enough, and it takes the local-CI admission control plane with it —
// the evidence it owed will never arrive, and the wait loop used to poll a corpse
// for the entire deadline. Measured: ~30 minutes of "canonical local-CI execution
// is finalizing evidence" AFTER the gate had already logged the queue observer as
// proven dead.
//
// The pool is structurally ONE slot, so that wedged wait blocks every session on
// the host, not just the one that lost its executor.
//
// The safety property under test is the asymmetry: an explicit "no active lease"
// stops the wait, but "I could not ask" must NOT — an unreachable control plane is
// the very condition that kills the executor, so treating it as proof of death
// would turn a transient portal blip into a hard failure on a healthy diff.

import assert from "node:assert/strict";
import test from "node:test";

import { hasActiveLocalCiLease } from "./gate-worktree.mjs";

const ACTIVE_LEASE = {
  leaseId: "NPEL-84D5F64D49",
  environmentKey: "local-integration-ci",
  slotKey: "slot-0",
  status: "active",
};

function respond(leases) {
  return async () => ({ success: true, data: { leases, queued: [] } });
}

test("reports the slot held while a local-CI lease is active", async () => {
  assert.equal(await hasActiveLocalCiLease({ call: respond([ACTIVE_LEASE]) }), true);
});

test("reports the slot free when the control plane answers with no leases", async () => {
  // This is the case that ends the wait: nothing holds the slot, so the evidence
  // the loop is waiting for can never be published by anyone.
  assert.equal(await hasActiveLocalCiLease({ call: respond([]) }), false);
});

test("a lease for a DIFFERENT environment does not count as the local-CI slot", async () => {
  // Leases for other environments share this listing. Counting them would keep the
  // gate waiting forever on an executor that does not exist, which is the original
  // bug wearing a different hat.
  assert.equal(
    await hasActiveLocalCiLease({
      call: respond([{ leaseId: "NPEL-OTHER", environmentKey: "preview", status: "active" }]),
    }),
    false,
  );
});

test("an unreachable control plane is UNKNOWN, never 'the executor is gone'", async () => {
  // The failure that motivated this item was the portal going down mid-run
  // (ECONNREFUSED 127.0.0.1:3000). If that read as "no active lease", every
  // transient portal blip would hard-fail a gate on a perfectly good diff.
  const thrown = await hasActiveLocalCiLease({
    call: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3000");
    },
  });
  assert.equal(thrown, null);
  assert.notEqual(thrown, false);
});

test("a non-success response is UNKNOWN, not proof the slot is free", async () => {
  const refused = await hasActiveLocalCiLease({
    call: async () => ({ success: false, error: "unauthorized" }),
  });
  assert.equal(refused, null);
  assert.notEqual(refused, false);
});

test("a malformed payload is UNKNOWN rather than a stop signal", async () => {
  // `leases` absent is not the same claim as `leases: []`. Only the latter is the
  // control plane telling us nothing holds the slot.
  const malformed = await hasActiveLocalCiLease({ call: async () => ({ success: true }) });
  assert.equal(malformed, null);
  assert.notEqual(malformed, false);
});
