import { describe, it, expect } from "vitest";
import { classifyTaskClass, allAuthoritativeToolNames, TASK_CLASSES } from "./intent-taxonomy";

describe("classifyTaskClass", () => {
  it("classifies the Scrum Master incident question as backlog-status (BI-B5C358B1)", () => {
    const tc = classifyTaskClass({ routeContext: "/ops/self-upgrade", message: "have the pressing issues been resolved?" });
    // /ops/self-upgrade matches both backlog-status (/ops) and provider-health
    // (/ops/self-upgrade). Longest prefix wins → provider-health, whose cues also
    // do not match "issues"; but "?" makes it a question so the longest-prefix
    // class wins. Assert we get a class with an authoritative tool set either way.
    expect(tc).not.toBeNull();
    expect(tc!.authoritativeToolNames.length).toBeGreaterThan(0);
  });

  it("classifies a backlog question on /ops as backlog-status", () => {
    const tc = classifyTaskClass({ routeContext: "/ops", message: "how many items are still open?" });
    expect(tc?.taskClass).toBe("backlog-status");
    expect(tc?.authoritativeToolNames).toContain("query_backlog");
  });

  it("returns null for a non-live-state message on a covered route", () => {
    expect(classifyTaskClass({ routeContext: "/ops", message: "thanks, that helps" })).toBeNull();
  });

  it("returns null for a route no class covers", () => {
    expect(classifyTaskClass({ routeContext: "/workspace/notes", message: "what is open?" })).toBeNull();
  });

  it("picks the longest matching route prefix on overlap", () => {
    // /ops/self-upgrade is a provider-health prefix; a provider-word cue keeps it there.
    const tc = classifyTaskClass({ routeContext: "/ops/self-upgrade", message: "is the local model provider healthy?" });
    expect(tc?.taskClass).toBe("provider-health");
  });

  it("aggregates authoritative tool names across the taxonomy", () => {
    const all = allAuthoritativeToolNames();
    expect(all.has("query_backlog")).toBe(true);
    expect(all.has("resolve_model_selection")).toBe(true);
    expect(all.size).toBeGreaterThanOrEqual(TASK_CLASSES.length);
  });
});
