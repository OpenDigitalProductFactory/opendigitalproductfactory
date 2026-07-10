import { describe, it, expect } from "vitest";
import {
  applyEffortEntry,
  formatEffortContextBriefing,
  isKnownEffortEntryKind,
  EFFORT_LIST_CAP,
  type EffortContextState,
} from "./effort-context";

const empty = (): EffortContextState => ({
  decisions: [],
  openQuestions: [],
  notes: [],
  participantAgentIds: [],
});

describe("isKnownEffortEntryKind", () => {
  it("accepts the closed vocabulary and rejects others", () => {
    expect(isKnownEffortEntryKind("decision")).toBe(true);
    expect(isKnownEffortEntryKind("open-question")).toBe(true);
    expect(isKnownEffortEntryKind("note")).toBe(true);
    expect(isKnownEffortEntryKind("blocker")).toBe(false);
  });
});

describe("applyEffortEntry", () => {
  it("routes each kind to its list and records the author as a participant", () => {
    let s = empty();
    s = applyEffortEntry(s, { kind: "decision", content: "use TDD", agentId: "AGT-A" });
    s = applyEffortEntry(s, { kind: "open-question", content: "which db?", agentId: "AGT-B" });
    s = applyEffortEntry(s, { kind: "note", content: "auth lives in lib/auth", agentId: "AGT-A" });
    expect(s.decisions).toEqual(["use TDD"]);
    expect(s.openQuestions).toEqual(["which db?"]);
    expect(s.notes).toEqual(["auth lives in lib/auth"]);
    expect(s.participantAgentIds).toEqual(["AGT-A", "AGT-B"]);
  });

  it("is idempotent for an identical entry (case-insensitive)", () => {
    let s = empty();
    s = applyEffortEntry(s, { kind: "decision", content: "Use TDD" });
    s = applyEffortEntry(s, { kind: "decision", content: "use tdd" });
    expect(s.decisions).toEqual(["Use TDD"]);
  });

  it("does not duplicate a participant", () => {
    let s = empty();
    s = applyEffortEntry(s, { kind: "note", content: "a", agentId: "AGT-A" });
    s = applyEffortEntry(s, { kind: "note", content: "b", agentId: "AGT-A" });
    expect(s.participantAgentIds).toEqual(["AGT-A"]);
  });

  it("caps each list, dropping the oldest", () => {
    let s = empty();
    for (let i = 0; i < EFFORT_LIST_CAP + 5; i++) {
      s = applyEffortEntry(s, { kind: "note", content: `note ${i}` });
    }
    expect(s.notes).toHaveLength(EFFORT_LIST_CAP);
    expect(s.notes[0]).toBe("note 5"); // first 5 dropped
    expect(s.notes[s.notes.length - 1]).toBe(`note ${EFFORT_LIST_CAP + 4}`);
  });
});

describe("formatEffortContextBriefing", () => {
  it("returns null for an empty context (strict no-op)", () => {
    expect(formatEffortContextBriefing("epic:EP-1", null, empty())).toBeNull();
  });

  it("renders sections and participants under the title", () => {
    const s: EffortContextState = {
      decisions: ["use TDD"],
      openQuestions: ["which db?"],
      notes: ["auth in lib/auth"],
      participantAgentIds: ["AGT-A", "AGT-B"],
    };
    const out = formatEffortContextBriefing("epic:EP-1", "Billing revamp", s)!;
    expect(out).toContain("EFFORT CONTEXT — Billing revamp");
    expect(out).toContain("Participants: AGT-A, AGT-B");
    expect(out).toContain("Decisions:");
    expect(out).toContain("- use TDD");
    expect(out).toContain("Open questions:");
    expect(out).toContain("- which db?");
    expect(out).toContain("Working notes:");
  });

  it("falls back to the effortKey when no title is set", () => {
    const s = applyEffortEntry(empty(), { kind: "decision", content: "x" });
    const out = formatEffortContextBriefing("bi:BI-9", null, s)!;
    expect(out).toContain("EFFORT CONTEXT — bi:BI-9");
  });
});
