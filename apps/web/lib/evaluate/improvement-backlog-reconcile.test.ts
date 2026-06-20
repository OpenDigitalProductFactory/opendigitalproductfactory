import { describe, expect, it, vi } from "vitest";

import {
  improvementBacklogBody,
  reconcileImprovementBacklog,
  type ReconcileStore,
} from "./improvement-backlog-reconcile";
import type { BacklogIngestInput } from "@/lib/operate/backlog-ingest";

// ─── Pure helper ──────────────────────────────────────────────────────────────

describe("improvementBacklogBody", () => {
  it("composes description + friction + category/severity + provenance line", () => {
    const body = improvementBacklogBody({
      proposalId: "IP-6F240",
      title: "Estate Specialist",
      description: "Auto-investigate unknown devices.",
      category: "missing_feature",
      severity: "medium",
      observedFriction: "A human had to investigate manually.",
      submittedById: "user-1",
    });
    expect(body).toBe(
      "Auto-investigate unknown devices.\n" +
        "Observed friction: A human had to investigate manually.\n" +
        "Category: missing_feature | Severity: medium\n" +
        "From improvement proposal IP-6F240",
    );
  });

  it("omits the friction line when there is none", () => {
    const body = improvementBacklogBody({
      proposalId: "IP-1",
      title: "t",
      description: "d",
      category: "process",
      severity: "low",
      observedFriction: null,
      submittedById: "u",
    });
    expect(body).not.toContain("Observed friction");
    expect(body).toContain("From improvement proposal IP-1");
  });
});

// ─── Reconcile orchestrator (fake store + fake ingest, no DB) ──────────────────

function makeStore(orphans: Array<Record<string, unknown>>): {
  store: ReconcileStore;
  findManyArgs: unknown[];
  updates: Array<{ where: unknown; data: Record<string, unknown> }>;
} {
  const findManyArgs: unknown[] = [];
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const store: ReconcileStore = {
    improvementProposal: {
      findMany: async (args) => {
        findManyArgs.push(args);
        return orphans as never;
      },
      update: async (args) => {
        updates.push(args as { where: unknown; data: Record<string, unknown> });
        return {};
      },
    },
  };
  return { store, findManyArgs, updates };
}

const ORPHAN = {
  proposalId: "IP-6F240",
  title: "Estate Specialist",
  description: "Auto-investigate unknown devices.",
  category: "missing_feature",
  severity: "medium",
  observedFriction: "A human had to investigate manually.",
  submittedById: "user-1",
};

describe("reconcileImprovementBacklog", () => {
  it("files each orphan through the shared front door and links it back", async () => {
    const { store, updates } = makeStore([ORPHAN]);
    const ingest = vi.fn(async (_input: BacklogIngestInput) => ({
      itemId: "BI-IMP-NEW001",
      id: "cuid-1",
      created: true,
    }));

    const result = await reconcileImprovementBacklog({ store, ingest });

    expect(result).toEqual({ filed: 1, itemIds: ["BI-IMP-NEW001"] });
    // Filed through ingest with the improvement origin + derived workType.
    expect(ingest).toHaveBeenCalledOnce();
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      title: "Estate Specialist",
      workType: "feature", // missing_feature → feature
      source: "automated-detection",
      itemIdPrefix: "IMP",
      submittedById: "user-1",
      origin: { kind: "improvement", id: "IP-6F240" },
    });
    // Linked back on the proposal.
    expect(updates).toEqual([
      { where: { proposalId: "IP-6F240" }, data: { backlogItemId: "BI-IMP-NEW001" } },
    ]);
  });

  it("queries only orphaned, non-rejected, non-skill proposals (the filter contract)", async () => {
    const { store, findManyArgs } = makeStore([]);
    await reconcileImprovementBacklog({ store, ingest: async () => ({ itemId: "x", id: "y", created: true }) });
    expect(findManyArgs[0]).toMatchObject({
      where: {
        backlogItemId: null,
        status: { not: "rejected" },
        category: { not: "skill" },
      },
    });
  });

  it("is a zero-write no-op when there are no orphans (idempotent after convergence)", async () => {
    const { store, updates } = makeStore([]);
    const ingest = vi.fn(async () => ({ itemId: "x", id: "y", created: true }));

    const result = await reconcileImprovementBacklog({ store, ingest });

    expect(result).toEqual({ filed: 0, itemIds: [] });
    expect(ingest).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("still links when the front door dedups to an existing item (created:false)", async () => {
    const { store, updates } = makeStore([ORPHAN]);
    const ingest = vi.fn(async () => ({ itemId: "BI-IMP-EXISTING", id: "cuid-e", created: false }));

    const result = await reconcileImprovementBacklog({ store, ingest });

    expect(result.filed).toBe(1);
    expect(updates[0]?.data).toEqual({ backlogItemId: "BI-IMP-EXISTING" });
  });

  it("files multiple orphans in order", async () => {
    const second = { ...ORPHAN, proposalId: "IP-0DCAC", category: "process" };
    const { store, updates } = makeStore([ORPHAN, second]);
    let n = 0;
    const ingest = vi.fn(async () => ({ itemId: `BI-IMP-${++n}`, id: `c-${n}`, created: true }));

    const result = await reconcileImprovementBacklog({ store, ingest });

    expect(result.itemIds).toEqual(["BI-IMP-1", "BI-IMP-2"]);
    expect(updates.map((u) => u.where)).toEqual([
      { proposalId: "IP-6F240" },
      { proposalId: "IP-0DCAC" },
    ]);
  });
});
