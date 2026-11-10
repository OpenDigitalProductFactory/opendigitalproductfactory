import { describe, expect, it, vi } from "vitest";
import { loadCoworkerEnvelopePage } from "./coworker-envelope";

vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [] }));

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
function fixture() {
  const rows = Array.from({ length: 30 }, (_, n) => ({
    id: `env-${String(n).padStart(3, "0")}`, delegatingUserId: "owner",
    createdAt: new Date("2026-10-18T10:00:00.000Z"), expiresAt: null, // clock-bomb-guard: allow every loader call receives the fixed NOW argument above
    status: "proposed", coworkerAgentId: "build-specialist", manifestActionId: "record_workroom_evidence",
    rationale: "Recorded progress", taskRunId: null, taskRun: null, argsJson: {},
  }));
  rows.push({ ...rows[0]!, id: "foreign", delegatingUserId: "other" });
  const pending = (where: any) => rows.filter(r => r.delegatingUserId === where.delegatingUserId && r.status === "proposed");
  const findMany = vi.fn(async ({ where, take }: any) => {
    if (typeof where.status !== "string") return [];
    let selected = pending(where).sort((a, b) => b.id.localeCompare(a.id));
    const seek = where.AND?.[0]?.OR;
    if (seek) selected = selected.filter(r => r.createdAt < seek[0].createdAt.lt ||
      (r.createdAt.getTime() === seek[1].createdAt.getTime() && r.id < seek[1].id.lt));
    return selected.slice(0, take);
  });
  const count = vi.fn(async ({ where }: any) => pending(where).length);
  const db = { coworkerActionEnvelope: { findMany, count }, toolExecution: { findMany: vi.fn(async () => []) } } as never;
  return { rows, db, findMany, count };
}

describe("approval Inbox progress", () => {
  it("shows 25 of 30 and reaches the rest even after the cursor request is decided", async () => {
    const { rows, db, findMany } = fixture();
    const first = await loadCoworkerEnvelopePage(db, "owner", NOW);
    expect(first.total).toBe(30);
    expect(first.items.filter(i => i.envelope?.actionable)).toHaveLength(25);
    expect(first.nextCursor).toBeTruthy();
    expect(findMany.mock.calls[0]![0].take).toBe(26);
    const last = first.items.filter(i => i.envelope?.actionable).at(-1)!;
    rows.find(r => r.id === last.envelope!.envelopeId)!.status = "executed";
    const second = await loadCoworkerEnvelopePage(db, "owner", NOW, first.nextCursor!);
    expect(second.total).toBe(29);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(second.items.every(i => i.envelope?.delegatingUserId === "owner")).toBe(true);
    const refreshed = await loadCoworkerEnvelopePage(db, "owner", NOW);
    expect(refreshed.total).toBe(29);
    expect(refreshed.items.some(i => i.id === last.id)).toBe(false);
    expect(refreshed.items.filter(i => i.envelope?.actionable)).toHaveLength(25);
  });

  it("does not query for an anonymous reader and rejects malformed cursors", async () => {
    const { db, findMany, count } = fixture();
    expect(await loadCoworkerEnvelopePage(db, undefined, NOW)).toEqual({ items: [], total: 0, nextCursor: null });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    await expect(loadCoworkerEnvelopePage(db, "owner", NOW, "invalid")).rejects.toThrow(/cursor/i);
  });

  it("does not turn an unavailable total into a successful empty queue", async () => {
    const { db, count } = fixture();
    count.mockRejectedValueOnce(new Error("unavailable"));
    await expect(loadCoworkerEnvelopePage(db, "owner", NOW)).rejects.toThrow("unavailable");
  });
});
