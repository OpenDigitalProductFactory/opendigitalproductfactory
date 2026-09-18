import { describe, expect, it } from "vitest";
import { WorkroomObservations } from "./observation-pages";

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({
  capsuleId: `WC-${i}`, title: "😀\"\\".repeat(300), status: "ready",
  liveness: "no-signal", isLive: false, isReapable: true,
  recovery: { state: "blocked", arbitrary: "x".repeat(10000) },
}));
const identity = { principal: "user-1", authority: "read-grant", filters: {} };

describe("bounded Workroom observations", () => {
  it("traverses 251 observed IDs once, preserving typed rows and continuation within the actual envelope budget", () => {
    const store = new WorkroomObservations();
    const source = rows(251);
    let page = store.capture(source, identity, { limit: 17 });
    source.splice(0, 20);
    const seen: string[] = [];
    for (;;) {
      expect(Buffer.byteLength(JSON.stringify(page, null, 2))).toBeLessThanOrEqual(4000);
      expect(page.success).toBe(true);
      seen.push(...page.data.capsules.map((r: any) => r.capsuleId));
      expect(page.data.page.populationCount).toBe(251);
      if (!page.data.page.nextCursor) break;
      const cursor = page.data.page.nextCursor;
      page = store.resume(cursor, identity);
      expect(store.resume(cursor, identity)).toEqual(page);
    }
    expect(seen).toEqual(rows(251).map(r => r.capsuleId));
  });

  it("rejects foreign, modified and changed-authority continuations", () => {
    const store = new WorkroomObservations();
    const cursor = store.capture(rows(10), identity, { limit: 1 }).data.page.nextCursor!;
    for (const other of [{ ...identity, principal: "user-2" }, { ...identity, authority: "revoked" }, { ...identity, filters: { staleOnly: true } }]) {
      expect(() => store.resume(cursor, other)).toThrow("cursor_authority_mismatch");
    }
    expect(() => store.resume(cursor + "x", identity)).toThrow("invalid_cursor");
    expect(() => store.resume("x".repeat(4097), identity)).toThrow("invalid_cursor");
  });

  it("does not let a caller mutate the retained observation through a returned page", () => {
    const store = new WorkroomObservations();
    const cursor = store.capture(rows(4), identity, { limit: 1 }).data.page.nextCursor!;
    const page = store.resume(cursor, identity);
    page.data.capsules[0]!.capsuleId = "changed";
    expect(store.resume(cursor, identity).data.capsules[0]!.capsuleId).toBe("WC-1");
  });

  it("expires snapshots and returns a finite restart after process replacement or eviction", () => {
    let now = 1000;
    const store = new WorkroomObservations({ now: () => now });
    const cursor = store.capture(rows(3), identity, { limit: 1 }).data.page.nextCursor!;
    expect(() => new WorkroomObservations().resume(cursor, identity)).toThrow(/snapshot_unavailable|invalid_cursor/);
    now += 300001;
    expect(() => store.resume(cursor, identity)).toThrow("snapshot_expired");
    const old = store.capture(rows(3), identity, { limit: 1 }).data.page.nextCursor!;
    store.capture(rows(3), identity, { limit: 1 });
    store.capture(rows(3), identity, { limit: 1 });
    expect(() => store.resume(old, identity)).toThrow("snapshot_unavailable");
  });

  it("refuses oversized populations and unsupported envelope budgets rather than claiming a prefix is complete", () => {
    const store = new WorkroomObservations();
    expect(() => store.capture(rows(10001), identity)).toThrow("snapshot_capacity_exceeded");
    expect(() => store.capture(rows(1), identity, { maxChars: 30 })).toThrow("page_budget_too_small");
    const empty = store.capture([], identity);
    expect(empty.data.page).toMatchObject({ populationCount: 0, pageCount: 0, nextCursor: null, disposition: "complete" });
  });
});
