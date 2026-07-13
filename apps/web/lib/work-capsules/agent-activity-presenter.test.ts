import { describe, expect, it } from "vitest";

import { presentAgentSession, hasAgentActivity } from "./agent-activity-presenter";

const at = new Date("2026-07-12T00:00:00.000Z");

describe("presentAgentSession (BI-C41AB195)", () => {
  it("gives typed agent activities a plain label, their own tone, and the agent actor", () => {
    const [thought, action] = presentAgentSession([
      { id: "1", kind: "thought", summary: "Deciding the approach", recordedAt: at, recordedByAgentId: "AGT-1" },
      { id: "2", kind: "action", summary: "Edited the parser", recordedAt: at, recordedByAgentId: "AGT-1" },
    ]);
    expect(thought).toMatchObject({ tone: "thought", label: "Thinking", actor: "agent" });
    expect(action).toMatchObject({ tone: "action", label: "Did", actor: "agent" });
  });

  it("tones lifecycle plumbing as 'lifecycle' with a title-cased label", () => {
    const [entry] = presentAgentSession([
      { id: "3", kind: "evidence-recorded", summary: "Attached a PR", recordedAt: at, recordedById: "user-1" },
    ]);
    expect(entry).toMatchObject({ tone: "lifecycle", label: "Evidence Recorded", actor: "human" });
  });

  it("classifies the actor: agent > human > system", () => {
    const rows = [
      { id: "a", kind: "response", summary: "x", recordedAt: at, recordedByAgentId: "AGT-1", recordedById: "user-1" },
      { id: "b", kind: "response", summary: "x", recordedAt: at, recordedById: "user-1" },
      { id: "c", kind: "created", summary: "x", recordedAt: at },
    ].map((r) => presentAgentSession([r])[0]);
    expect(rows.map((r) => r.actor)).toEqual(["agent", "human", "system"]);
  });

  it("preserves input order (newest-first as passed)", () => {
    const ids = presentAgentSession([
      { id: "new", kind: "action", summary: "x", recordedAt: at },
      { id: "old", kind: "thought", summary: "y", recordedAt: at },
    ]).map((e) => e.id);
    expect(ids).toEqual(["new", "old"]);
  });

  it("hasAgentActivity is true only when a typed agent activity is present", () => {
    expect(hasAgentActivity([{ id: "1", kind: "created", summary: "x", recordedAt: at }])).toBe(false);
    expect(hasAgentActivity([{ id: "2", kind: "question", summary: "x", recordedAt: at }])).toBe(true);
  });
});
