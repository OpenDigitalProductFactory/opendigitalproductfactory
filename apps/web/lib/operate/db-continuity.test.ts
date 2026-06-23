import { describe, expect, it, vi } from "vitest";

import {
  classifyContinuity,
  runDbContinuityCheck,
  type ContinuityAlert,
  type ContinuityDeps,
} from "./db-continuity";

describe("classifyContinuity", () => {
  it("is first-boot when neither side has an epoch", () => {
    expect(classifyContinuity({ dbEpoch: null, hostEpoch: null })).toBe("first-boot");
    expect(classifyContinuity({ dbEpoch: 0, hostEpoch: 0 })).toBe("first-boot");
  });

  it("is ok when the DB is at or ahead of the host marker", () => {
    expect(classifyContinuity({ dbEpoch: 5, hostEpoch: 5 })).toBe("ok");
    expect(classifyContinuity({ dbEpoch: 6, hostEpoch: 5 })).toBe("ok");
    expect(classifyContinuity({ dbEpoch: 5, hostEpoch: null })).toBe("ok");
  });

  it("is reverted when the DB is behind the host marker (incl. a wiped DB)", () => {
    expect(classifyContinuity({ dbEpoch: 3, hostEpoch: 5 })).toBe("reverted");
    expect(classifyContinuity({ dbEpoch: null, hostEpoch: 5 })).toBe("reverted");
  });
});

interface FakeState {
  db: number | null;
  host: number | null;
  alert: ContinuityAlert | null;
  markerUsable: boolean;
}

function makeDeps(init: Partial<FakeState> & { env?: Record<string, string | undefined> } = {}) {
  const state: FakeState = {
    db: init.db ?? null,
    host: init.host ?? null,
    alert: init.alert ?? null,
    markerUsable: init.markerUsable ?? true,
  };
  const deps: ContinuityDeps = {
    readDbEpoch: async () => state.db,
    writeDbEpoch: async (e) => {
      state.db = e;
    },
    writeDbAlert: async (a) => {
      state.alert = a;
    },
    readHostEpoch: async () => state.host,
    writeHostEpoch: async (e) => {
      state.host = e;
    },
    markerUsable: async () => state.markerUsable,
    env: init.env ?? {},
    now: () => new Date("2026-06-23T04:00:00.000Z"),
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { deps, state };
}

describe("runDbContinuityCheck", () => {
  it("seeds both markers on first boot", async () => {
    const { deps, state } = makeDeps({ db: null, host: null });
    const res = await runDbContinuityCheck(deps);
    expect(res.verdict).toBe("first-boot");
    expect(state.db).toBe(1);
    expect(state.host).toBe(1);
    expect(state.alert).toBeNull();
  });

  it("advances both markers in lockstep on a healthy boot", async () => {
    const { deps, state } = makeDeps({ db: 5, host: 5 });
    const res = await runDbContinuityCheck(deps);
    expect(res.verdict).toBe("ok");
    expect(state.db).toBe(6);
    expect(state.host).toBe(6);
  });

  it("alarms and does NOT advance when the DB is reverted", async () => {
    const { deps, state } = makeDeps({ db: 3, host: 5 });
    const res = await runDbContinuityCheck(deps);
    expect(res.verdict).toBe("reverted");
    expect(state.db).toBe(3); // unchanged — keeps detecting until resolved
    expect(state.host).toBe(5);
    expect(state.alert).not.toBeNull();
    expect(state.alert?.hostEpoch).toBe(5);
  });

  it("adopts the epoch and clears the alert when a revert is acknowledged", async () => {
    const { deps, state } = makeDeps({ db: 3, host: 5, env: { DPF_ALLOW_DB_REVERT: "1" } });
    const res = await runDbContinuityCheck(deps);
    expect(res.verdict).toBe("ok");
    expect(state.db).toBe(6);
    expect(state.host).toBe(6);
    expect(state.alert).toBeNull();
  });

  it("throws on a revert when fail-closed is requested", async () => {
    const { deps } = makeDeps({ db: 3, host: 5, env: { DPF_DB_REVERT_FAILCLOSED: "1" } });
    await expect(runDbContinuityCheck(deps)).rejects.toThrow(/refusing to boot/i);
  });

  it("no-ops when the host marker is unavailable (dev/test)", async () => {
    const { deps, state } = makeDeps({ db: 5, host: null, markerUsable: false });
    const res = await runDbContinuityCheck(deps);
    expect(res.verdict).toBe("skipped");
    expect(state.db).toBe(5); // untouched
  });
});
