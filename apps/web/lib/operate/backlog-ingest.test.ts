import { describe, expect, it, vi } from "vitest";

import {
  backlogOriginMarker,
  composeIngestBody,
  generateBacklogItemId,
  improvementCategoryToWorkType,
  ingestBacklogItem,
  validateIngestInput,
  type IngestBacklogStore,
} from "./backlog-ingest";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe("backlogOriginMarker", () => {
  it("builds a stable, queryable marker", () => {
    expect(backlogOriginMarker("improvement", "IP-6F240")).toBe("[origin:improvement:IP-6F240]");
  });
});

describe("generateBacklogItemId", () => {
  it("uses BI- with an 8-char hex suffix when no prefix", () => {
    expect(generateBacklogItemId()).toMatch(/^BI-[0-9A-F]{8}$/);
  });
  it("inserts an uppercased prefix", () => {
    expect(generateBacklogItemId("imp")).toMatch(/^BI-IMP-[0-9A-F]{8}$/);
  });
});

describe("composeIngestBody", () => {
  it("returns the marker alone when there is no body", () => {
    expect(composeIngestBody(null, "[origin:x:1]")).toBe("[origin:x:1]");
  });
  it("appends the marker on its own paragraph", () => {
    expect(composeIngestBody("hello", "[origin:x:1]")).toBe("hello\n\n[origin:x:1]");
  });
  it("is idempotent — never double-appends an existing marker", () => {
    const once = composeIngestBody("hello", "[origin:x:1]");
    expect(composeIngestBody(once, "[origin:x:1]")).toBe(once);
  });
  it("returns the body unchanged when there is no marker", () => {
    expect(composeIngestBody("hello", null)).toBe("hello");
  });
  it("returns null when neither body nor marker", () => {
    expect(composeIngestBody("   ", null)).toBeNull();
  });
});

describe("improvementCategoryToWorkType", () => {
  it("maps skill", () => expect(improvementCategoryToWorkType("skill")).toBe("skill"));
  it("maps bug-ish categories to bug", () => {
    expect(improvementCategoryToWorkType("bug")).toBe("bug");
    expect(improvementCategoryToWorkType("broken_feature")).toBe("bug");
  });
  it("maps doc and tool", () => {
    expect(improvementCategoryToWorkType("doc-gap")).toBe("doc");
    expect(improvementCategoryToWorkType("missing_tool")).toBe("tool");
  });
  it("defaults missing_feature to feature", () => {
    expect(improvementCategoryToWorkType("missing_feature")).toBe("feature");
    expect(improvementCategoryToWorkType(null)).toBe("feature");
  });
});

describe("validateIngestInput", () => {
  it("accepts a valid triaging request", () =>
    expect(validateIngestInput({ workType: "feature", source: "automated-detection" })).toBeNull());
  it("rejects an unknown workType", () =>
    expect(validateIngestInput({ workType: "epic", source: "user-request" })).toMatch(/workType is required/));
  it("rejects an unknown source", () =>
    expect(validateIngestInput({ workType: "bug", source: "magic" })).toMatch(/source must be one of/));
  it("rejects a non-triaging status without an outcome", () =>
    expect(validateIngestInput({ workType: "bug", source: "user-request", status: "open" })).toMatch(
      /triageOutcome is required/,
    ));
  it("rejects triaging with an outcome", () =>
    expect(
      validateIngestInput({ workType: "bug", source: "user-request", status: "triaging", triageOutcome: "build" }),
    ).toMatch(/must not be set/));
  it("requires effortSize for build", () =>
    expect(
      validateIngestInput({ workType: "bug", source: "user-request", status: "open", triageOutcome: "build" }),
    ).toMatch(/effortSize is required/));
  it("rejects newly scoped demand that skips raw intake", () =>
    expect(
      validateIngestInput({
        workType: "feature",
        source: "user-request",
        organizationId: "org-1",
        businessProductId: "product-1",
        demandStage: "ready",
      }),
    ).toMatch(/must enter at raw/i));
});

// ─── Orchestrator (fake store, no DB) ─────────────────────────────────────────

function makeStore(overrides: Partial<IngestBacklogStore> = {}): {
  store: IngestBacklogStore;
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
} {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const store: IngestBacklogStore = {
    backlogItem: {
      findFirst: async () => null,
      update: async (args) => {
        updated.push((args as { data: Record<string, unknown> }).data);
        return {};
      },
      create: async (args) => {
        const data = (args as { data: Record<string, unknown> }).data;
        created.push(data);
        return { id: `cuid-${created.length}`, itemId: data.itemId as string };
      },
      ...(overrides.backlogItem ?? {}),
    },
    backlogItemActivity: {
      create: async (args) => {
        activities.push((args as { data: Record<string, unknown> }).data);
        return {};
      },
      ...(overrides.backlogItemActivity ?? {}),
    },
    epic: {
      findFirst: async () => null,
      ...(overrides.epic ?? {}),
    },
  };
  return { store, created, updated, activities };
}

describe("ingestBacklogItem", () => {
  it("creates a triaging item with workType/source, the origin marker, and an intake_origin activity", async () => {
    const { store, created, activities } = makeStore();
    const indexKnowledge = vi.fn();

    const result = await ingestBacklogItem(
      {
        title: "Auto-investigate unknown devices",
        body: "Two devices could not be classified.",
        workType: "feature",
        source: "automated-detection",
        itemIdPrefix: "IMP",
        origin: { kind: "improvement", id: "IP-6F240" },
      },
      { store, indexKnowledge },
    );

    expect(result.created).toBe(true);
    expect(result.itemId).toMatch(/^BI-IMP-/);
    expect(result.id).toBe("cuid-1");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      status: "triaging",
      workType: "feature",
      source: "automated-detection",
      type: "portfolio",
    });
    expect(created[0].body).toContain("[origin:improvement:IP-6F240]");
    expect(created[0].triageOutcome).toBeUndefined();
    // Provenance: a typed audit row, not just a body marker.
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      backlogItemId: "cuid-1",
      kind: "intake_origin",
      payload: { origin: { kind: "improvement", id: "IP-6F240" }, created: true, createdBy: "backlog-ingest" },
    });
    expect(indexKnowledge).toHaveBeenCalledOnce();
  });

  it("dedupes on the origin marker — bumps occurrence + writes a recurrence activity, no duplicate", async () => {
    const { store, created, activities } = makeStore({
      backlogItem: {
        findFirst: async () => ({ id: "cuid-existing", itemId: "BI-IMP-EXISTING" }),
        update: async () => ({}),
        create: async () => {
          throw new Error("should not create on dedup hit");
        },
      },
    });

    const result = await ingestBacklogItem(
      {
        title: "Same friction again",
        workType: "feature",
        source: "automated-detection",
        origin: { kind: "improvement", id: "IP-6F240" },
      },
      { store, indexKnowledge: () => {} },
    );

    // implementationCandidates is always present (BI-1A1EC5EC) and empty on the
    // dedup path: a recurrence of a known origin was already advised when the
    // item was first filed.
    expect(result).toEqual({
      itemId: "BI-IMP-EXISTING",
      id: "cuid-existing",
      created: false,
      implementationCandidates: [],
    });
    expect(created).toHaveLength(0);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      backlogItemId: "cuid-existing",
      kind: "intake_origin",
      payload: { created: false },
    });
  });

  it("uses an explicit itemId when provided and writes no activity without an origin", async () => {
    const { store, created, activities } = makeStore();
    const result = await ingestBacklogItem(
      { title: "Hand-filed", workType: "chore", source: "user-request", itemId: "BI-PORT-005" },
      { store, indexKnowledge: () => {} },
    );
    expect(result.itemId).toBe("BI-PORT-005");
    expect(created[0].itemId).toBe("BI-PORT-005");
    expect(activities).toHaveLength(0); // no origin → no intake_origin row
  });

  it("resolves a semantic epic id to its cuid FK", async () => {
    const { store, created } = makeStore({
      epic: { findFirst: async () => ({ id: "epic-cuid-123" }) },
    });

    await ingestBacklogItem(
      { title: "Linked to an epic", workType: "feature", source: "user-request", epicId: "EP-INTAKE-UNIFY" },
      { store, indexKnowledge: () => {} },
    );

    expect(created[0].epicId).toBe("epic-cuid-123");
  });

  it("classifies newly scoped product demand but leaves legacy intake untouched", async () => {
    const scoped = makeStore();
    await ingestBacklogItem(
      {
        title: "Improve private event bookings",
        type: "product",
        workType: "feature",
        source: "user-request",
        organizationId: "org-1",
        businessProductId: "product-events",
      },
      { store: scoped.store, indexKnowledge: () => {} },
    );

    expect(scoped.created[0]).toMatchObject({
      organizationId: "org-1",
      businessProductId: "product-events",
      demandStage: "raw",
    });
    expect(scoped.created[0]).not.toHaveProperty("digitalProductId");
    expect(scoped.activities).toEqual([
      expect.objectContaining({
        kind: "demand_classified",
        payload: { from: "unclassified", to: "raw", deterministic: true },
      }),
    ]);

    const legacy = makeStore();
    await ingestBacklogItem(
      {
        title: "Historical unscoped request",
        workType: "feature",
        source: "user-request",
      },
      { store: legacy.store, indexKnowledge: () => {} },
    );
    expect(legacy.created[0]).not.toHaveProperty("demandStage");
    expect(legacy.activities).toHaveLength(0);
  });

  it("throws on invalid input rather than writing a bad row", async () => {
    const { store, created } = makeStore();
    await expect(
      ingestBacklogItem(
        { title: "bad", workType: "bug", source: "user-request", status: "open" },
        { store, indexKnowledge: () => {} },
      ),
    ).rejects.toThrow(/triageOutcome is required/);
    expect(created).toHaveLength(0);
  });

  // ─── Implementation scan at filing time (BI-1A1EC5EC) ──────────────────────
  describe("implementation scan", () => {
    const REPO = ["scripts/build-docs-staleness.mjs", "apps/web/lib/finance/po-match.ts"];

    it("returns candidates and records them as an activity row", async () => {
      const { store, activities } = makeStore();

      const result = await ingestBacklogItem(
        {
          title: "Detect semantic doc staleness",
          workType: "feature",
          source: "user-request",
        },
        { store, indexKnowledge: () => {}, listRepoFiles: async () => REPO },
      );

      expect(result.implementationCandidates.map((c) => c.path)).toEqual([
        "scripts/build-docs-staleness.mjs",
      ]);
      // The advice must OUTLIVE the tool response. The failure being fixed is a
      // check whose output vanished when the call returned.
      const advisory = activities.find(
        (a) => (a.payload as { createdBy?: string } | undefined)?.createdBy === "implementation-scan",
      );
      expect(advisory).toBeDefined();
      expect(advisory?.summary).toContain("scripts/build-docs-staleness.mjs");
    });

    it("still files the item — the scan is advisory, never a block", async () => {
      const { store, created } = makeStore();

      const result = await ingestBacklogItem(
        { title: "Detect semantic doc staleness", workType: "feature", source: "user-request" },
        { store, indexKnowledge: () => {}, listRepoFiles: async () => REPO },
      );

      expect(result.created).toBe(true);
      expect(created).toHaveLength(1);
    });

    it("files normally when the inventory is unavailable", async () => {
      // A customer install ships no source checkout. Filing must not depend on it.
      const { store, created } = makeStore();

      const result = await ingestBacklogItem(
        { title: "Detect semantic doc staleness", workType: "feature", source: "user-request" },
        { store, indexKnowledge: () => {}, listRepoFiles: async () => [] },
      );

      expect(result.implementationCandidates).toEqual([]);
      expect(created).toHaveLength(1);
    });

    it("swallows a scan failure rather than failing the filing", async () => {
      const { store, created } = makeStore();

      const result = await ingestBacklogItem(
        { title: "Detect semantic doc staleness", workType: "feature", source: "user-request" },
        {
          store,
          indexKnowledge: () => {},
          listRepoFiles: async () => {
            throw new Error("disk gone");
          },
        },
      );

      expect(result.created).toBe(true);
      expect(result.implementationCandidates).toEqual([]);
      expect(created).toHaveLength(1);
    });

    it("writes no advisory row when nothing matches", async () => {
      const { store, activities } = makeStore();

      await ingestBacklogItem(
        { title: "Add a payroll remittance ledger", workType: "feature", source: "user-request" },
        { store, indexKnowledge: () => {}, listRepoFiles: async () => REPO },
      );

      expect(
        activities.filter(
          (a) => (a.payload as { createdBy?: string } | undefined)?.createdBy === "implementation-scan",
        ),
      ).toHaveLength(0);
    });
  });
});
