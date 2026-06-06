import { describe, expect, it, vi } from "vitest";

import {
  backlogOriginMarker,
  composeIngestBody,
  generateBacklogItemId,
  improvementCategoryToWorkType,
  ingestBacklogItem,
  validateIngestStatus,
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

describe("validateIngestStatus", () => {
  it("allows triaging with no outcome", () => expect(validateIngestStatus("triaging", null, null)).toBeNull());
  it("rejects non-triaging without an outcome", () =>
    expect(validateIngestStatus("open", null, null)).toMatch(/triageOutcome is required/));
  it("rejects triaging with an outcome", () =>
    expect(validateIngestStatus("triaging", "build", null)).toMatch(/must not be set/));
  it("requires effortSize for build", () =>
    expect(validateIngestStatus("open", "build", null)).toMatch(/effortSize is required/));
  it("accepts build with effortSize", () =>
    expect(validateIngestStatus("open", "build", "medium")).toBeNull());
});

// ─── Orchestrator (fake store, no DB) ─────────────────────────────────────────

function makeStore(overrides: Partial<IngestBacklogStore> = {}): {
  store: IngestBacklogStore;
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
} {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
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
        return { itemId: data.itemId as string };
      },
      ...(overrides.backlogItem ?? {}),
    },
    epic: {
      findFirst: async () => null,
      ...(overrides.epic ?? {}),
    },
  };
  return { store, created, updated };
}

describe("ingestBacklogItem", () => {
  it("creates a triaging item by default, with workType/source and the origin marker in the body", async () => {
    const { store, created } = makeStore();
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
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      status: "triaging",
      workType: "feature",
      source: "automated-detection",
      type: "portfolio",
    });
    expect(created[0].body).toContain("[origin:improvement:IP-6F240]");
    expect(created[0].triageOutcome).toBeUndefined();
    expect(indexKnowledge).toHaveBeenCalledOnce();
  });

  it("dedupes on the origin marker — bumps occurrence instead of creating a duplicate", async () => {
    const { store, created, updated } = makeStore({
      backlogItem: {
        findFirst: async () => ({ id: "cuid1", itemId: "BI-IMP-EXISTING" }),
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

    expect(result).toEqual({ itemId: "BI-IMP-EXISTING", created: false });
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0); // create path's update recorder unused; dedup update is in the override
  });

  it("resolves a semantic epic id to its cuid FK", async () => {
    const { store, created } = makeStore({
      epic: { findFirst: async () => ({ id: "epic-cuid-123" }) },
    });

    await ingestBacklogItem(
      {
        title: "Linked to an epic",
        workType: "feature",
        source: "user-request",
        epicId: "EP-INTAKE-UNIFY",
      },
      { store, indexKnowledge: () => {} },
    );

    expect(created[0].epicId).toBe("epic-cuid-123");
  });

  it("throws on an invalid status/outcome pairing rather than writing a bad row", async () => {
    const { store, created } = makeStore();
    await expect(
      ingestBacklogItem(
        { title: "bad", workType: "bug", source: "user-request", status: "open" },
        { store, indexKnowledge: () => {} },
      ),
    ).rejects.toThrow(/triageOutcome is required/);
    expect(created).toHaveLength(0);
  });
});
