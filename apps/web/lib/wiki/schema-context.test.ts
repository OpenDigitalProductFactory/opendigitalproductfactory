import { describe, expect, it, vi } from "vitest";
import {
  SCHEMA_PROMPT_PREAMBLE,
  formatExistingSlugsForPrompt,
  loadExistingSlugSnapshot,
  type ExistingSlugSnapshot,
} from "./schema-context";

describe("SCHEMA_PROMPT_PREAMBLE", () => {
  it("names every page kind the proposal pipeline is allowed to emit", () => {
    for (const kind of [
      "entity",
      "stance",
      "heuristic",
      "principle",
      "summary",
      "decision",
      "runbook",
    ]) {
      expect(SCHEMA_PROMPT_PREAMBLE).toContain(kind);
    }
  });

  it("instructs the model to NEVER propose the index kind", () => {
    expect(SCHEMA_PROMPT_PREAMBLE).toMatch(/index\b.*NEVER/i);
  });

  it("includes the canonical entity slugs", () => {
    expect(SCHEMA_PROMPT_PREAMBLE).toContain("entities/digital-product");
    expect(SCHEMA_PROMPT_PREAMBLE).toContain("entities/portfolio");
    expect(SCHEMA_PROMPT_PREAMBLE).toContain("entities/value-stream");
  });

  it("includes the JSON-only output instruction so the parser can rely on it", () => {
    expect(SCHEMA_PROMPT_PREAMBLE).toMatch(/Output only valid JSON/i);
  });
});

// ─── loadExistingSlugSnapshot ────────────────────────────────────────────────

function makePageMock(rows: Array<{
  slug: string;
  pageKind: string;
  organizationId: string | null;
  kernelPageId: string | null;
}>) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const db = { wikiPage: { findMany } };
  return { db, findMany };
}

describe("loadExistingSlugSnapshot", () => {
  it("returns all kernel slugs when organizationId is null and filters published rows", async () => {
    const { db, findMany } = makePageMock([
      { slug: "entities/digital-product", pageKind: "entity", organizationId: null, kernelPageId: null },
      { slug: "stances/it4it-is-substrate", pageKind: "stance", organizationId: null, kernelPageId: null },
    ]);

    const snapshot = await loadExistingSlugSnapshot(db, { organizationId: null });
    expect(findMany).toHaveBeenCalledWith({
      where: { status: "published", organizationId: null },
      select: { slug: true, pageKind: true, organizationId: true, kernelPageId: true },
    });
    expect(snapshot.all).toEqual([
      "entities/digital-product",
      "stances/it4it-is-substrate",
    ]);
    expect(snapshot.byKind.entity).toEqual(["entities/digital-product"]);
    expect(snapshot.byKind.stance).toEqual(["stances/it4it-is-substrate"]);
  });

  it("returns org + kernel rows when organizationId is set; overlay slug masks kernel slug", async () => {
    const { db } = makePageMock([
      { slug: "stances/it4it-is-substrate", pageKind: "stance", organizationId: null, kernelPageId: null },
      // Overlay row at the same slug — should mask the kernel one.
      { slug: "stances/it4it-is-substrate", pageKind: "stance", organizationId: "org_a", kernelPageId: "wp_kernel_1" },
      { slug: "entities/portfolio", pageKind: "entity", organizationId: null, kernelPageId: null },
    ]);

    const snapshot = await loadExistingSlugSnapshot(db, { organizationId: "org_a" });
    expect(snapshot.all).toEqual([
      "entities/portfolio",
      "stances/it4it-is-substrate",
    ]);
    // Sanity: the overlay flagged the slug as overlaid, so only one row appears
    // — the kernel duplicate is not double-counted.
    expect(snapshot.byKind.stance).toHaveLength(1);
  });

  it("omits scope filter when organizationId is undefined (maintainer mode)", async () => {
    const { db, findMany } = makePageMock([]);
    await loadExistingSlugSnapshot(db, {});
    expect(findMany).toHaveBeenCalledWith({
      where: { status: "published" },
      select: { slug: true, pageKind: true, organizationId: true, kernelPageId: true },
    });
  });

  it("partitions by kind and sorts within each kind for stable prompts", async () => {
    const { db } = makePageMock([
      { slug: "stances/zebra", pageKind: "stance", organizationId: null, kernelPageId: null },
      { slug: "stances/alpha", pageKind: "stance", organizationId: null, kernelPageId: null },
      { slug: "heuristics/middle", pageKind: "heuristic", organizationId: null, kernelPageId: null },
    ]);

    const snapshot = await loadExistingSlugSnapshot(db, { organizationId: null });
    expect(snapshot.byKind.stance).toEqual(["stances/alpha", "stances/zebra"]);
    expect(snapshot.byKind.heuristic).toEqual(["heuristics/middle"]);
  });

  it("ignores unknown page kinds (defensive against future schema additions)", async () => {
    const { db } = makePageMock([
      { slug: "future/thing", pageKind: "future-kind", organizationId: null, kernelPageId: null },
      { slug: "entities/digital-product", pageKind: "entity", organizationId: null, kernelPageId: null },
    ]);
    const snapshot = await loadExistingSlugSnapshot(db, { organizationId: null });
    expect(snapshot.all).toEqual([
      "entities/digital-product",
      "future/thing",
    ]);
    expect(snapshot.byKind.entity).toEqual(["entities/digital-product"]);
    // The unknown-kind slug never lands in any byKind bucket.
    for (const slugs of Object.values(snapshot.byKind)) {
      expect(slugs).not.toContain("future/thing");
    }
  });
});

describe("formatExistingSlugsForPrompt", () => {
  it("renders every kind, marking empty kinds explicitly", () => {
    const snapshot: ExistingSlugSnapshot = {
      all: ["entities/digital-product"],
      byKind: {
        entity: ["entities/digital-product"],
        stance: [],
        heuristic: [],
        principle: [],
        summary: [],
        decision: [],
        runbook: [],
      },
    };
    const formatted = formatExistingSlugsForPrompt(snapshot);
    expect(formatted).toContain("entity:");
    expect(formatted).toContain("- entities/digital-product");
    expect(formatted).toContain("stance (none yet):");
    expect(formatted).toContain("heuristic (none yet):");
    expect(formatted).toContain("principle (none yet):");
    expect(formatted).toContain("decision (none yet):");
    expect(formatted).toContain("runbook (none yet):");
  });
});
