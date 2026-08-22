import { describe, expect, it } from "vitest";

import {
  DEADLINE_HORIZON_SCOPE_ID,
  DEADLINE_HORIZON_SCOPE_TYPE,
  runDeadlineHorizonSweep,
  type DeadlineHorizonDb,
} from "./deadline-horizon-runner";
import { DEADLINE_HORIZON_ADAPTER_KEY } from "./deadline-horizon-sweep";

const NOW = new Date("2026-08-21T00:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

type Row = Record<string, unknown>;

function fakeDb(seed: {
  obligations?: Row[];
  controls?: Row[];
  licenseReferences?: Row[];
  existingFindings?: Array<{ findingKey: string; status: string; reopenCount: number }>;
}) {
  const created: Row[] = [];
  const updated: Array<{ findingKey: string; data: Row }> = [];
  const runs: Row[] = [];
  const existing = seed.existingFindings ?? [];

  const db: DeadlineHorizonDb = {
    obligation: { findMany: async () => seed.obligations ?? [] },
    control: { findMany: async () => seed.controls ?? [] },
    licenseRequirementReference: { findMany: async () => seed.licenseReferences ?? [] },
    assuranceRun: {
      create: async (args: unknown) => {
        const data = (args as { data: Row }).data;
        runs.push(data);
        return { id: "run-row-1", runId: String(data.runId) };
      },
    },
    assuranceFinding: {
      findMany: async (args: unknown) => {
        const where = (args as { where: Record<string, never> }).where as Record<string, unknown>;
        // The reconcile query filters by notIn; the upsert query by in.
        const keyFilter = where.findingKey as { in?: string[]; notIn?: string[] } | undefined;
        if (keyFilter?.notIn) {
          const excluded = new Set(keyFilter.notIn);
          return existing
            .filter((row) => !excluded.has(row.findingKey))
            .map((row) => ({ findingKey: row.findingKey }));
        }
        const included = new Set(keyFilter?.in ?? []);
        return existing.filter((row) => included.has(row.findingKey));
      },
      create: async (args: unknown) => {
        created.push((args as { data: Row }).data);
        return {};
      },
      update: async (args: unknown) => {
        const typed = args as { where: { findingKey: string }; data: Row };
        updated.push({ findingKey: typed.where.findingKey, data: typed.data });
        return {};
      },
    },
  };
  return { db, created, updated, runs };
}

describe("runDeadlineHorizonSweep", () => {
  it("produces a finding on the assurance ledger from a real recorded due date", async () => {
    const { db, created, runs } = fakeDb({
      obligations: [{
        obligationId: "OBL-ANNUAL-RETURN",
        title: "File the annual return",
        frequency: "annual",
        reviewDate: days(12),
        status: "active",
      }],
    });

    const result = await runDeadlineHorizonSweep(db, { now: NOW, runKey: "20260821000000" });

    expect(result.stoppedBy).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.created).toBe(1);

    // The run row is compliance-scoped and carries the shape it ran under.
    expect(runs).toHaveLength(1);
    expect(runs[0].scopeType).toBe(DEADLINE_HORIZON_SCOPE_TYPE);
    expect(runs[0].scopeId).toBe(DEADLINE_HORIZON_SCOPE_ID);
    expect(runs[0].buildId).toBeUndefined();
    expect((runs[0].summary as Row).shape).toBe("obligation-assurance-watch@1.0.0");
    expect((runs[0].summary as Row).trigger).toBe("deadline-horizon");

    // The finding is a real ledger row pointing at the record and the column.
    expect(created).toHaveLength(1);
    expect(created[0].findingKind).toBe("obligation-deadline");
    expect(created[0].affectedType).toBe("compliance-record");
    expect(created[0].affectedId).toBe("obligation:OBL-ANNUAL-RETURN");
    expect(created[0].adapterKey).toBe(DEADLINE_HORIZON_ADAPTER_KEY);
    expect(created[0].status).toBe("open");
    expect((created[0].evidence as Row).source).toBe("Obligation.reviewDate");
    expect((created[0].evidence as Row).reviewDate).toBe(days(12).toISOString());
    expect(created[0].assuranceRunId).toBe("run-row-1");
  });

  it("reconciles a finding whose due date has left the horizon", async () => {
    const { db, updated } = fakeDb({
      obligations: [{
        obligationId: "OBL-DONE",
        title: "Handled already",
        frequency: null,
        reviewDate: days(400), // pushed well beyond the horizon
        status: "active",
      }],
      existingFindings: [{ findingKey: "stale-key", status: "open", reopenCount: 0 }],
    });

    const result = await runDeadlineHorizonSweep(db, { now: NOW });

    expect(result.findings).toEqual([]);
    expect(result.reconciled).toBe(1);
    expect(updated).toHaveLength(1);
    expect(updated[0].findingKey).toBe("stale-key");
    expect(updated[0].data.status).toBe("resolved");
  });

  it("does NOT reconcile when the sweep failed to read the substrate", async () => {
    const { db, updated } = fakeDb({
      existingFindings: [{ findingKey: "stale-key", status: "open", reopenCount: 0 }],
    });

    const result = await runDeadlineHorizonSweep(db, { now: NOW });

    expect(result.stoppedBy?.kind).toBe("failure");
    // Resolving on an unread sweep would report compliance nobody observed.
    expect(result.reconciled).toBe(0);
    expect(updated).toEqual([]);
  });
});
