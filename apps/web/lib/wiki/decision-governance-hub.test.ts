import { describe, it, expect } from "vitest";

import { buildDisciplineCards } from "./decision-governance-hub";

const base = {
  kernelPrincipleCount: 157,
  kernelHeuristicCount: 33,
  orgHasOwnWwwdStance: false,
  wwmdOpenReviews: 0,
  wwwdOpenReviews: 0,
  wsidFamilyCount: 23,
  wsidActiveProfiles: 1,
  wsidOpenReviews: 0,
  wwmdDecisions30d: 0,
  wwwdDecisions30d: 0,
  wsidDecisions30d: 0,
};

describe("buildDisciplineCards", () => {
  it("returns the three disciplines in WWMD → WWWD → WSID order", () => {
    const cards = buildDisciplineCards(base);
    expect(cards.map((c) => c.key)).toEqual(["wwmd", "wwwd", "wsid"]);
  });

  it("accents WWWD as the discipline the business owns", () => {
    const cards = buildDisciplineCards(base);
    const wwwd = cards.find((c) => c.key === "wwwd");
    expect(wwwd?.featured).toBe(true);
    // WWMD and WSID are not accented.
    expect(cards.find((c) => c.key === "wwmd")?.featured).toBeFalsy();
    expect(cards.find((c) => c.key === "wsid")?.featured).toBeFalsy();
  });

  it("surfaces the kernel material counts on the WWMD card", () => {
    const cards = buildDisciplineCards(base);
    const wwmd = cards.find((c) => c.key === "wwmd");
    const labels = wwmd?.chips.map((c) => c.label) ?? [];
    expect(labels).toContain("157 principles");
    expect(labels).toContain("33 heuristics");
  });

  it("warns when the org has no WWWD stance of its own", () => {
    const cards = buildDisciplineCards({ ...base, orgHasOwnWwwdStance: false });
    const wwwd = cards.find((c) => c.key === "wwwd");
    const stanceChip = wwwd?.chips.find((c) => c.label.includes("stance"));
    expect(stanceChip?.label).toBe("no stance of your own yet");
    expect(stanceChip?.tone).toBe("warning");
  });

  it("marks the WWWD stance healthy when the org has authored one", () => {
    const cards = buildDisciplineCards({ ...base, orgHasOwnWwwdStance: true });
    const wwwd = cards.find((c) => c.key === "wwwd");
    const stanceChip = wwwd?.chips.find((c) => c.label.includes("stance"));
    expect(stanceChip?.label).toBe("your own stance");
    expect(stanceChip?.tone).toBe("success");
  });

  it("adds a warning review chip only when there are open reviews, pluralized", () => {
    const none = buildDisciplineCards(base);
    expect(
      none.find((c) => c.key === "wwmd")?.chips.some((c) => c.label.includes("review")),
    ).toBe(false);

    const some = buildDisciplineCards({
      ...base,
      wwmdOpenReviews: 1,
      wwwdOpenReviews: 4,
    });
    const wwmd = some.find((c) => c.key === "wwmd");
    const wwwd = some.find((c) => c.key === "wwwd");
    expect(wwmd?.chips.find((c) => c.label.includes("review"))?.label).toBe("1 open review");
    expect(wwwd?.chips.find((c) => c.label.includes("review"))?.label).toBe("4 open reviews");
    expect(wwmd?.chips.find((c) => c.label.includes("review"))?.tone).toBe("warning");
  });

  it("pluralizes the WSID corpus chip and links every card to its review queue", () => {
    const cards = buildDisciplineCards({ ...base, wsidActiveProfiles: 3 });
    const wsid = cards.find((c) => c.key === "wsid");
    expect(wsid?.chips.map((c) => c.label)).toContain("3 corpora active");
    for (const card of cards) {
      expect(
        card.actions.some((a) => a.href.startsWith("/platform/ai/founder-review")),
      ).toBe(true);
    }
  });

  it("gives WWWD a primary emphasized manage-stance action", () => {
    const cards = buildDisciplineCards(base);
    const wwwd = cards.find((c) => c.key === "wwwd");
    const manage = wwwd?.actions.find((a) => a.emphasis);
    expect(manage?.label).toBe("Manage stance");
  });

  it("flags a silent decision ledger with a warning usage chip on every tier", () => {
    const cards = buildDisciplineCards(base);
    for (const card of cards) {
      const chip = card.chips.find((c) => c.label === "no decisions recorded");
      expect(chip?.tone).toBe("warning");
    }
  });

  it("shows 30d decision counts (pluralized) when the ledger is in use", () => {
    const cards = buildDisciplineCards({
      ...base,
      wwmdDecisions30d: 12,
      wwwdDecisions30d: 1,
      wsidDecisions30d: 0,
    });
    const wwmdChip = cards
      .find((c) => c.key === "wwmd")
      ?.chips.find((c) => c.label.includes("decision"));
    expect(wwmdChip?.label).toBe("12 decisions · 30d");
    expect(wwmdChip?.tone).toBe("success");
    const wwwdChip = cards
      .find((c) => c.key === "wwwd")
      ?.chips.find((c) => c.label.includes("decision"));
    expect(wwwdChip?.label).toBe("1 decision · 30d");
    const wsidChip = cards
      .find((c) => c.key === "wsid")
      ?.chips.find((c) => c.label.includes("decision"));
    expect(wsidChip?.label).toBe("no decisions recorded");
  });

  it("links every tier card to its decision log", () => {
    const cards = buildDisciplineCards(base);
    for (const card of cards) {
      expect(
        card.actions.some((a) => a.href === `/wiki/decisions?tier=${card.key}`),
      ).toBe(true);
    }
  });
});
