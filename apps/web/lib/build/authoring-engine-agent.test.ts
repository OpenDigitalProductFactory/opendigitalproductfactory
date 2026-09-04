// BI-2D698C7B — a design's author must be named truthfully, or not at all.

import { describe, expect, it } from "vitest";

import { authoringAgentIdForEngine } from "./authoring-engine-agent";

describe("authoringAgentIdForEngine", () => {
  it("names the registered agent for each external engine", () => {
    expect(authoringAgentIdForEngine("codex")).toBe("AGT-EXT-CODEX");
    expect(authoringAgentIdForEngine("claude")).toBe("AGT-EXT-CLAUDE");
    expect(authoringAgentIdForEngine("grok")).toBe("AGT-EXT-GROK");
  });

  // The bundled local engine has no registered agent. Inventing one would put a
  // fabricated author on a governed artifact; a null author lets the readiness
  // gate refuse, which is the correct outcome.
  it("returns null for an engine with no registered agent", () => {
    expect(authoringAgentIdForEngine("opencode")).toBeNull();
    expect(authoringAgentIdForEngine("something-new")).toBeNull();
  });

  it("returns null when no engine is known", () => {
    expect(authoringAgentIdForEngine(null)).toBeNull();
    expect(authoringAgentIdForEngine(undefined)).toBeNull();
    expect(authoringAgentIdForEngine("")).toBeNull();
  });
});
