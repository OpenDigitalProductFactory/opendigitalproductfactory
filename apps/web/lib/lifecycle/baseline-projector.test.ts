import { describe, it, expect } from "vitest";
import {
  reconcileBaselinePlateau,
  resolveBaselinePlateau,
  BASELINE_PLATEAU_KEY,
  type BaselineProjectorClient,
} from "./baseline-projector";
import type { ExistingMembership } from "./baseline-projection";
import { resolveLifecycle } from "../lifecycle";

// Minimal in-memory fake of the narrow client surface.
function makeClient(opts?: { plateauExists?: boolean; memberships?: ExistingMembership[] }) {
  const memberships: ExistingMembership[] = [...(opts?.memberships ?? [])];
  const calls = { created: 0, updated: 0, events: 0, plateausCreated: 0 };
  let plateauId = opts?.plateauExists ? "plateau-existing" : null;

  const client: BaselineProjectorClient = {
    eaNotation: { findUnique: async () => ({ id: "notation-1" }) },
    eaElementType: { findUnique: async () => ({ id: "plateau-type-1" }) },
    eaElement: {
      findFirst: async () => (plateauId ? { id: plateauId } : null),
      create: async () => {
        calls.plateausCreated += 1;
        plateauId = "plateau-new";
        return { id: plateauId };
      },
    },
    plateauMembership: {
      findMany: async () => memberships,
      create: async () => {
        calls.created += 1;
        return { id: `created-${calls.created}` };
      },
      update: async () => {
        calls.updated += 1;
        return {};
      },
    },
    lifecycleEvent: {
      create: async () => {
        calls.events += 1;
        return { id: `evt-${calls.events}` };
      },
    },
  };
  return { client, calls };
}

const activeServer = { kind: "InventoryEntity", status: "active", supportStatus: "supported" } as const;

function member(id: string) {
  return { kind: "InventoryEntity" as const, id, stateSnapshot: resolveLifecycle(activeServer), evidenceRef: "discovery-run:R1" };
}

describe("resolveBaselinePlateau", () => {
  it("creates the plateau on first run with the stable baseline marker", async () => {
    const { client, calls } = makeClient({ plateauExists: false });
    const id = await resolveBaselinePlateau(client);
    expect(id).toBe("plateau-new");
    expect(calls.plateausCreated).toBe(1);
  });

  it("reuses the existing plateau when present", async () => {
    const { client, calls } = makeClient({ plateauExists: true });
    const id = await resolveBaselinePlateau(client);
    expect(id).toBe("plateau-existing");
    expect(calls.plateausCreated).toBe(0);
  });

  it("exposes a stable baseline key constant", () => {
    expect(BASELINE_PLATEAU_KEY).toBe("current-state-baseline");
  });
});

describe("reconcileBaselinePlateau", () => {
  it("opens memberships for new evidence (no event on open)", async () => {
    const { client, calls } = makeClient({ plateauExists: true });
    const res = await reconcileBaselinePlateau({ prisma: client, evidence: [member("srv-1"), member("srv-2")] });
    expect(res.status).toBe("applied");
    expect(res.summary.opened).toBe(2);
    expect(calls.created).toBe(2);
    expect(calls.events).toBe(0);
  });

  it("closes a departed membership and emits a lifecycle event", async () => {
    const existing: ExistingMembership[] = [
      { id: "m-gone", governedThingKind: "InventoryEntity", governedThingId: "gone", membershipSource: "projected", validTo: null, stateSnapshot: resolveLifecycle(activeServer) },
    ];
    const { client, calls } = makeClient({ plateauExists: true, memberships: existing });
    const res = await reconcileBaselinePlateau({ prisma: client, evidence: [] });
    expect(res.summary.closed).toBe(1);
    expect(calls.updated).toBe(1); // validTo set
    expect(calls.events).toBe(1); // close → lifecycle event
  });

  it("is a noop when evidence matches existing open memberships", async () => {
    const snap = resolveLifecycle(activeServer);
    const existing: ExistingMembership[] = [
      { id: "m1", governedThingKind: "InventoryEntity", governedThingId: "srv-1", membershipSource: "projected", validTo: null, stateSnapshot: snap },
    ];
    const { client, calls } = makeClient({ plateauExists: true, memberships: existing });
    const res = await reconcileBaselinePlateau({ prisma: client, evidence: [member("srv-1")] });
    expect(res.status).toBe("noop");
    expect(calls.created).toBe(0);
    expect(calls.updated).toBe(0);
    expect(calls.events).toBe(0);
  });
});
