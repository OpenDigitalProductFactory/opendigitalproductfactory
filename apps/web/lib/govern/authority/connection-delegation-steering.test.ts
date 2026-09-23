// BI-12E5DD91 — connection-delegation steering end to end, minus the network:
// the MCP route's extractor, the steering resolver, and the stored reason.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { connectionDelegationFor } from "@/lib/mcp/connection-delegation";

import { approvalExplanation } from "./coworker-tool-authority-gate";
import { resolveSteering } from "./resolve-coworker-tool-authority";

const OAUTH = {
  source: "oauth",
  agentId: "AGT-EXT-CODEX",
  authorityBindingId: "binding-row-1",
  oauthIdentitySetupRequired: false,
};

describe("connectionDelegationFor — only a revalidated OAuth consent qualifies", () => {
  it("carries the consent binding and the assistant it names", () => {
    expect(connectionDelegationFor(OAUTH)).toEqual({
      connectionDelegation: { authorityBindingId: "binding-row-1", agentId: "AGT-EXT-CODEX" },
    });
  });

  it.each([
    ["a personal access token", { ...OAUTH, source: "pat" }],
    ["a portal session JWT", { ...OAUTH, source: "session-jwt" }],
    ["an unbound OAuth connection", { ...OAUTH, authorityBindingId: null }],
    ["a connection still needing identity setup", { ...OAUTH, oauthIdentitySetupRequired: true }],
    ["a token with no assistant", { ...OAUTH, agentId: null }],
  ])("yields nothing for %s", (_label, token) => {
    expect(connectionDelegationFor(token)).toEqual({});
  });
});

describe("resolveSteering — connection delegation", () => {
  const base = { initiativeReviewBinding: null, roomAuthority: null, toolName: "record_workroom_evidence" };

  it("steers when the consent names the coworker actually acting", () => {
    expect(resolveSteering({
      ...base,
      agentId: "AGT-EXT-CODEX",
      connectionDelegation: { authorityBindingId: "binding-row-1", agentId: "AGT-EXT-CODEX" },
    })).toBe("connection-delegation");
  });

  it("does not steer a different coworker that inherited the context", () => {
    expect(resolveSteering({
      ...base,
      agentId: "AGT-WS-PORTFOLIO",
      connectionDelegation: { authorityBindingId: "binding-row-1", agentId: "AGT-EXT-CODEX" },
    })).toBe("none");
  });

  it("does not steer without a consent, which is every PAT call", () => {
    expect(resolveSteering({ ...base, agentId: "AGT-EXT-CODEX" })).toBe("none");
    expect(resolveSteering({
      ...base,
      agentId: "AGT-EXT-CODEX",
      connectionDelegation: { authorityBindingId: "  ", agentId: "AGT-EXT-CODEX" },
    })).toBe("none");
  });
});

describe("approvalExplanation — the envelope names why a person is asked", () => {
  it("appends the branch that decided", () => {
    const text = approvalExplanation({
      outcome: "require-approval",
      reasonCode: "approval-required",
      explanation: "This action is authorized to proceed only after employee approval.",
      nextAction: "request-approval",
      approvalBinding: {} as never,
      escalation: {
        verdict: "human",
        reasonCode: "damaging-consequence",
        damaging: true,
        steering: "connection-delegation",
      },
    });
    expect(text).toMatch(/only after employee approval\. It declares a consequence/);
  });

  it("keeps the rule alone when no branch was recorded", () => {
    expect(approvalExplanation({
      outcome: "require-approval",
      reasonCode: "approval-required",
      explanation: "Rule.",
      nextAction: "request-approval",
      approvalBinding: {} as never,
    })).toBe("Rule.");
  });
});
