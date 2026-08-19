import { describe, it, expect, vi } from "vitest";

import {
  appendGovernedSpecialistCorpus,
  governedSpecialistCorpusEnabled,
  BUILD_GOVERNED_SPECIALIST_CORPUS_FLAG,
} from "./build-specialist-corpus";
import type { ProfessionCorpusClient } from "@/lib/decision-perspective/profession-corpus";

const BASE = "You are the Data Architect.\n\n--- Your Assigned Task ---\nDo the thing";

/** A fake corpus client returning one data-architect page for the DA family. */
function fakeDb(rows: Array<{ slug: string; title: string; abstract: string; body: string }>): ProfessionCorpusClient {
  return {
    wikiPage: {
      findMany: vi.fn(async () =>
        rows.map((r) => ({ ...r, metadata: null })) as never,
      ),
    },
  };
}

describe("governedSpecialistCorpusEnabled — default off", () => {
  it("is off when the flag is unset", () => {
    expect(governedSpecialistCorpusEnabled({})).toBe(false);
  });
  it("is off for any value other than exactly 'true'", () => {
    expect(governedSpecialistCorpusEnabled({ [BUILD_GOVERNED_SPECIALIST_CORPUS_FLAG]: "1" })).toBe(false);
    expect(governedSpecialistCorpusEnabled({ [BUILD_GOVERNED_SPECIALIST_CORPUS_FLAG]: "TRUE" })).toBe(false);
  });
  it("is on only for 'true'", () => {
    expect(governedSpecialistCorpusEnabled({ [BUILD_GOVERNED_SPECIALIST_CORPUS_FLAG]: "true" })).toBe(true);
  });
});

describe("appendGovernedSpecialistCorpus (A1 Phase 2a, BI-C654F960)", () => {
  const on = { [BUILD_GOVERNED_SPECIALIST_CORPUS_FLAG]: "true" };
  const off = {};

  it("is a STRICT no-op when the flag is off (the default) — prompt byte-identical", async () => {
    const db = fakeDb([{ slug: "professions/data-architect/x", title: "X", abstract: "a", body: "b" }]);
    const res = await appendGovernedSpecialistCorpus(BASE, {
      agentId: "data-architect",
      query: "task",
      db,
      env: off,
    });
    expect(res.prompt).toBe(BASE);
    expect(res.injected).toBe(false);
    // The corpus is not even queried when disabled.
    expect(db.wikiPage.findMany).not.toHaveBeenCalled();
  });

  it("injects the real Agent's corpus when enabled and the family resolves", async () => {
    const db = fakeDb([
      {
        slug: "professions/data-architect/mdm-what-it-does-and-does-not-do",
        title: "MDM — What It Does and Does Not Do",
        abstract: "MDM resolves duplicates after the fact.",
        body: "MDM resolves duplicates after the fact — it does not prevent their creation.",
      },
    ]);
    const res = await appendGovernedSpecialistCorpus(BASE, {
      agentId: "data-architect",
      query: "master data dedupe",
      db,
      env: on,
    });
    expect(res.injected).toBe(true);
    expect(res.pages).toBeGreaterThan(0);
    expect(res.prompt.startsWith(BASE)).toBe(true);
    expect(res.prompt.length).toBeGreaterThan(BASE.length);
    // The corpus content actually landed in the prompt.
    expect(res.prompt).toContain("MDM");
  });

  it("returns the base unchanged when the agent maps to no profession family", async () => {
    const db = fakeDb([{ slug: "professions/data-architect/x", title: "X", abstract: "a", body: "b" }]);
    const res = await appendGovernedSpecialistCorpus(BASE, {
      agentId: "not-a-profession-agent-zzz",
      query: "task",
      db,
      env: on,
    });
    expect(res.prompt).toBe(BASE);
    expect(res.injected).toBe(false);
  });

  it("fail-open: a resolve error returns the base prompt unchanged", async () => {
    const db: ProfessionCorpusClient = {
      wikiPage: { findMany: vi.fn(async () => { throw new Error("db down"); }) },
    };
    const res = await appendGovernedSpecialistCorpus(BASE, {
      agentId: "data-architect",
      query: "task",
      db,
      env: on,
    });
    expect(res.prompt).toBe(BASE);
    expect(res.injected).toBe(false);
  });
});
