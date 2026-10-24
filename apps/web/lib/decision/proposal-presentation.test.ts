import { describe, expect, it } from "vitest";

import { panelNoteFrom, presentProposal } from "./proposal-presentation";

const BASE = {
  proposalId: "DRP-i-row-1",
  actionKind: "answer_gap",
  status: "proposed",
  summary: "Decline the ingest until a data agreement exists",
  draftPayload: { question: "Do we ingest third-party catalogs?", answer: "Not without a DPA." },
  dissent: [],
  confidence: 0.8,
};

describe("presentProposal", () => {
  it("gives a settled proposal no action buttons", () => {
    for (const status of ["accepted", "amended", "rejected"]) {
      expect(presentProposal({ ...BASE, status })).toBeNull();
    }
  });

  it("hides a draft whose row was retired, even though nobody ruled on it", () => {
    expect(presentProposal({ ...BASE, lifecycle: "retired" })).toBeNull();
    expect(presentProposal({ ...BASE, lifecycle: "active" })).not.toBeNull();
  });

  it("drops an action kind this install cannot apply", () => {
    expect(presentProposal({ ...BASE, actionKind: "publish-everything" })).toBeNull();
  });

  it("says an accepted answer still lands as draft", () => {
    const p = presentProposal(BASE)!;
    expect(p.effect).toContain("draft");
    expect(p.draftText).toBe("Not without a DPA.");
    expect(p.draftField).toBe("answer");
  });

  it("offers nothing to edit when the kind has no editable text", () => {
    const p = presentProposal({
      ...BASE,
      actionKind: "adopt_option",
      draftPayload: { optionId: "decline" },
    })!;
    expect(p.draftField).toBeNull();
    expect(p.draftText).toBeNull();
  });

  it("distinguishes agreement from nobody having looked", () => {
    const agreed = presentProposal(BASE)!;
    expect(agreed.agreementNote).not.toBeNull();
    expect(agreed.dissent).toEqual([]);

    const contested = presentProposal({
      ...BASE,
      dissent: [{ role: "legal", position: "proceed", because: "the DPA is already on file" }],
    })!;
    expect(contested.agreementNote).toBeNull();
    expect(contested.dissent).toHaveLength(1);
  });

  it("drops malformed dissent entries rather than rendering a blank objection", () => {
    const p = presentProposal({
      ...BASE,
      dissent: [{ role: "legal" }, "nope", { role: "finance", position: "decline" }],
    })!;
    expect(p.dissent).toEqual([{ role: "finance", position: "decline", because: "" }]);
  });

  it("warns rather than reassures when the panel was not confident", () => {
    expect(presentProposal({ ...BASE, confidence: 0.2 })!.confidence).toContain("not confident");
    expect(presentProposal({ ...BASE, confidence: 0.5 })!.confidence).toContain("moderately");
    expect(presentProposal({ ...BASE, confidence: null })!.confidence).toBeNull();
  });
});

describe("panelNoteFrom", () => {
  it("names the specialists who weighed in, not the machinery around them", () => {
    const note = panelNoteFrom([
      { branchNodeId: "b1", role: "domain-specialist:finance", status: "completed" },
      { branchNodeId: "b2", role: "skeptic", status: "completed" },
      { branchNodeId: "b3", role: "resolution-adjudicator", status: "completed" },
    ]);
    expect(note).toBe("Weighed in: domain-specialist:finance.");
  });

  it("says plainly when no specialist applied", () => {
    expect(panelNoteFrom([{ role: "skeptic" }, { role: "resolution-adjudicator" }])).toContain(
      "general platform judgement",
    );
  });

  it("says nothing at all when no panel produced this", () => {
    expect(panelNoteFrom(null)).toBeNull();
    expect(panelNoteFrom("a panel, honest")).toBeNull();
  });
});
