import { describe, expect, it, vi } from "vitest";
import {
  extractFormAssistResult,
  registerActiveFormAssist,
  getActiveFormAssist,
  type AgentFormAssistContext,
  applyFormAssistDelivery,
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

describe("accepted form delivery binding", () => {
  const setup = () => ({ formId: "expense-one", formName: "Expense", routeContext: "/finance/expense-claims",
    fields: [{ key: "description", label: "Description", type: "text" as const }],
    getValues: () => ({}), applyFieldUpdates: vi.fn(),
  });
  const delivery = { taskRunId: "TR-one", agentMessageId: "response", formAssistFormId: "expense-one", formAssistUpdate: { description: "Drafted value" } };

  it.each(["other-form", "other-job", "no-current-job"])("does not apply a replay to %s", change => {
    const adapter = setup();
    if (change === "other-form") adapter.formId = "expense-two";
    expect(applyFormAssistDelivery(adapter, delivery, new Set(), change === "no-current-job" ? null : change === "other-job" ? "TR-other" : "TR-one")).toBe(false);
    expect(adapter.applyFieldUpdates).not.toHaveBeenCalled();
  });
  it("applies the accepted proposal once even when completion is redelivered", () => {
    const adapter = setup(), applied = new Set<string>();
    expect(applyFormAssistDelivery(adapter, delivery, applied, "TR-one")).toBe(true);
    expect(applyFormAssistDelivery(adapter, delivery, applied, "TR-one")).toBe(false);
    expect(adapter.applyFieldUpdates).toHaveBeenCalledOnce();
  });
  it("uses the registered field allowlist and preserves ordinary unbound delivery", () => {
    const adapter = setup();
    expect(applyFormAssistDelivery(adapter, { agentMessageId: "legacy-response", formAssistUpdate: { description: "Allowed", submit: true } }, new Set(), null)).toBe(true);
    expect(adapter.applyFieldUpdates).toHaveBeenCalledWith({ description: "Allowed" });
  });
  it("retains a completion arriving before the HTTP acknowledgement and applies it only to the acknowledged job", () => {
    const adapter = setup(), applied = new Set<string>(), pending = new Map();
    expect(applyFormAssistDelivery(adapter, delivery, applied, null, pending)).toBe(false);
    expect(adapter.applyFieldUpdates).not.toHaveBeenCalled();
    expect(applyFormAssistDelivery(adapter, {}, applied, "TR-other", pending)).toBe(false);
    expect(applyFormAssistDelivery(adapter, {}, applied, "TR-one", pending)).toBe(true);
    expect(adapter.applyFieldUpdates).toHaveBeenCalledOnce();
    expect(applyFormAssistDelivery(adapter, delivery, applied, "TR-one", pending)).toBe(false);
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
