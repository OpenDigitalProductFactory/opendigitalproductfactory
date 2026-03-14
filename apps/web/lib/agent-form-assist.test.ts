import { describe, expect, it } from "vitest";
import {
  extractFormAssistResult,
  registerActiveFormAssist,
  getActiveFormAssist,
  type AgentFormAssistContext,
} from "./agent-form-assist";

describe("extractFormAssistResult", () => {
  const context: AgentFormAssistContext = {
    formId: "backlog-panel",
    formName: "Backlog item",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "priority", label: "Priority", type: "number" },
    ],
  };

  it("returns plain content when no assist block is present", () => {
    expect(extractFormAssistResult("Hello there", context)).toEqual({
      displayContent: "Hello there",
      fieldUpdates: null,
    });
  });

  it("extracts allowed field updates from a fenced assist block", () => {
    const result = extractFormAssistResult(
      "I drafted the form updates for you.\n```agent-form\n{\"fieldUpdates\":{\"title\":\"Document the route help flow\",\"priority\":2,\"status\":\"open\"}}\n```",
      context,
    );

    expect(result.displayContent).toBe("I drafted the form updates for you.");
    expect(result.fieldUpdates).toEqual({
      title: "Document the route help flow",
      priority: 2,
    });
  });
});

describe("active form assist registry", () => {
  it("registers and clears the active adapter", () => {
    const dispose = registerActiveFormAssist({
      routeContext: "/ops",
      formId: "backlog-panel",
      formName: "Backlog item",
      fields: [{ key: "title", label: "Title", type: "text" }],
      getValues: () => ({ title: "Existing" }),
      applyFieldUpdates: () => {},
    });

    expect(getActiveFormAssist("/ops")?.formId).toBe("backlog-panel");
    dispose();
    expect(getActiveFormAssist("/ops")).toBeNull();
  });
});
