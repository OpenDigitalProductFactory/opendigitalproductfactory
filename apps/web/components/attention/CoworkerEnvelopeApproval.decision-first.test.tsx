// @vitest-environment jsdom
//
// BI-CF03AA73 — Decision-first approval card with registry-driven tool
// descriptors, semantic posture badge, and single clean audit drawer.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

import { CoworkerEnvelopeApproval } from "./CoworkerEnvelopeApproval";
import { OwnerDecisionCards } from "./OwnerDecisionCards";
import { coworkerEnvelopeToAttentionItem } from "@/lib/attention/sources/coworker-envelope";
import { summarizeCoworkerEnvelopeDecision } from "@/lib/attention/coworker-envelope-decision";
import { buildOwnerAttentionProjection } from "@/lib/attention/owner-projection";
import type { AttentionEnvelopeApproval } from "@/lib/attention/types";
import type { ToolApprovalPresentation } from "@/lib/tool-approval-presentation";
import { defaultVisibleHtml } from "@/lib/ux-budget/scope";
import { visibleUtterances } from "@/lib/owner-first/ux-audit";

const NOW = Date.parse("2026-11-28T12:00:00.000Z");

const TRIAGE_PRESENTATION: ToolApprovalPresentation = {
  question: "Run inventory discovery triage?",
  what: "Reviews unmatched inventory items and applies safe high-confidence catalog matches.",
  impact: "Stays inside DPF and touches no external systems. Any catalog match can be reassigned or dismissed later.",
  whyDefault: "Scheduled inventory triage check. Your coworker needs sign-off before updating catalog records.",
  declineDoes: "Declining skips this triage pass; inventory records stay unchanged.",
  scopeLabel: "Inventory catalog",
  reversibility: "reversible",
  allowedParams: ["trigger", "includeDecisions"],
  allowEmptyParams: true,
  paramLabels: {
    trigger: { label: "Trigger", valueLabels: { cadence: "Scheduled daily cadence" } },
    includeDecisions: { label: "Detailed decisions", valueLabels: { false: "Compact summary only" } },
  },
};

afterEach(() => {
  cleanup();
});

describe("CoworkerEnvelopeApproval — decision-first card (BI-CF03AA73)", () => {
  it("leads with What / Why now / Impact and posture badge for run_discovery_triage without filler", () => {
    const item = coworkerEnvelopeToAttentionItem(
      {
        id: "env-triage-1",
        coworkerAgentId: "AGT-INVENTORY",
        delegatingUserId: "owner-1",
        manifestActionId: "run_discovery_triage",
        rationale: "This coworker is set to propose, not act.",
        status: "proposed",
        taskRunId: null,
        // clock-bomb-guard: allow projected against the pinned NOW constant, not the wall clock
        expiresAt: new Date(NOW + 7 * 86_400_000),
        createdAt: new Date(NOW - 60_000),
        proposedParameters: { trigger: "cadence", includeDecisions: false },
        consequence: null,
        approvalPresentation: TRIAGE_PRESENTATION,
        taskRun: null,
      },
      NOW,
    );
    const entry = buildOwnerAttentionProjection([item], { nowMs: NOW }).needsYouNow[0]!;
    const { container } = render(<OwnerDecisionCards entries={[entry]} />);
    const visible = visibleUtterances(defaultVisibleHtml(container.innerHTML)).join(" ");

    expect(visible).toContain("Run inventory discovery triage?");
    expect(visible).toContain("Internal · Reversible");
    expect(visible).toContain("What");
    expect(visible).toContain("Why now");
    expect(visible).toContain("Impact");
    expect(visible).toContain("high-confidence catalog matches");
    expect(visible).toContain("Scheduled inventory triage check");
    expect(visible).toContain("Stays inside DPF");
    expect(visible).toContain("Declining skips this triage pass");
    expect(visible).not.toContain("Review this coworker request?");
    expect(visible).not.toContain("Reversibility is not established");
    expect(visible).not.toContain("Keep this on hold");
    expect(visible).not.toContain("Why am I being asked?");

    expect(screen.queryByText("Not named in the proposal")).toBeNull();
    expect(screen.queryByText("Not attached")).toBeNull();
    expect(screen.queryByText("Not linked to backlog")).toBeNull();

    const drawer = screen.getByText("Technical evidence").closest("details")!;
    expect(drawer.open).toBe(false);
    expect(drawer.textContent).toContain("Scheduled daily cadence");
    expect(drawer.textContent).toContain("Compact summary only");
    expect(drawer.textContent).toContain("run_discovery_triage");
  });

  it("fails closed with Effect unverified posture and visible material facts on unexpected params", () => {
    const decision = summarizeCoworkerEnvelopeDecision({
      toolName: "run_discovery_triage",
      proposedParameters: { trigger: "cadence", payment: { amount: 450, currency: "USD" } },
      recommenderAgentId: "AGT-INVENTORY",
      authorizerUserId: "owner-1",
      consequence: null,
      approvalPresentation: TRIAGE_PRESENTATION,
    });
    const approval: AttentionEnvelopeApproval = {
      envelopeId: "env-triage-bad",
      coworkerAgentId: "AGT-INVENTORY",
      delegatingUserId: "owner-1",
      manifestActionId: "run_discovery_triage",
      rationale: "Needs owner sign-off.",
      status: "proposed",
      taskRunId: null,
      expiresAtIso: "2099-01-01T00:00:00.000Z",
      actionable: true,
      approveHref: "/api/agent/envelope/env-triage-bad/approve",
      declineHref: "/api/agent/envelope/env-triage-bad/deny",
      decision,
    };
    const { container } = render(<CoworkerEnvelopeApproval approval={approval} />);
    const visible = visibleUtterances(defaultVisibleHtml(container.innerHTML)).join(" ");
    expect(visible).toContain("Keep this on hold until its effect is clear.");
    expect(visible).toContain("450");
    expect(visible).toContain("USD");
  });
});
