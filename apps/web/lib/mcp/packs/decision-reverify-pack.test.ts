// Pack conformance for reverify_decision_evidence (BI-8192557E phase 2b).
//
// Mirrors principle-decide-pack.test.ts: definitions and handlers agree, the
// tool is read-only, and the pack's advertised grant matches agent-grants.ts —
// TOOL_TO_GRANTS denies unlisted tools by default, so a pack that ships without
// the gating entry is invisible rather than merely ungranted (BI-88B77204).

import { describe, expect, it } from "vitest";

import { decisionReverifyPack } from "./decision-reverify-pack";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["reverify_decision_evidence"] as const;

describe("decisionReverifyPack", () => {
  it("exposes exactly the expected tools, with a handler for each", () => {
    expect(decisionReverifyPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(decisionReverifyPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("is read-only — re-verification must never mutate the decision it audits", () => {
    for (const definition of decisionReverifyPack.definitions) {
      expect(definition.sideEffect).toBe(false);
    }
  });

  it("has a gating grant entry that matches the pack's advertised grant", () => {
    expect(decisionReverifyPack.grants.reverify_decision_evidence).toEqual(["registry_read"]);
    expect(TOOL_TO_GRANTS.reverify_decision_evidence).toEqual(["registry_read"]);
  });

  it("requires an interactionId", async () => {
    const res = await decisionReverifyPack.handlers.reverify_decision_evidence!({}, "user-1", undefined as never);
    expect(res.success).toBe(false);
    expect(res.message).toContain("interactionId");
  });

  // The description is the only thing an agent reads before calling. If it does
  // not separate the verdict from its coverage, a partial pass gets reported
  // upward as "the decision is verified".
  it("tells the caller that outcome and coverage are different claims", () => {
    const [definition] = decisionReverifyPack.definitions;
    expect(definition!.description).toContain("coverage");
    expect(definition!.description).toContain("unverifiable");
    expect(definition!.description).toContain("NOT a clean bill of health");
  });
});
