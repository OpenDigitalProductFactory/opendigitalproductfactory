import { beforeEach, describe, expect, it, vi } from "vitest";

import registry from "../../../../../packages/db/data/agent_registry.json";

const mocks = vi.hoisted(() => ({
  loadSource: vi.fn(),
  latestRun: vi.fn(),
  writeAttempts: [] as string[],
}));

vi.mock("@/lib/contributor-change-lanes/read-model", () => ({
  loadContributorInventorySource: (...a: unknown[]) => mocks.loadSource(...a),
}));

// Advise-safety: the only database surface the handlers get is a read. Any
// other method on any model is recorded as a write attempt and throws.
vi.mock("@dpf/db", () => {
  const readOnly = (model: string, reads: Record<string, unknown>) =>
    new Proxy(reads, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return () => {
          mocks.writeAttempts.push(`${model}.${prop}`);
          throw new Error(`write attempted: ${model}.${prop}`);
        };
      },
    });
  return {
    prisma: new Proxy(
      {},
      {
        get(_t, model: string) {
          if (model === "contributorInventorySyncRun") {
            return readOnly(model, { findFirst: (...a: unknown[]) => mocks.latestRun(...a) });
          }
          return readOnly(model, {});
        },
      },
    ),
  };
});

import { HARDCODED_COWORKER_GRANTS } from "@dpf/db/workforce-seed";
import { COWORKER_READ_BASELINE_GRANTS, isToolAllowedByGrants, TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import { contributorInventoryPack } from "./contributor-inventory-pack";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const GRANT = "contributor_inventory_read";

function fresh(source: string, count: number, state = "ok") {
  return { source, state, fetchedAt: new Date("2026-10-01T11:55:00.000Z"), message: null, count };
}

function pr(number: number, state: "open" | "merged" | "closed", updatedAt: string, extra: Record<string, unknown> = {}) {
  return {
    number,
    url: `https://example.test/pull/${number}`,
    title: `change ${number}`,
    headBranch: `feat/change-${number}`,
    headSha: "deadbeef",
    state,
    isDraft: false,
    mergeStateStatus: state === "open" ? "CLEAN" : null,
    providerUpdatedAt: updatedAt,
    observedAt: "2026-10-01T11:55:00.000Z",
    observationFingerprint: "fp",
    ...extra,
  };
}

const call = (tool: string, params: Record<string, unknown> = {}) =>
  contributorInventoryPack.handlers[tool]!(params, "user_test");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAttempts.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("contributor-inventory pack — registration and grants", () => {
  it("registers two read-only tools with handlers", () => {
    expect(contributorInventoryPack.definitions.map((d) => d.name).sort()).toEqual([
      "list_pull_requests",
      "read_contributor_inventory",
    ]);
    for (const def of contributorInventoryPack.definitions) {
      expect(def.sideEffect, def.name).toBe(false);
      expect(def.annotations?.readOnlyHint, def.name).toBe(true);
      expect(def.annotations?.destructiveHint, def.name).toBe(false);
      expect(def.consequence, def.name).toBeUndefined();
      expect(contributorInventoryPack.handlers[def.name], def.name).toBeTypeOf("function");
      expect(def.description, def.name).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("gates both tools on contributor_inventory_read and mirrors the shared grant map", () => {
    for (const name of ["list_pull_requests", "read_contributor_inventory"]) {
      expect(contributorInventoryPack.grants[name], name).toEqual([GRANT]);
      expect(TOOL_TO_GRANTS[name], name).toEqual([GRANT]);
      expect(isToolAllowedByGrants(name, [GRANT]), name).toBe(true);
      // Not reachable through the read baseline every coworker holds.
      expect(isToolAllowedByGrants(name, [...COWORKER_READ_BASELINE_GRANTS]), name).toBe(false);
      expect(isToolAllowedByGrants(name, ["admin_write"]), name).toBe(false);
    }
  });

  it("is held only by the accountable agents of the stages that read it, in both grant sources", () => {
    const seedHolders = Object.entries(HARDCODED_COWORKER_GRANTS)
      .filter(([, grants]) => grants.includes(GRANT))
      .map(([slug]) => slug)
      .sort();
    expect(seedHolders).toEqual(["change-reviewer", "platform-engineer"]);
    const registryHolders = (registry as { agents: Array<{ agent_name?: string; config_profile?: { tool_grants?: string[] } }> }).agents
      .filter((a) => a.config_profile?.tool_grants?.includes(GRANT))
      .map((a) => a.agent_name)
      .sort();
    expect(registryHolders).toEqual(["change-reviewer", "platform-engineer"]);
  });
});

describe("list_pull_requests", () => {
  it("defaults to open pull requests, newest update first, with compact fields only", async () => {
    mocks.loadSource.mockResolvedValue({
      rows: [
        pr(1, "open", "2026-09-28T10:00:00Z"),
        pr(2, "merged", "2026-09-30T10:00:00Z"),
        pr(3, "open", "2026-09-30T09:00:00Z", { isDraft: true, mergeStateStatus: "DIRTY" }),
      ],
      freshness: fresh("github-pr", 3),
    });

    const res = await call("list_pull_requests");

    expect(mocks.loadSource).toHaveBeenCalledWith("github-pr");
    expect(res.success).toBe(true);
    const data = res.data as { items: Array<Record<string, unknown>>; totalMatching: number };
    expect(data.items.map((i) => i.number)).toEqual([3, 1]);
    expect(data.totalMatching).toBe(2);
    expect(Object.keys(data.items[0]!).sort()).toEqual(
      ["headBranch", "isDraft", "mergeStateStatus", "number", "state", "title", "updatedAt", "url"].sort(),
    );
    expect(data.items[0]).toMatchObject({ isDraft: true, mergeStateStatus: "DIRTY", updatedAt: "2026-09-30T09:00:00Z" });
    expect(mocks.writeAttempts).toEqual([]);
  });

  it("filters by state and by updated-since", async () => {
    mocks.loadSource.mockResolvedValue({
      rows: [
        pr(1, "open", "2026-09-01T10:00:00Z"),
        pr(2, "merged", "2026-09-30T10:00:00Z"),
        pr(3, "closed", "2026-09-29T10:00:00Z"),
      ],
      freshness: fresh("github-pr", 3),
    });

    const merged = await call("list_pull_requests", { state: "merged" });
    expect((merged.data as { items: Array<{ number: number }> }).items.map((i) => i.number)).toEqual([2]);

    const recent = await call("list_pull_requests", { state: "all", updatedSince: "2026-09-15" });
    expect((recent.data as { items: Array<{ number: number }> }).items.map((i) => i.number)).toEqual([2, 3]);
  });

  it("refuses an unreadable updatedSince or an unknown state rather than guessing", async () => {
    mocks.loadSource.mockResolvedValue({ rows: [], freshness: fresh("github-pr", 0) });
    expect((await call("list_pull_requests", { updatedSince: "last tuesday" })).success).toBe(false);
    expect((await call("list_pull_requests", { state: "draft" })).success).toBe(false);
  });

  it("defaults to a small page and caps the limit", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => pr(i + 1, "open", `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`));
    mocks.loadSource.mockResolvedValue({ rows, freshness: fresh("github-pr", 150) });

    const dflt = (await call("list_pull_requests")).data as { items: unknown[]; totalMatching: number; truncated: boolean };
    expect(dflt.items).toHaveLength(20);
    expect(dflt.totalMatching).toBe(150);
    expect(dflt.truncated).toBe(true);

    const capped = (await call("list_pull_requests", { limit: 5000 })).data as { items: unknown[] };
    expect(capped.items).toHaveLength(100);
  });

  it("returns an explicit empty result when nothing matches", async () => {
    mocks.loadSource.mockResolvedValue({ rows: [pr(1, "merged", "2026-09-01T00:00:00Z")], freshness: fresh("github-pr", 1) });

    const res = await call("list_pull_requests");

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ items: [], totalMatching: 0 });
    expect((res.data as { note: string }).note).toMatch(/No open pull requests/);
  });

  it("says the forge inventory is not connected, never that the queue is clear", async () => {
    mocks.loadSource.mockResolvedValue({
      rows: [],
      freshness: { ...fresh("github-pr", 0, "not-configured"), message: "GitHub not connected" },
    });

    const res = await call("list_pull_requests");

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ items: [], freshness: { state: "not-configured" } });
    expect((res.data as { note: string }).note).toMatch(/not.*clear|unknown/i);
  });

  it("fails when the inventory itself cannot be read", async () => {
    mocks.loadSource.mockResolvedValue({ rows: [], freshness: { ...fresh("github-pr", 0, "error"), message: "db down" } });

    const res = await call("list_pull_requests");

    expect(res.success).toBe(false);
    expect(res.error).toBe("inventory_read_failed");
  });
});

describe("read_contributor_inventory", () => {
  function primeInventory() {
    mocks.latestRun.mockResolvedValue({
      syncRunId: "civs-9",
      status: "completed",
      startedAt: new Date("2026-10-01T11:54:00.000Z"),
      completedAt: new Date("2026-10-01T11:55:00.000Z"),
      triggeredBy: "cron",
    });
    mocks.loadSource.mockImplementation(async (source: string) => {
      if (source === "git-branch") {
        return {
          rows: [
            { name: "feat/a", headSha: "a", remote: "origin", isMerged: false, lastCommitAt: "2026-09-30T00:00:00.000Z" },
            { name: "feat/b", headSha: "b", remote: "origin", isMerged: true, lastCommitAt: "2026-06-01T00:00:00.000Z" },
            { name: "feat/c", headSha: "c", remote: "local", isMerged: false, lastCommitAt: "2026-09-29T00:00:00.000Z" },
          ],
          freshness: fresh("git-branch", 3),
        };
      }
      if (source === "git-worktree") {
        return { rows: [{ path: "/wt/a", branch: "feat/a", headSha: "a", isRegistered: true }], freshness: fresh("git-worktree", 1) };
      }
      return {
        rows: [pr(1, "open", "2026-09-30T00:00:00Z"), pr(2, "merged", "2026-08-01T00:00:00Z")],
        freshness: fresh("github-pr", 2),
      };
    });
  }

  it("summarizes counts per kind, the latest sync, and recent activity", async () => {
    primeInventory();

    const res = await call("read_contributor_inventory", { activeWithinDays: 14 });

    expect(res.success).toBe(true);
    const data = res.data as Record<string, any>;
    expect(data.latestSync).toMatchObject({ syncRunId: "civs-9", status: "completed", completedAt: "2026-10-01T11:55:00.000Z" });
    expect(data.sources).toEqual([
      expect.objectContaining({ source: "git-branch", state: "ok", count: 3, recentlyActive: 2 }),
      expect.objectContaining({ source: "git-worktree", state: "ok", count: 1 }),
      expect.objectContaining({ source: "github-pr", state: "ok", count: 2, recentlyActive: 1 }),
    ]);
    expect(data.pullRequestsByState).toEqual({ open: 1, merged: 1, closed: 0 });
    expect(mocks.writeAttempts).toEqual([]);
  });

  it("states that contributor identity, sign-off and licence facts are not recorded, so they report as unknown", async () => {
    primeInventory();

    const data = (await call("read_contributor_inventory")).data as { contributorFacts: { recorded: boolean; note: string } };

    expect(data.contributorFacts.recorded).toBe(false);
    expect(data.contributorFacts.note).toMatch(/sign-off/);
    expect(data.contributorFacts.note).toMatch(/unknown/);
  });

  it("pages the rows of one source, most recent first, with a capped limit", async () => {
    primeInventory();

    const page = (await call("read_contributor_inventory", { source: "git-branch", limit: 1, offset: 1 })).data as Record<string, any>;
    expect(page.rows).toEqual({
      source: "git-branch",
      offset: 1,
      limit: 1,
      total: 3,
      items: [expect.objectContaining({ name: "feat/c" })],
    });

    const capped = (await call("read_contributor_inventory", { source: "git-branch", limit: 999 })).data as Record<string, any>;
    expect(capped.rows.limit).toBe(100);
  });

  it("returns an explicit empty result before any inventory is recorded", async () => {
    mocks.latestRun.mockResolvedValue(null);
    mocks.loadSource.mockImplementation(async (source: string) => ({
      rows: [],
      freshness: { ...fresh(source, 0, "warming-up"), message: "Syncing" },
    }));

    const res = await call("read_contributor_inventory");

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ items: [], latestSync: null });
    expect((res.data as { note: string }).note).toMatch(/No contributor inventory has been recorded/);
  });

  it("refuses an unknown source", async () => {
    primeInventory();
    expect((await call("read_contributor_inventory", { source: "people" })).success).toBe(false);
  });
});
