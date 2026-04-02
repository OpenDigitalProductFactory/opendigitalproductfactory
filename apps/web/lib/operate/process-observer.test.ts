import { describe, expect, it } from "vitest";
import { analyzeConversation, type ConversationMessage } from "./process-observer";

const msg = (role: "user" | "assistant" | "system", content: string, id = "m1"): ConversationMessage => ({
  id, role, content, agentId: "build-specialist", routeContext: "/build",
});

describe("analyzeConversation", () => {
  it("detects tool failure in system messages", () => {
    const messages = [msg("user", "help"), msg("system", "Tool update_feature_brief failed: Build not found")];
    expect(analyzeConversation(messages).some((f) => f.type === "tool_failure")).toBe(true);
  });
  it("detects canned response", () => {
    const messages = [msg("user", "hi"), msg("system", "AI providers are currently unavailable. Showing a pre-configured response.")];
    expect(analyzeConversation(messages).some((f) => f.type === "config_gap")).toBe(true);
  });
  it("detects agent reasoning dump", () => {
    const text = "We need to handle the user's request. The instruction says we should not ask for internal IDs. But we can still use a placeholder. We assume buildId is known.";
    expect(analyzeConversation([msg("user", "next?"), msg("assistant", text)]).some((f) => f.type === "agent_quality")).toBe(true);
  });
  it("detects user repeating themselves", () => {
    const messages = [msg("user", "what do I do next?", "m1"), msg("assistant", "checking", "m2"), msg("user", "what do I do next?", "m3")];
    expect(analyzeConversation(messages).some((f) => f.type === "user_friction")).toBe(true);
  });
  it("detects user asking what's next", () => {
    expect(analyzeConversation([msg("user", "ok, what is next?")]).some((f) => f.type === "user_friction")).toBe(true);
  });
  it("detects config not configured", () => {
    expect(analyzeConversation([msg("system", "Web Search (Brave) is not configured. An admin needs to configure")]).some((f) => f.type === "config_gap")).toBe(true);
  });
  it("detects provider quota", () => {
    expect(analyzeConversation([msg("system", "OpenAI hit its usage quota and has been temporarily disabled")]).some((f) => f.type === "tool_failure")).toBe(true);
  });
  it("returns empty for clean conversation", () => {
    const messages = [msg("user", "build a form"), msg("assistant", "What fields?"), msg("user", "name and email"), msg("assistant", "Got it.")];
    expect(analyzeConversation(messages)).toHaveLength(0);
  });
});
