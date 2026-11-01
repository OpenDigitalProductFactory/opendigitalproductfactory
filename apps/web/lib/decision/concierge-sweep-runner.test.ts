import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  payloads: [] as any[], rows: [] as any[],
  db: { coworkerActionEnvelope: { findMany: vi.fn(), updateMany: vi.fn() },
    nonProductionEnvironmentLease: { findUnique: vi.fn() },
    decisionInteraction: { findMany: vi.fn() }, decisionResolutionProposal: { updateMany: vi.fn() },
    workroom: { upsert: vi.fn() }, workroomActivity: { findFirst: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(), $transaction: vi.fn() },
}));
vi.mock("@dpf/db", async () => {
  const { Prisma } = await import("../../../../packages/db/generated/client/client");
  return { Prisma, prisma: state.db };
});
vi.mock("./triage-conductor", () => ({ conductTriage: vi.fn() }));
vi.mock("./triage-panel-binding", () => ({ runGovernanceTriagePanel: vi.fn() }));
vi.mock("@/lib/coworker/envelope-expiry", () => ({ expireLapsedEnvelopes: vi.fn(async () => ({ expired: 0, skipped: 0 })) }));
import { runConciergeSweepJob } from "./concierge-sweep-runner";
import { obsoleteEnvelope, obsoleteTarget } from "@/lib/coworker/obsolete-lease-envelope.test-fixtures";

beforeEach(() => {
  vi.clearAllMocks(); state.payloads = [];
  state.rows = Array.from({ length: 201 }, (_, i) => obsoleteEnvelope(`approval-${String(i).padStart(3, "0")}`));
  for (const row of state.rows.slice(0, 200)) row.argsJson = {};
  state.db.coworkerActionEnvelope.findMany.mockImplementation(async ({ where, take }: any) => state.rows.filter(row =>
    ["proposed", "approved"].includes(row.status) && (!where.id || row.id > where.id.gt)).slice(0, take).map(row => structuredClone(row)));
  state.db.coworkerActionEnvelope.updateMany.mockImplementation(async ({ where, data }: any) => {
    const row = state.rows.find(r => r.id === where.id);
    if (!row || row.status !== where.status || row.resolvedAt !== null) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  state.db.nonProductionEnvironmentLease.findUnique.mockImplementation(async () => obsoleteTarget());
  state.db.decisionInteraction.findMany.mockResolvedValue([]);
  state.db.workroom.upsert.mockResolvedValue({ id: "standing-room" });
  state.db.workroomActivity.findFirst.mockImplementation(async () => state.payloads.length ? { payload: state.payloads.at(-1) } : null);
  state.db.workroomActivity.create.mockImplementation(async ({ data }: any) => { state.payloads.push(data.payload); return {}; });
  state.db.$executeRaw.mockResolvedValue(1);
  state.db.$transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(state.db));
});

describe("scheduled obsolete approval cleanup", () => {
  it("checkpoints bounded scan counts and reaches page two on the next ordinary pass", async () => {
    await runConciergeSweepJob({ userId: "person" });
    expect(state.payloads[0].obsoleteReleaseApprovals).toMatchObject({ scanned: 200, skipped: 200,
      cancelled: 0, hasMore: true, nextCursor: "approval-199" });
    expect(state.rows[200].status).toBe("proposed");
    await runConciergeSweepJob({ userId: "person" });
    expect(state.payloads[1].obsoleteReleaseApprovals).toMatchObject({ scanned: 1, cancelled: 1,
      hasMore: false, nextCursor: null, settled: [{ envelopeId: "approval-200", leaseId: "NPEL-unused" }] });
    expect(state.rows[200].status).toBe("cancelled");
    expect(state.payloads[1].retiredStaleProposals).toBe(1);
    await runConciergeSweepJob({ userId: "person" });
    expect(state.payloads[2].obsoleteReleaseApprovals).toMatchObject({ scanned: 200, cancelled: 0, hasMore: false });
  });
});
