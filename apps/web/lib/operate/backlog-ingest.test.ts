import { describe, expect, it, vi } from "vitest";

import {
  backlogOriginMarker,
  composeIngestBody,
  generateBacklogItemId,
  improvementCategoryToWorkType,
  ingestBacklogItem,
  parseGithubIssueUrl,
  qualifiedIssueOriginId,
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

      expect((result.implementationCandidates ?? []).map((c) => c.path)).toEqual([
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

// ─── Repository-qualified origin reconciliation (BI-952F08BA, spec §6.1) ─────
//
// An in-memory store that answers the queries the front door issues, so these
// cases exercise the real dedupe predicate rather than a canned findFirst.

interface MemItem {
  id: string;
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  occurrenceCount: number;
}

function memoryStore(seed: Array<Partial<MemItem> & { itemId: string }>, seedActivities: Array<Record<string, unknown>> = []) {
  const items: MemItem[] = seed.map((s, i) => ({
    id: s.id ?? `cuid-seed-${i + 1}`,
    title: s.title ?? "Seeded",
    body: s.body ?? null,
    status: s.status ?? "triaging",
    occurrenceCount: s.occurrenceCount ?? 1,
    itemId: s.itemId,
  }));
  const activities: Array<Record<string, unknown>> = [...seedActivities];
  const itemWrites: Array<Record<string, unknown>> = [];
  const matches = (item: MemItem, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    const body = where.body as { contains?: string } | undefined;
    if (body?.contains && !(item.body ?? "").includes(body.contains)) return false;
    const status = where.status as { notIn?: string[]; in?: readonly string[] } | undefined;
    if (status?.notIn && status.notIn.includes(item.status)) return false;
    if (status?.in && !status.in.includes(item.status)) return false;
    return true;
  };
  const store: IngestBacklogStore = {
    backlogItem: {
      findFirst: async (args) => {
        const where = (args as { where?: Record<string, unknown> }).where;
        const hit = [...items].reverse().find((i) => matches(i, where));
        return hit ? { id: hit.id, itemId: hit.itemId } : null;
      },
      findMany: async (args) => {
        const where = (args as { where?: Record<string, unknown> }).where;
        return items.filter((i) => matches(i, where)).map((i) => ({ ...i }));
      },
      update: async (args) => {
        const { where, data } = args as { where: { id: string }; data: Record<string, unknown> };
        itemWrites.push({ id: where.id, ...data });
        const item = items.find((i) => i.id === where.id);
        if (item && data.occurrenceCount) item.occurrenceCount += 1;
        if (item && typeof data.status === "string") item.status = data.status;
        return {};
      },
      create: async (args) => {
        const data = (args as { data: Record<string, unknown> }).data;
        const row: MemItem = {
          id: `cuid-new-${items.length + 1}`,
          itemId: data.itemId as string,
          title: data.title as string,
          body: (data.body as string | undefined) ?? null,
          status: data.status as string,
          occurrenceCount: 1,
        };
        items.push(row);
        return { id: row.id, itemId: row.itemId };
      },
    },
    backlogItemActivity: {
      create: async (args) => {
        activities.push({ recordedAt: new Date(Date.now() + activities.length), ...(args as { data: Record<string, unknown> }).data });
        return {};
      },
      findMany: async (args) => {
        const where = (args as { where?: { backlogItemId?: string; kind?: string } }).where ?? {};
        return activities
          .filter((a) => (!where.backlogItemId || a.backlogItemId === where.backlogItemId)
            && (!where.kind || a.kind === where.kind))
          .slice()
          .reverse()
          .map((a) => ({ payload: a.payload, summary: a.summary }));
      },
    },
    epic: { findFirst: async () => null },
  };
  return { store, items, activities, itemWrites };
}

const REPO = "opendigitalproductfactory/opendigitalproductfactory";
const issueUrl = (n: number, repo = "OpenDigitalProductFactory/opendigitalproductfactory") =>
  `https://github.com/${repo}/issues/${n}`;

function issueInput(n: number, overrides: {
  repository?: string;
  url?: string;
  state?: string;
  fingerprint?: string;
  title?: string;
} = {}): Parameters<typeof ingestBacklogItem>[0] {
  const repository = overrides.repository ?? REPO;
  const url = overrides.url ?? issueUrl(n);
  return {
    title: overrides.title ?? `Issue ${n}`,
    body: `Summary of ${n}\n\n- ${url}`,
    workType: "bug",
    source: "user-request",
    origin: { kind: "ecosystem-upstream-issue", id: `${repository}#${n}` },
    reconcile: {
      repository,
      sourceUrl: url,
      state: overrides.state ?? "open",
      fingerprint: overrides.fingerprint ?? "fp-1",
      legacyId: String(n),
    },
  };
}

const quiet = { indexKnowledge: () => {}, listRepoFiles: async () => [] as string[], searchSimilarItems: async () => ({ status: "ok", results: [] }) };

describe("ingestBacklogItem — repository-qualified origin reconciliation (BI-952F08BA)", () => {
  it("exports a qualified marker helper keyed on repository and number", () => {
    expect(qualifiedIssueOriginId("OpenDigitalProductFactory/OpenDigitalProductFactory", 12)).toBe(`${REPO}#12`);
    expect(parseGithubIssueUrl(issueUrl(4563))).toEqual({ repository: REPO, number: 4563 });
    expect(parseGithubIssueUrl("https://example.test/i/4563")).toBeNull();
  });

  it("creates once, writing repository and source URL into the intake_origin payload", async () => {
    const mem = memoryStore([]);
    const result = await ingestBacklogItem(issueInput(7), { store: mem.store, ...quiet });
    expect(result).toMatchObject({ created: true, outcome: "created" });
    expect(mem.items[0].body).toContain(`[origin:ecosystem-upstream-issue:${REPO}#7]`);
    expect(mem.activities[0]).toMatchObject({
      kind: "intake_origin",
      payload: {
        origin: { kind: "ecosystem-upstream-issue", id: `${REPO}#7` },
        created: true,
        source: { repository: REPO, url: issueUrl(7), state: "open", fingerprint: "fp-1" },
      },
    });
  });

  it("a repeat poll of an open item changes no count and creates no item", async () => {
    const mem = memoryStore([]);
    await ingestBacklogItem(issueInput(7), { store: mem.store, ...quiet });
    const second = await ingestBacklogItem(issueInput(7), { store: mem.store, ...quiet });
    const third = await ingestBacklogItem(issueInput(7), { store: mem.store, ...quiet });
    expect(second).toMatchObject({ created: false, outcome: "unchanged", itemId: mem.items[0].itemId });
    expect(third.outcome).toBe("unchanged");
    expect(mem.items).toHaveLength(1);
    expect(mem.items[0].occurrenceCount).toBe(1);
    expect(mem.itemWrites).toEqual([]);
    expect(mem.activities).toHaveLength(1);
  });

  it.each(["deferred", "done", "retired"])("a repeat poll of a %s item creates nothing and leaves its status", async (status) => {
    const mem = memoryStore([{
      itemId: "BI-TERMINAL",
      status,
      body: `Summary\n\n- ${issueUrl(7)}\n\n[origin:ecosystem-upstream-issue:${REPO}#7]`,
    }], [{ backlogItemId: "cuid-seed-1", kind: "intake_origin", payload: { source: { fingerprint: "fp-1", state: "open" } } }]);
    const result = await ingestBacklogItem(issueInput(7), { store: mem.store, ...quiet });
    expect(result).toMatchObject({ created: false, outcome: "unchanged", itemId: "BI-TERMINAL" });
    expect(mem.items).toHaveLength(1);
    expect(mem.items[0].status).toBe(status);
    expect(mem.itemWrites).toEqual([]);
  });

  it("issue #4563: a retired legacy intake is matched, not re-created (BI-EADA73BA → BI-41C048D8 defect)", async () => {
    const mem = memoryStore([{
      itemId: "BI-EADA73BA",
      status: "retired",
      body: `Original report\n\n- Submitted by install \`dpf-agent-1\`\n- ${issueUrl(4563)}\n\n[origin:ecosystem-upstream-issue:4563]`,
    }]);
    const result = await ingestBacklogItem(issueInput(4563), { store: mem.store, ...quiet });
    expect(result).toMatchObject({ created: false, itemId: "BI-EADA73BA" });
    expect(mem.items).toHaveLength(1);
    expect(mem.items[0].status).toBe("retired");
    expect(mem.items[0].occurrenceCount).toBe(1);
  });

  it("the same issue number in two repositories files two distinct items", async () => {
    const mem = memoryStore([]);
    const a = await ingestBacklogItem(issueInput(12), { store: mem.store, ...quiet });
    const b = await ingestBacklogItem(
      issueInput(12, { repository: "someone/fork", url: issueUrl(12, "someone/fork") }),
      { store: mem.store, ...quiet },
    );
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.itemId).not.toBe(b.itemId);
    expect(mem.items).toHaveLength(2);
  });

  it("matches a legacy unqualified marker whose stored URL is the same repository and records one mapping", async () => {
    const mem = memoryStore([{
      itemId: "BI-LEGACY",
      status: "open",
      body: `Old body\n\n- ${issueUrl(30)}\n\n[origin:ecosystem-upstream-issue:30]`,
    }]);
    const first = await ingestBacklogItem(issueInput(30), { store: mem.store, ...quiet });
    const second = await ingestBacklogItem(issueInput(30), { store: mem.store, ...quiet });
    expect(first).toMatchObject({ created: false, outcome: "unchanged", itemId: "BI-LEGACY" });
    expect(second).toMatchObject({ created: false, outcome: "unchanged", itemId: "BI-LEGACY" });
    const mappings = mem.activities.filter((a) => (a.payload as { mapping?: unknown }).mapping);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      backlogItemId: "cuid-seed-1",
      kind: "intake_origin",
      payload: {
        mapping: {
          from: { kind: "ecosystem-upstream-issue", id: "30" },
          to: { kind: "ecosystem-upstream-issue", id: `${REPO}#30` },
        },
      },
    });
    expect(mem.items).toHaveLength(1);
    expect(mem.itemWrites).toEqual([]);
  });

  it("does not match a legacy marker whose stored URL is a different repository", async () => {
    const mem = memoryStore([{
      itemId: "BI-OTHER-REPO",
      status: "open",
      body: `Old body\n\n- ${issueUrl(30, "someone/fork")}\n\n[origin:ecosystem-upstream-issue:30]`,
    }]);
    const result = await ingestBacklogItem(issueInput(30), { store: mem.store, ...quiet });
    expect(result).toMatchObject({ created: true, outcome: "created" });
    expect(result.itemId).not.toBe("BI-OTHER-REPO");
    expect(mem.items).toHaveLength(2);
    expect(mem.activities.some((a) => (a.payload as { mapping?: unknown }).mapping)).toBe(false);
  });

  it("stops for review when a legacy marker's repository cannot be resolved", async () => {
    const mem = memoryStore([{
      itemId: "BI-NO-URL",
      status: "open",
      body: "Old body with no link\n\n[origin:ecosystem-upstream-issue:30]",
    }]);
    const result = await ingestBacklogItem(issueInput(30), { store: mem.store, ...quiet });
    expect(result).toMatchObject({ created: false, outcome: "needs-review", reviewCandidates: ["BI-NO-URL"] });
    expect(mem.items).toHaveLength(1);
    expect(mem.activities).toHaveLength(0);
    expect(mem.itemWrites).toEqual([]);
  });

  it("stops for review when more than one item claims the same origin (retired then re-created)", async () => {
    const mem = memoryStore([
      { itemId: "BI-EADA73BA", status: "retired", body: `- ${issueUrl(4563)}\n\n[origin:ecosystem-upstream-issue:4563]` },
      { itemId: "BI-41C048D8", status: "triaging", body: `- ${issueUrl(4563)}\n\n[origin:ecosystem-upstream-issue:4563]` },
    ]);
    const result = await ingestBacklogItem(issueInput(4563), { store: mem.store, ...quiet });
    expect(result.outcome).toBe("needs-review");
    expect(result.reviewCandidates?.sort()).toEqual(["BI-41C048D8", "BI-EADA73BA"]);
    expect(mem.items).toHaveLength(2);
    expect(mem.items.map((i) => i.status)).toEqual(["retired", "triaging"]);
    expect(mem.activities).toHaveLength(0);
  });

  it.each([
    ["an edit", { fingerprint: "fp-2" }, "edited"],
    ["a closure", { fingerprint: "fp-closed", state: "closed" }, "closed"],
  ])("records %s as one change event on the same item", async (_label, change, kind) => {
    const mem = memoryStore([]);
    await ingestBacklogItem(issueInput(9), { store: mem.store, ...quiet });
    const changed = await ingestBacklogItem(issueInput(9, change), { store: mem.store, ...quiet });
    const again = await ingestBacklogItem(issueInput(9, change), { store: mem.store, ...quiet });
    expect(changed).toMatchObject({ created: false, outcome: "changed", itemId: mem.items[0].itemId });
    expect(again.outcome).toBe("unchanged");
    const events = mem.activities.filter((a) => (a.payload as { change?: unknown }).change);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ backlogItemId: mem.items[0].id, payload: { change: { kind } } });
    expect(mem.items).toHaveLength(1);
    expect(mem.itemWrites).toEqual([]);
  });

  it("records a reopen on a done item as one change event without reopening the item", async () => {
    const mem = memoryStore([{
      itemId: "BI-DONE",
      status: "done",
      body: `- ${issueUrl(9)}\n\n[origin:ecosystem-upstream-issue:${REPO}#9]`,
    }], [{ backlogItemId: "cuid-seed-1", kind: "intake_origin", payload: { source: { fingerprint: "fp-closed", state: "closed" } } }]);
    const result = await ingestBacklogItem(issueInput(9, { fingerprint: "fp-open", state: "open" }), { store: mem.store, ...quiet });
    expect(result).toMatchObject({ created: false, outcome: "changed", itemId: "BI-DONE" });
    const events = mem.activities.filter((a) => (a.payload as { change?: unknown }).change);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ payload: { change: { kind: "reopened", fromState: "closed", toState: "open" } } });
    expect(mem.items[0].status).toBe("done");
    expect(mem.itemWrites).toEqual([]);
  });

  it("leaves other detectors' occurrence counting unchanged", async () => {
    const mem = memoryStore([{ itemId: "BI-IMP-1", status: "open", body: "x\n\n[origin:improvement:IP-1]" }]);
    const result = await ingestBacklogItem(
      { title: "Same friction", workType: "feature", source: "automated-detection", origin: { kind: "improvement", id: "IP-1" } },
      { store: mem.store, ...quiet },
    );
    expect(result).toMatchObject({ created: false, outcome: "recurred", itemId: "BI-IMP-1" });
    expect(mem.items[0].occurrenceCount).toBe(2);
  });
});
