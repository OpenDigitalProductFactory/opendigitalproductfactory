import { describe, it, expect } from "vitest";
import { validateMessageInput } from "../agent-coworker-types";

describe("validateMessageInput", () => {
  it("returns null for valid input", () => {
    expect(validateMessageInput({ content: "Hello", routeContext: "/portfolio" })).toBeNull();
  });

  it("rejects empty content", () => {
    expect(validateMessageInput({ content: "", routeContext: "/portfolio" })).toMatch(/empty/i);
  });

  it("rejects whitespace-only content", () => {
    expect(validateMessageInput({ content: "   ", routeContext: "/portfolio" })).toMatch(/empty/i);
  });

  it("rejects content over 2000 chars", () => {
    const long = "x".repeat(2001);
    expect(validateMessageInput({ content: long, routeContext: "/portfolio" })).toMatch(/2000/);
  });

  it("accepts content at exactly 2000 chars", () => {
    const exact = "x".repeat(2000);
    expect(validateMessageInput({ content: exact, routeContext: "/portfolio" })).toBeNull();
  });

  it("rejects empty routeContext", () => {
    expect(validateMessageInput({ content: "Hello", routeContext: "" })).toMatch(/route/i);
  });
});
