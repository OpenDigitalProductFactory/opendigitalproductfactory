import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobStepTools } from "@/lib/jobs/types";
const m = vi.hoisted(() => ({ select: vi.fn(), begin: vi.fn(), finish: vi.fn(), apply: vi.fn(), route: vi.fn(), ledger: vi.fn(), record: vi.fn(), gate: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ jobs: { createFunction: (_config: unknown, handler: unknown) => handler } }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: m.gate }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/operate/backlog-triage-repository", () => ({ selectTriageBatch: m.select, beginTriage: m.begin, finishTriage: m.finish, applyTriageBuild: m.apply }));
vi.mock("@/lib/inference/routed-inference", () => ({ routeAndCall: m.route }));
vi.mock("@/lib/operate/backlog-triage-ledger", () => ({ recordTriageDecision: m.ledger }));
vi.mock("@/lib/operate/discovery-scheduler", () => ({ recordJobRun: m.record }));
import { backlogTriageDrain } from "./backlog-triage-drain";

const run = backlogTriageDrain as unknown as (input: { step: JobStepTools }) => Promise<Record<string, unknown>>;
function checkpoints() {
  const saved = new Map<string, unknown>();
  return { run: vi.fn(async (id: string, fn: () => Promise<unknown>) => {
    if (saved.has(id)) return saved.get(id);
    const result = await fn(); saved.set(id, result); return result;
  }) } as unknown as JobStepTools;
}
const now = new Date("2026-10-04T20:00:00Z");
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  m.gate.mockResolvedValue({ proceed: true });
  m.select.mockResolvedValue({ items: [{ itemId: "BI-a", fingerprint: "fp", updatedAt: now.toISOString() }, { itemId: "BI-b", fingerprint: "fp", updatedAt: now.toISOString() }], held: 10, cursor: "b" });
  m.begin.mockImplementation(async (itemId: string) => ({ row: { id: itemId, itemId, title: "fix" }, claim: "claim", activityId: itemId, fingerprint: "fp", attempts: 1 }));
  m.route.mockResolvedValue({ content: '{"outcome":"needs-human","confidence":0.5}' });
  m.ledger.mockResolvedValue({ recorded: true }); m.apply.mockResolvedValue(true);
  m.finish.mockResolvedValue(undefined); m.record.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
describe("bounded durable triage sweep", () => {
  it("makes no model request for an entirely held queue and reports idle", async () => {
    m.select.mockResolvedValue({ items: [], held: 25, cursor: "a" });
    expect(await run({ step: checkpoints() })).toMatchObject({ attempted: 0, held: 25, errors: 0 });
    expect(m.route).not.toHaveBeenCalled();
    expect(m.record).toHaveBeenCalledWith("backlog-triage-drain", "idle", undefined, expect.objectContaining({ summary: expect.stringContaining("25 unchanged or waiting") }));
  });
  it("stops after a model outage and reports its category and unattempted work", async () => {
    m.route.mockRejectedValue(new Error("private connection details"));
    expect(await run({ step: checkpoints() })).toMatchObject({ attempted: 1, errors: 1, remaining: 1, counts: { "model-error": 1 } });
    expect(m.route).toHaveBeenCalledTimes(1);
    expect(m.record).toHaveBeenCalledWith("backlog-triage-drain", "error", expect.stringContaining("1 model-error"), expect.anything());
  });
  it("checkpoints completed inference before a projection write retry", async () => {
    const step = checkpoints();
    m.finish.mockRejectedValueOnce(new Error("DB temporary failure"));
    await expect(run({ step })).rejects.toThrow("DB temporary failure");
    vi.setSystemTime(new Date(now.getTime() + 10 * 60_000));
    expect(await run({ step })).toMatchObject({ attempted: 1, review: 1, budgetStopped: true });
    expect(m.route).toHaveBeenCalledTimes(1);
    expect(m.finish).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite a concurrent operator decision or claim it advanced", async () => {
    m.route.mockResolvedValue({ content: '{"outcome":"build","effortSize":"small","confidence":0.9}' });
    m.apply.mockResolvedValue(false);
    expect(await run({ step: checkpoints() })).toMatchObject({ autoBuilt: 0, changed: 2 });
    expect(m.ledger).toHaveBeenCalledTimes(2);
  });
  it("retries reporting without replaying inference", async () => {
    const step = checkpoints(); m.record.mockRejectedValueOnce(new Error("report DB offline"));
    await expect(run({ step })).rejects.toThrow("report DB offline");
    await run({ step });
    expect(m.route).toHaveBeenCalledTimes(2);
    expect(m.record).toHaveBeenCalledTimes(2);
  });
  it("honors entry quiescence without touching the queue", async () => {
    m.gate.mockResolvedValue({ proceed: false, reason: "disabled" });
    expect(await run({ step: checkpoints() })).toEqual({ skipped: true, reason: "disabled" });
    expect(m.select).not.toHaveBeenCalled();
  });
});
