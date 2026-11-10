import { describe, expect, it } from "vitest";

import { presentAgentSession, hasAgentActivity } from "./agent-activity-presenter";

const at = new Date("2026-07-12T00:00:00.000Z");

describe("presentAgentSession (BI-C41AB195)", () => {
  it("does not present a pending handoff as completed work", () => {
    const [pending, completed, refused] = presentAgentSession([
      { id: "request", kind: "command-accepted", summary: "Handoff requested; waiting for the receiving assistant", recordedAt: at,
        payload: { commandType: "reassign-executor", result: { success: true, data: { handoff: { kind: "bounded-handoff", state: "pending-acknowledgement" } } } } },
      { id: "complete", kind: "command-accepted", summary: "Receiving assistant acknowledged; handoff completed", recordedAt: at,
        payload: { commandType: "reassign-executor", result: { success: true, data: { handoff: { kind: "bounded-handoff", state: "completed" } } } } },
      { id: "refused", kind: "command-rejected", summary: "reassign-executor refused (command ack)", recordedAt: at,
        payload: { commandType: "reassign-executor", rejection: { data: { result: { message: "The room lease was renewed; request a fresh handoff.", data: { handoff: { state: "refused" } } } } } } },
    ]);
    expect(pending).toMatchObject({ label: "Waiting for receiver", tone: "lifecycle" });
    expect(completed).toMatchObject({ label: "Handoff completed", tone: "action" });
    expect(refused).toMatchObject({ label: "Handoff refused", tone: "error", summary: "The room lease was renewed; request a fresh handoff." });
  });
  it("does not promote arbitrary action JSON to a verified handoff status", () => {
    const [entry] = presentAgentSession([{ id: "self-report", kind: "action", summary: "Claimed handoff", recordedAt: at,
      payload: { kind: "bounded-handoff", state: "completed" } }]);
    expect(entry.label).toBe("Did");
  });
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
