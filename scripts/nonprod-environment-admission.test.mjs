import assert from "node:assert/strict";
import test from "node:test";

import {
  planEnvironmentAdmission,
} from "../apps/web/lib/nonprod/environment-lease-admission.ts";

const NOW = new Date("2026-07-28T21:00:00.000Z");

function lease(overrides) {
  return {
    id: overrides.id,
    status: overrides.status ?? "queued",
    slotKey: overrides.slotKey ?? null,
    queuedAt: overrides.queuedAt ?? NOW,
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 60_000),
    supportedSlotKeys: overrides.supportedSlotKeys,
  };
}

test("admits the oldest waiter into the lowest free slot", () => {
  const plan = planEnvironmentAdmission({
    leases: [
      lease({
        id: "newer",
        queuedAt: new Date("2026-07-28T20:59:02.000Z"),
      }),
      lease({
        id: "older",
        queuedAt: new Date("2026-07-28T20:59:01.000Z"),
      }),
    ],
    now: NOW,
    slotKeys: ["slot-1", "slot-0"],
  });

  assert.deepEqual(plan.admissions, [
    { leaseId: "older", slotKey: "slot-0" },
    { leaseId: "newer", slotKey: "slot-1" },
  ]);
  assert.deepEqual(plan.queuePositions, []);
});

test("expires lapsed owners before promoting FIFO waiters", () => {
  const plan = planEnvironmentAdmission({
    leases: [
      lease({
        id: "lapsed",
        status: "active",
        slotKey: "slot-0",
        expiresAt: new Date(NOW.getTime() - 1),
      }),
      lease({
        id: "waiter",
        queuedAt: new Date("2026-07-28T20:59:00.000Z"),
      }),
    ],
    now: NOW,
    slotKeys: ["slot-0"],
  });

  assert.deepEqual(plan.expiredLeaseIds, ["lapsed"]);
  assert.deepEqual(plan.admissions, [
    { leaseId: "waiter", slotKey: "slot-0" },
  ]);
});

test("reports stable FIFO positions while capacity is occupied", () => {
  const queuedAt = new Date("2026-07-28T20:59:00.000Z");
  const plan = planEnvironmentAdmission({
    leases: [
      lease({ id: "active", status: "active", slotKey: "slot-0" }),
      lease({ id: "b", queuedAt }),
      lease({ id: "a", queuedAt }),
    ],
    now: NOW,
    slotKeys: ["slot-0"],
  });

  assert.deepEqual(plan.admissions, []);
  assert.deepEqual(plan.queuePositions, [
    { leaseId: "a", position: 1 },
    { leaseId: "b", position: 2 },
  ]);
});

test("cancelled leases never consume capacity or queue position", () => {
  const plan = planEnvironmentAdmission({
    leases: [
      lease({ id: "cancelled", status: "cancelled" }),
      lease({ id: "waiting" }),
    ],
    now: NOW,
    slotKeys: ["slot-0"],
  });

  assert.deepEqual(plan.admissions, [
    { leaseId: "waiting", slotKey: "slot-0" },
  ]);
  assert.deepEqual(plan.queuePositions, []);
});

test("a waiter whose heartbeat deadline elapsed is expired, not promoted", () => {
  const plan = planEnvironmentAdmission({
    leases: [
      lease({
        id: "dead-waiter",
        expiresAt: new Date(NOW.getTime() - 1),
      }),
      lease({ id: "live-waiter" }),
    ],
    now: NOW,
    slotKeys: ["slot-0"],
  });

  assert.deepEqual(plan.expiredLeaseIds, ["dead-waiter"]);
  assert.deepEqual(plan.admissions, [
    { leaseId: "live-waiter", slotKey: "slot-0" },
  ]);
});

test("capacity contraction preserves a live slot-1 owner and blocks new slot-1 admission", () => {
  const plan = planEnvironmentAdmission({
    leases: [
      lease({ id: "slot-0-owner", status: "active", slotKey: "slot-0" }),
      lease({ id: "slot-1-owner", status: "active", slotKey: "slot-1" }),
      lease({ id: "waiting" }),
    ],
    now: NOW,
    slotKeys: ["slot-0"],
  });

  assert.deepEqual(plan.expiredLeaseIds, []);
  assert.deepEqual(plan.admissions, []);
  assert.deepEqual(plan.queuePositions, [{ leaseId: "waiting", position: 1 }]);
});

test("a legacy claimant is never admitted to slot-1", () => {
  const plan = planEnvironmentAdmission({
    leases: [
      lease({ id: "slot-0-owner", status: "active", slotKey: "slot-0" }),
      lease({ id: "legacy", supportedSlotKeys: ["slot-0"] }),
    ],
    now: NOW,
    slotKeys: ["slot-0", "slot-1"],
  });

  assert.deepEqual(plan.admissions, []);
  assert.deepEqual(plan.queuePositions, [{ leaseId: "legacy", position: 1 }]);
});

test("slot compatibility preserves FIFO instead of bypassing an incompatible head waiter", () => {
  const plan = planEnvironmentAdmission({
    leases: [
      lease({ id: "slot-0-owner", status: "active", slotKey: "slot-0" }),
      lease({
        id: "legacy-head",
        queuedAt: new Date("2026-07-28T20:59:00.000Z"),
        supportedSlotKeys: ["slot-0"],
      }),
      lease({
        id: "slot-aware-next",
        queuedAt: new Date("2026-07-28T20:59:01.000Z"),
        supportedSlotKeys: ["slot-0", "slot-1"],
      }),
    ],
    now: NOW,
    slotKeys: ["slot-0", "slot-1"],
  });

  assert.deepEqual(plan.admissions, []);
  assert.deepEqual(plan.queuePositions, [
    { leaseId: "legacy-head", position: 1 },
    { leaseId: "slot-aware-next", position: 2 },
  ]);
});

test("owner death reaps and refills only its slot while the peer remains valid", () => {
  const plan = planEnvironmentAdmission({
    leases: [
      lease({ id: "slot-0-peer", status: "active", slotKey: "slot-0" }),
      lease({
        id: "dead-slot-1",
        status: "active",
        slotKey: "slot-1",
        expiresAt: new Date(NOW.getTime() - 1),
      }),
      lease({
        id: "fifo-next",
        supportedSlotKeys: ["slot-0", "slot-1"],
      }),
    ],
    now: NOW,
    slotKeys: ["slot-0", "slot-1"],
  });

  assert.deepEqual(plan.expiredLeaseIds, ["dead-slot-1"]);
  assert.deepEqual(plan.admissions, [
    { leaseId: "fifo-next", slotKey: "slot-1" },
  ]);
  assert.equal(
    plan.expiredLeaseIds.includes("slot-0-peer"),
    false,
    "healthy peer must never be reaped with the dead owner",
  );
});
