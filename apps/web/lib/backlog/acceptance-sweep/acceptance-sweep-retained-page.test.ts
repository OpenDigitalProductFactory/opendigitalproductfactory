import { describe, expect, it, vi } from "vitest";
import { selectAcceptanceSweepPage } from "./acceptance-sweep-page";

const pending = { to: "done", closureBasis: "canonical-deployment", acceptanceObligation: "pending-independent-verification" };
function row(id: string, status = "awaiting-acceptance", payload: unknown = pending) {
  return { id, itemId: `BI-${id}`, status, claimedByAgentId: null, agentId: null,
    activities: [{ kind: "status_change", recordedAt: new Date("2026-10-01T00:00:00Z"), payload }] };
}
function fixture(rows: ReturnType<typeof row>[]) {
  return { backlogItem: { findMany: vi.fn(async (args: { where: { status?: string; activities?: { some?: unknown; none?: unknown }; id?: { gt?: string; lte?: string; notIn?: string[] } }; take: number }) => {
    const id = args.where.id;
    return rows.filter(r => (!args.where.status || r.status === args.where.status)
      && !args.where.activities?.some && (!id?.gt || r.id > id.gt) && (!id?.lte || r.id <= id.lte)
      && !id?.notIn?.includes(r.id)).sort((a,b) => a.id.localeCompare(b.id)).slice(0,args.take);
  }) } };
}
describe("bounded acceptance candidate cursor", () => {
  it("retains pending and failed deployment-closed originals without reopening them", async () => {
    const db = fixture([row("a", "done"), row("b", "done", { ...pending, acceptanceObligation: "corrective-work-required" })]);
    const page = await selectAcceptanceSweepPage(db as never, { pageSize: 10, cursor: null });
    expect(page.items.map(x => x.itemId)).toEqual(["BI-a", "BI-b"]);
  });
  // BI-C899BB40: only bounded obligations are retained; not-owed, satisfied and
  // malformed ones are never selected again.
  it("uses the latest transition and retains only bounded open obligations", async () => {
    const page = await selectAcceptanceSweepPage(fixture([
      row("a", "done", { to: "done", closureBasis: "manual" }),
      row("b", "done", { ...pending, acceptanceObligation: null }),
      row("c", "done", { ...pending, acceptanceObligation: "satisfied" }),
      row("d", "done", { to: "done", closureBasis: "delivery-evidence", acceptanceObligation: "not-owed" }),
      row("e", "done", { to: "done", closureBasis: "delivery-evidence", acceptanceObligation: "pending-submitter-confirmation" }),
      row("f", "done", { to: "done", reason: "verification-fail", correctiveItemId: "BI-ACC-1" }),
    ]) as never, { pageSize: 10, cursor: null });
    expect(page.items.map(x => x.itemId)).toEqual(["BI-e"]);
    expect(page.nextCursor).toBe("f");
  });

  it("excludes a done item whose bounded step is resolved, at the indexed pool", async () => {
    const { ACCEPTANCE_CANDIDATE_WHERE, SUBMITTER_CONFIRMATION_ACTIVITY_KIND } = await import("./acceptance-sweep-page");
    const done = ACCEPTANCE_CANDIDATE_WHERE.OR[1] as { NOT: { activities: { some: { kind: string; payload: unknown } } } };
    expect(done.NOT.activities.some).toEqual({ kind: SUBMITTER_CONFIRMATION_ACTIVITY_KIND, payload: { path: ["resolved"], equals: true } });
    expect(JSON.stringify(ACCEPTANCE_CANDIDATE_WHERE)).not.toContain("not-owed");
  });
  it("visits over 500 old obligations despite continuous fresh arrivals, then wraps", async () => {
    const rows = Array.from({length: 601}, (_,i) => row(String(i).padStart(4,"0"), "done"));
    const db = fixture(rows); const seen = new Set<string>(); let cursor: string | null = null;
    for (let pass = 0; pass < 7; pass++) {
      rows.push(row(`z${pass}`));
      const page = await selectAcceptanceSweepPage(db as never, { pageSize: 100, cursor });
      page.items.forEach(x => seen.add(x.id)); cursor = page.nextCursor;
      expect(page.items.length).toBeLessThanOrEqual(100);
    }
    expect(rows.slice(0,601).every(r => seen.has(r.id))).toBe(true);
  });
  it("never returns duplicate candidates and makes no reads for zero budget", async () => {
    const db = fixture([row("a"),row("b")]);
    const page = await selectAcceptanceSweepPage(db as never,{pageSize:10,cursor:"a"});
    expect(page.items.map(x=>x.id)).toEqual(["b","a"]);
    db.backlogItem.findMany.mockClear();
    expect(await selectAcceptanceSweepPage(db as never,{pageSize:0,cursor:"a"})).toEqual({items:[],unsnapshotted:0,nextCursor:"a"});
    expect(db.backlogItem.findMany).not.toHaveBeenCalled();
  });
});
