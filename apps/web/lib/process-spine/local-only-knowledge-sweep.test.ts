import { describe, expect, it, vi } from "vitest";

import type { SweepStore } from "./local-only-knowledge-sweep";
import {
  COMMONS_LANES,
  LOCAL_ONLY_THRESHOLD,
  buildSweepBody,
  buildSweepTitle,
  evaluateSweep,
  laneForProposal,
  runLocalOnlyKnowledgeSweep,
  type UnroutedProposal,
} from "./local-only-knowledge-sweep";

const NOW = new Date("2026-09-22T00:00:00.000Z");

function proposal(overrides: Partial<UnroutedProposal> = {}): UnroutedProposal {
  return {
    proposalId: "IP-0001",
    title: "The async worker throws before claiming, so recovery re-enqueues forever",
    category: "bug",
    severity: "high",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function many(count: number, overrides: Partial<UnroutedProposal> = {}): UnroutedProposal[] {
  return Array.from({ length: count }, (_, i) =>
    proposal({ proposalId: `IP-${String(i).padStart(4, "0")}`, ...overrides }),
  );
}

describe("laneForProposal", () => {
  it("routes each known category to its governed lane", () => {
    expect(laneForProposal({ category: "skill" })).toMatchObject({ lane: "wsid" });
    expect(laneForProposal({ category: "process" })).toMatchObject({ lane: "wwmd" });
    expect(laneForProposal({ category: "bug" })).toMatchObject({ lane: "code-and-rulebook" });
    expect(laneForProposal({ category: "code" })).toMatchObject({ lane: "code-and-rulebook" });
  });

  it("is total — an unknown category lands somewhere rather than being dropped", () => {
    // The defect being guarded against is a finding going nowhere. A lane a
    // human later corrects beats silence.
    expect(laneForProposal({ category: "something-nobody-has-added-yet" })).toMatchObject({
      lane: "wwwd",
    });
    expect(laneForProposal({ category: "" }).lane).toBeDefined();
  });

  it("never invents a lane outside the four the routing skill defines", () => {
    for (const category of ["skill", "process", "bug", "code", "other", ""]) {
      expect(COMMONS_LANES).toContain(laneForProposal({ category }).lane);
    }
  });

  it("names the kernel lane as PR-only rather than a tool call", () => {
    // Kernel pages are ratified on merge; a principle is never invented in
    // place, so the item must not tell someone to call a tool that would.
    expect(laneForProposal({ category: "process" }).tool).toContain("PR");
  });
});

describe("evaluateSweep", () => {
  it("stays quiet while local findings are ordinary work in flight", () => {
    const verdict = evaluateSweep({ proposals: many(LOCAL_ONLY_THRESHOLD - 1), now: NOW });
    expect(verdict).toMatchObject({ fires: false, reason: "below-threshold" });
  });

  it("fires at the threshold, not above it", () => {
    expect(evaluateSweep({ proposals: many(LOCAL_ONLY_THRESHOLD), now: NOW }).fires).toBe(true);
  });

  it("carries the age of the oldest finding, because count alone understates it", () => {
    // Ten findings from this week are a queue. Ten from last quarter are a
    // corpus that stopped moving, and the item should say which it is.
    const verdict = evaluateSweep({
      proposals: [
        ...many(LOCAL_ONLY_THRESHOLD - 1),
        proposal({ proposalId: "IP-OLD", createdAt: new Date("2026-06-22T00:00:00.000Z") }),
      ],
      now: NOW,
    });

    expect(verdict).toMatchObject({ fires: true, oldestDays: 92 });
  });

  it("honours an explicit threshold so the caller can tune without editing the rule", () => {
    expect(evaluateSweep({ proposals: many(3), now: NOW, threshold: 3 }).fires).toBe(true);
    expect(evaluateSweep({ proposals: many(3), now: NOW, threshold: 4 }).fires).toBe(false);
  });
});

describe("the filed item", () => {
  const verdict = evaluateSweep({ proposals: many(12), now: NOW });

  it("leads with the count and says what closes it", () => {
    if (!verdict.fires) throw new Error("expected the sweep to fire");
    expect(buildSweepTitle(verdict)).toContain("12");

    const body = buildSweepBody({ verdict, proposals: many(12) });
    expect(body).toContain("What closes this");
    expect(body).toContain("re-arms once it is closed");
  });

  it("names the governed route per lane, not just the problem", () => {
    if (!verdict.fires) throw new Error("expected the sweep to fire");
    const body = buildSweepBody({
      verdict,
      proposals: [
        ...many(4, { category: "skill" }),
        ...many(4, { category: "process" }),
        ...many(4, { category: "bug" }),
      ],
    });

    expect(body).toContain("propose_skill_improvement");
    expect(body).toContain("docs/founder-kernel/wiki/principles");
    expect(body).toContain("create_backlog_item");
  });

  it("states what must NOT be routed, so the fix cannot become an exfiltration", () => {
    if (!verdict.fires) throw new Error("expected the sweep to fire");
    const body = buildSweepBody({ verdict, proposals: many(12) });
    expect(body).toContain("secrets");
    expect(body).toContain("host paths");
  });

  it("samples rather than pasting an unbounded list", () => {
    if (!verdict.fires) throw new Error("expected the sweep to fire");
    const body = buildSweepBody({ verdict, proposals: many(500), sampleSize: 20 });
    expect(body.match(/^- `IP-/gm)?.length).toBe(20);
    expect(body).toContain("Oldest 20 of 12");
  });
});

describe("runLocalOnlyKnowledgeSweep", () => {
  type IngestArgs = Parameters<Parameters<typeof runLocalOnlyKnowledgeSweep>[0]["ingest"]>[0];
  type FindManyArgs = Parameters<SweepStore["improvementProposal"]["findMany"]>[0];

  function store(proposals: UnroutedProposal[]) {
    return {
      improvementProposal: {
        findMany: vi.fn(async (_args: FindManyArgs) => proposals),
      },
    };
  }

  function ingestSpy(result: { itemId: string; created: boolean }) {
    return vi.fn(async (_args: IngestArgs) => result);
  }

  it("fires on a seeded population and files one item", async () => {
    const ingest = ingestSpy({ itemId: "LOK-1", created: true });
    const db = store(many(12));

    const result = await runLocalOnlyKnowledgeSweep({ store: db, ingest, now: NOW });

    expect(result).toEqual({ filed: true, itemId: "LOK-1", created: true, unrouted: 12 });
    expect(db.improvementProposal.findMany.mock.calls[0]![0].where).toEqual({
      contributionStatus: "local",
    });
    const filed = ingest.mock.calls[0]![0];
    expect(filed.source).toBe("automated-detection");
    expect(filed.scopeKind).toBe("platform");
  });

  it("uses a STABLE origin so a standing condition is reported once, not weekly", async () => {
    // ingestBacklogItem dedupes on this marker against non-terminal items, so a
    // stable id is what makes the sweep report rather than nag. A per-run id
    // would file a fresh item every week and train the operator to ignore it.
    const ingest = ingestSpy({ itemId: "LOK-1", created: false });

    await runLocalOnlyKnowledgeSweep({ store: store(many(12)), ingest, now: NOW });
    await runLocalOnlyKnowledgeSweep({ store: store(many(40)), ingest, now: NOW });

    expect(ingest.mock.calls[0]![0].origin).toEqual(ingest.mock.calls[1]![0].origin);
    expect(ingest.mock.calls[0]![0].origin).toEqual({ kind: "local-only-knowledge", id: "sweep" });
  });

  it("files nothing below the threshold", async () => {
    const ingest = ingestSpy({ itemId: "LOK-1", created: true });

    const result = await runLocalOnlyKnowledgeSweep({ store: store(many(2)), ingest, now: NOW });

    expect(result).toEqual({ filed: false, reason: "below-threshold", unrouted: 2 });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("files nothing at all when the install has routed everything", async () => {
    const ingest = ingestSpy({ itemId: "LOK-1", created: true });

    const result = await runLocalOnlyKnowledgeSweep({ store: store([]), ingest, now: NOW });

    expect(result).toMatchObject({ filed: false, unrouted: 0 });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("never contributes anything itself", async () => {
    // Routing a learning picks a lane and a governed tool. That is a judgment
    // call, and an unattended sweep must not make it on anyone's behalf.
    const ingest = ingestSpy({ itemId: "LOK-1", created: true });
    const db = store(many(12)) as Record<string, unknown>;

    await runLocalOnlyKnowledgeSweep({ store: db as never, ingest, now: NOW });

    expect(Object.keys(db)).toEqual(["improvementProposal"]);
    expect(db.improvementProposal).not.toHaveProperty("update");
    expect(db.improvementProposal).not.toHaveProperty("updateMany");
  });
});
