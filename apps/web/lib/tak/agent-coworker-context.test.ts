import { describe, expect, it } from "vitest";
import { buildCurrentTurnHistory, currentTurnInstruction } from "./agent-coworker-context";
import { classifyEvidenceRequirement } from "./evidence-requirement";
import { resolveRouteContext } from "./route-context-map";

const routeContext = "/finance";
const domainTools = resolveRouteContext(routeContext).domainTools;
const requirement = (message: string) => classifyEvidenceRequirement({ routeContext, domainTools, message });
const marked = (message: string) => String(buildCurrentTurnHistory([], message, "usr-123abc").at(-1)!.content);

describe("assignment provenance and live-data classification", () => {
  it("keeps general Finance guidance tool-free after adding platform provenance", () => {
    const request = "Give read-only expense-entry and receipt guidance for our software business. Do not use tools, send mail, change settings or spend money.";
    expect(domainTools.length).toBeGreaterThan(0);
    expect(requirement(request).required).toBe(false);
    expect(requirement(marked(request))).toEqual(requirement(request));
  });
  it.each(["What is our current expense count?", "List outstanding expense claims", "How much did we spend today?"])(
    "preserves live-data evidence for %s", request => {
      expect(requirement(request).required).toBe(true);
      expect(requirement(marked(request))).toEqual(requirement(request));
    });
  it("keeps the assignment marker and instruction consistent without changing the request", () => {
    expect(marked("Explain expense entry")).toBe("Explain expense entry\n\nActive assignment [usr-123abc]");
    expect(currentTurnInstruction("usr-123abc")).toContain("marked Active assignment [usr-123abc]");
    const history = buildCurrentTurnHistory([{ role: "user", content: "What is the current expense count?" }], "Explain expense entry", "usr-123abc");
    expect(String(history[0]!.content)).toContain("Earlier user message (context only):");
    expect(history.at(-1)!.content).toBe(marked("Explain expense entry"));
  });
});
