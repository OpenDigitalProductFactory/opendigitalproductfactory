// GPP Phase 2, PR-G — concurrent presentations of one single-use handle.
//
// Before PR-G the verdict was computed from the row as read, and the use was
// counted afterwards and its result ignored. Two presentations that both read
// the row before either counted its use were both `valid`. Now the use is
// taken by one conditional update and is part of the verdict: the
// presentation whose update matched no row is `exhausted`. Exactly one wins.
//
// The store below behaves as PostgreSQL does for the real one: every lookup
// returns a snapshot of the row (so a concurrent reader sees the stale
// useCount), and consumePermit is a compare-and-set on the live row. A barrier
// holds each lookup until every presentation has read, so the race is forced
// on every run rather than left to timing.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-G).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GPP_BINDINGS } from "./bindings";
import { mintShadowPermit } from "./permit-mint";
import { setGppPermitStoreOverrideForTests, type GppPermitStore, type PermitRow } from "./permit-store";
import { resolveMonitorPermit, type PermitChecks } from "./permit-verdict";

const NOW = new Date("2026-10-01T12:00:00Z");
const PARAMS = { title: "t" };
const binding = GPP_BINDINGS.find((b) => b.bindingId === "tak-alignment-admit")!;

type RacingStore = { store: GppPermitStore; rows: PermitRow[]; consumeCalls: number; arm: (readers: number) => void };

function racingStore(): RacingStore {
  const rows: PermitRow[] = [];
  let waiting: Array<() => void> = [];
  let readers = 0;
  const state: RacingStore = {
    rows,
    consumeCalls: 0,
    arm: (count) => { readers = count; },
    store: {
      createPermit: async (claims, signature) => {
        const row: PermitRow = {
          ...claims, id: `row-${rows.length + 1}`, useCount: 0, revokedAt: null,
          keyId: signature?.keyId ?? null, mac: signature?.mac ?? null,
        };
        rows.push(row);
        return { ...row };
      },
      findPermitByPermitId: async (permitId) => {
        const live = rows.find((row) => row.permitId === permitId);
        const snapshot = live ? { ...live } : null;
        if (readers > 0) {
          // Hold every reader until all have read the same committed row.
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
            if (waiting.length >= readers) {
              const release = waiting;
              waiting = [];
              readers = 0;
              for (const go of release) go();
            }
          });
        }
        return snapshot;
      },
      consumePermit: async (row) => {
        state.consumeCalls += 1;
        // Yield first, so the presentations interleave as concurrent requests would.
        await Promise.resolve();
        const live = rows.find((candidate) => candidate.id === row.id);
        if (!live || live.useCount >= row.maxUses) return false;
        live.useCount += 1;
        return true;
      },
      createObservation: async () => undefined,
      findLineage: async () => ({ found: true, sealed: true }),
    },
  };
  return state;
}

let s: RacingStore;

beforeEach(() => {
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", "test-permit-secret-0123456789abcdef");
  vi.stubEnv("DPF_GPP_PERMIT_KEY_ID", "k1");
  s = racingStore();
  setGppPermitStoreOverrideForTests(s.store);
});

afterEach(() => {
  setGppPermitStoreOverrideForTests(null);
  vi.unstubAllEnvs();
});

async function mintHandle(): Promise<string> {
  const minted = await mintShadowPermit({
    binding, toolName: "create_portal_pr", actorUserId: "u1", gateDecisionId: "DI-ALIGN-1", params: PARAMS, now: NOW,
  });
  if (!minted) throw new Error("mint failed");
  return minted.handle;
}

const present = (handle: string, params: Record<string, unknown> = PARAMS) =>
  resolveMonitorPermit({
    toolName: "create_portal_pr", tool: { consequential: true }, alignmentApproved: false,
    alignmentInteractionId: null, approvedEnvelopeId: null, authorityDecisionId: null,
    actorUserId: "u1", actorAgentId: null, workroomId: null, permitHandle: handle, params, now: NOW,
  });

const stateOf = (detail: Record<string, unknown>) => (detail.checks as PermitChecks).state;

describe("PR-G: one single-use handle presented concurrently", () => {
  it("exactly one of two concurrent presentations is valid; the other is exhausted", async () => {
    const handle = await mintHandle();
    s.arm(2);

    const outcomes = await Promise.all([present(handle), present(handle)]);

    expect(outcomes.map((o) => o.verdict).sort()).toEqual(["exhausted", "valid"]);
    expect(outcomes.map((o) => stateOf(o.detail)).sort()).toEqual(["exhausted", "valid"]);
    const loser = outcomes.find((o) => o.verdict === "exhausted")!;
    expect(loser.detail).toMatchObject({ useTakenConcurrently: true });
    expect(outcomes.find((o) => o.verdict === "valid")!.detail).not.toHaveProperty("useTakenConcurrently");
    expect(s.rows[0]!.useCount).toBe(1);
  });

  it("holds for many concurrent presentations: one valid, the rest exhausted, one use spent", async () => {
    const handle = await mintHandle();
    s.arm(8);

    const outcomes = await Promise.all(Array.from({ length: 8 }, () => present(handle)));

    expect(outcomes.filter((o) => o.verdict === "valid")).toHaveLength(1);
    expect(outcomes.filter((o) => o.verdict === "exhausted")).toHaveLength(7);
    expect(s.rows[0]!.useCount).toBe(1);
  });

  it("a forged or mismatched presentation racing the real one never takes its use", async () => {
    const handle = await mintHandle();
    const forged = handle.replace(/\.[^.]+$/, `.${"A".repeat(43)}`);
    s.arm(3);

    const [real, forgedOutcome, mismatched] = await Promise.all([
      present(handle),
      present(forged),
      present(handle, { title: "other" }),
    ]);

    expect(real.verdict).toBe("valid");
    expect(forgedOutcome.verdict).toBe("mac_invalid");
    expect(mismatched.verdict).toBe("param_mismatch");
    // Only the sound presentation attempted to take a use.
    expect(s.consumeCalls).toBe(1);
    expect(s.rows[0]!.useCount).toBe(1);
  });

  it("a sequential replay after the use is spent is exhausted, as before", async () => {
    const handle = await mintHandle();
    expect((await present(handle)).verdict).toBe("valid");
    expect((await present(handle)).verdict).toBe("exhausted");
  });

  it("a failed use count is recorded and leaves the verdict as checked (fail open on infrastructure)", async () => {
    const handle = await mintHandle();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setGppPermitStoreOverrideForTests({ ...s.store, consumePermit: async () => { throw new Error("db down"); } });

    const outcome = await present(handle);

    expect(outcome.verdict).toBe("valid");
    expect(outcome.detail).toMatchObject({ consumeFailed: true });
    errors.mockRestore();
  });
});
