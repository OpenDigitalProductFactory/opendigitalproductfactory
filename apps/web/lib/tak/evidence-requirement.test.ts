import { describe, it, expect } from "vitest";
import {
  classifyEvidenceRequirement,
  enforceEvidenceIntegrity,
  resolveEvidenceRecovery,
  INV5_UNVERIFIED_MESSAGE,
  INV5_WITHHELD_HEADING,

} from "./evidence-requirement";

const OPS_DOMAIN_TOOLS = ["query_backlog", "create_backlog_item", "update_backlog_item"];

describe("classifyEvidenceRequirement", () => {
  it("flags the Scrum Master incident question as evidence-required (BI-B5C358B1)", () => {
    const r = classifyEvidenceRequirement({
      routeContext: "/ops/self-upgrade",
      domainTools: OPS_DOMAIN_TOOLS,
      message: "have the pressing issues been resolved?",
    });
    expect(r.required).toBe(true);
    // Phase 2: taskClass is now a data-driven class id from the taxonomy.
    expect(r.taskClass).not.toBeNull();
    expect(r.authoritativeToolNames?.length ?? 0).toBeGreaterThan(0);
  });

  it("flags a live-state question with no '?' via a state cue", () => {
    const r = classifyEvidenceRequirement({
      routeContext: "/ops",
      domainTools: OPS_DOMAIN_TOOLS,
      message: "give me the current count of open items",
    });
    expect(r.required).toBe(true);
  });

  it("does NOT require evidence when the route exposes no authoritative domain tools", () => {
    const r = classifyEvidenceRequirement({
      routeContext: "/workspace",
      domainTools: [],
      message: "have the pressing issues been resolved?",
    });
    expect(r.required).toBe(false);
  });

  it("does NOT require evidence for a non-question, non-live-state message on a domain route", () => {
    const r = classifyEvidenceRequirement({
      routeContext: "/ops",
      domainTools: OPS_DOMAIN_TOOLS,
      message: "thanks, that's helpful",
    });
    expect(r.required).toBe(false);
  });
});

describe("enforceEvidenceIntegrity", () => {
  const fabricated =
    "Yes — 59 of 60 backlog items are done or deferred, and only one is still in " +
    "progress. The team has resolved nearly all of the pressing issues.";

  it("BLOCKS a substantive factual answer when evidence was required and no authoritative tool ran (INV-1)", () => {
    const out = enforceEvidenceIntegrity({
      required: true,
      authoritativeToolExecutions: 0,
      content: fabricated,
    });
    expect(out.blocked).toBe(true);
    // The reply is the bare refusal — a fabricated figure must never reach the
    // reader, labelled or not (BI-B5C358B1).
    expect(out.content).toBe(INV5_UNVERIFIED_MESSAGE);
    // But the draft is preserved for the caller, not destroyed (BI-0C0669B5).
    expect(out.withheldContent).toBe(fabricated);
  });

  it("PASSES the answer through when an authoritative tool did run", () => {
    const grounded = "There are 710 backlog items: 23 in progress, 142 open, 4 blocked, 194 deferred.";
    const out = enforceEvidenceIntegrity({
      required: true,
      authoritativeToolExecutions: 1,
      content: grounded,
    });
    expect(out.blocked).toBe(false);
    expect(out.content).toBe(grounded);
  });

  it("PASSES through on a turn that was never evidence-required (normal chat, no regression)", () => {
    const out = enforceEvidenceIntegrity({
      required: false,
      authoritativeToolExecutions: 0,
      content: fabricated,
    });
    expect(out.blocked).toBe(false);
    expect(out.content).toBe(fabricated);
  });

  it("does NOT block a short acknowledgement or a clarifying question", () => {
    const ack = enforceEvidenceIntegrity({
      required: true,
      authoritativeToolExecutions: 0,
      content: "Sure — let me check.",
    });
    expect(ack.blocked).toBe(false);
    const clarify = enforceEvidenceIntegrity({
      required: true,
      authoritativeToolExecutions: 0,
      content: "Do you mean the open items on this board or across the whole backlog right now?",
    });
    expect(clarify.blocked).toBe(false);
  });
});

describe("resolveEvidenceRecovery", () => {
  const fabricated =
    "Yes — 59 of 60 backlog items are done or deferred, and only one is still in progress right now.";

  it("nudges on the first unverifiable answer, then refuses on the second", () => {
    const first = resolveEvidenceRecovery({
      required: true,
      authoritativeToolExecutions: 0,
      content: fabricated,
      recoveryNudgesUsed: 0,
    });
    expect(first.kind).toBe("nudge");

    const second = resolveEvidenceRecovery({
      required: true,
      authoritativeToolExecutions: 0,
      content: fabricated,
      recoveryNudgesUsed: 1,
    });
    expect(second.kind).toBe("refuse");
    if (second.kind === "refuse") {
      expect(second.message).toBe(INV5_UNVERIFIED_MESSAGE);
      expect(second.withheldContent).toBe(fabricated);
    }
  });

  it("passes when a tool ran or the turn was not evidence-required", () => {
    expect(
      resolveEvidenceRecovery({ required: true, authoritativeToolExecutions: 1, content: fabricated, recoveryNudgesUsed: 0 }).kind,
    ).toBe("pass");
    expect(
      resolveEvidenceRecovery({ required: false, authoritativeToolExecutions: 0, content: fabricated, recoveryNudgesUsed: 0 }).kind,
    ).toBe("pass");
  });

  it("accepts prehydrated authorized-surface evidence without requiring a second tool call", () => {
    expect(
      resolveEvidenceRecovery({
        required: true,
        authoritativeToolExecutions: 0,
        authoritativeSurfaceEvidence: true,
        content: fabricated,
        recoveryNudgesUsed: 0,
      }).kind,
    ).toBe("pass");
  });
});

// BI-0C0669B5. On 2026-08-26 this guard deleted a reviewer's ~5,100-character
// explanation of why it was declining to record a governance decision, leaving
// only generic copy that described a different situation. The reasoning existed
// afterwards ONLY as a truncated container-log line. The invariant is that an
// unverified claim must not reach the reader as though verified — quarantining
// satisfies that; deletion is not required by it and destroys the one artifact
// a human needs to tell a blocked gate from a legitimate refusal.
describe("an unverified turn is preserved for the operator, never destroyed (BI-0C0669B5)", () => {
  const draft = "I read the design at the pinned commit and formed a verdict, but I am "
    + "stopping short of recording a decision — here is why, and what I found.";

  it("keeps the reply as the bare refusal so no unverified claim reaches the reader", () => {
    const action = resolveEvidenceRecovery({
      required: true,
      authoritativeToolExecutions: 0,
      content: draft,
      recoveryNudgesUsed: 1,
    });
    expect(action.kind).toBe("refuse");
    if (action.kind === "refuse") expect(action.message).toBe(INV5_UNVERIFIED_MESSAGE);
  });

  it("hands the caller the withheld draft so the reasoning survives", () => {
    const action = resolveEvidenceRecovery({
      required: true,
      authoritativeToolExecutions: 0,
      content: draft,
      recoveryNudgesUsed: 1,
    });
    if (action.kind === "refuse") expect(action.withheldContent).toBe(draft);
  });

  it("preserves the draft on the integrity decision too", () => {
    const out = enforceEvidenceIntegrity({
      required: true,
      authoritativeToolExecutions: 0,
      content: draft,
    });
    expect(out.blocked).toBe(true);
    expect(out.content).toBe(INV5_UNVERIFIED_MESSAGE);
    expect(out.withheldContent).toBe(draft);
  });

  it("exposes a heading for operator surfaces that render the quarantined draft", () => {
    expect(INV5_WITHHELD_HEADING).toContain("Unverified");
  });
});
