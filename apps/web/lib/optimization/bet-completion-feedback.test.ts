// Tests for the BET-0f WSID feedback loop (BI-5C01F920): completed bets record
// a deduped `bet-completed` corpus-growth signal per mapped profession.

import { describe, expect, it, vi } from "vitest";

import { professionsForBet } from "./bet-professions";
import { recordBetCompletionLearnings } from "./bet-completion-feedback";

function makeDb() {
  const upsert = vi.fn().mockResolvedValue({});
  return {
    upsert,
    client: {
      professionCorpusGap: { upsert },
      professionCorpusUsageStat: { upsert: vi.fn() },
    },
  };
}

describe("recordBetCompletionLearnings", () => {
  it("records one bet-completed gap per mapped profession, keyed to the bet", async () => {
    const db = makeDb();
    // BET-9 maps to data-architect + finance (2 professions).
    const result = await recordBetCompletionLearnings(["BET-9"], { db: db.client as never });

    const professions = professionsForBet("BET-9");
    expect(professions.length).toBe(2);
    expect(result.learnings).toHaveLength(2);
    expect(result.recordedCount).toBe(2);
    expect(db.upsert).toHaveBeenCalledTimes(2);

    const created = db.upsert.mock.calls[0]![0].create as Record<string, unknown>;
    expect(created.reason).toBe("bet-completed");
    expect(created.professionKey).toBe(professions[0]);
    expect(String(created.query)).toMatch(/BET-9/);
    expect(String(created.suggestedSource)).toMatch(/BET-9/);
    expect(created.routeContext).toBe("vertint.sweep");
  });

  it("skips unknown bet keys and bets with no profession mapping", async () => {
    const db = makeDb();
    const result = await recordBetCompletionLearnings(["BET-999", "NOPE"], {
      db: db.client as never,
    });
    expect(result.learnings).toHaveLength(0);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("aggregates across several completed bets", async () => {
    const db = makeDb();
    // BET-6 -> software-engineer (1); BET-2 -> enterprise-architecture + security (2).
    const result = await recordBetCompletionLearnings(["BET-6", "BET-2"], {
      db: db.client as never,
    });
    expect(result.learnings).toHaveLength(
      professionsForBet("BET-6").length + professionsForBet("BET-2").length,
    );
    expect(result.recordedCount).toBe(result.learnings.length);
  });

  it("counts a failed (fail-open) gap write as not recorded", async () => {
    const upsert = vi.fn().mockRejectedValue(new Error("db down"));
    const client = {
      professionCorpusGap: { upsert },
      professionCorpusUsageStat: { upsert: vi.fn() },
    };
    const result = await recordBetCompletionLearnings(["BET-6"], { db: client as never });
    expect(result.recordedCount).toBe(0);
    expect(result.learnings.every((learning) => !learning.recorded)).toBe(true);
  });
});
