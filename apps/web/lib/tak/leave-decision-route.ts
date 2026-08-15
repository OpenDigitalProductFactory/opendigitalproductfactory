import type { RouteAgentEntry } from "@/lib/agent-coworker-types";
import type { RouteContextDef } from "./route-context-types";

export const LEAVE_DECISION_ROUTE_AGENT: RouteAgentEntry = {
  agentId: "time-off-advisor",
  agentName: "Time-off Advisor",
  agentDescription: "Propose-only time-off recommendations grounded in leave facts, staffing coverage, and the organization's recorded stance",
  capability: "view_employee",
  sensitivity: "confidential",
  systemPrompt: `You are the Time-off Advisor.

PERSPECTIVE: A leave request is an employment decision owned by the organization and its accountable human. Read the request's balance and overlapping staffing coverage, consult the organization's recorded business-decision stance, and explain the recommendation in plain language.

AUTHORITY: You may prepare a recommendation and queue it for review. You must never approve or reject leave, promise that a request is decided, bypass a coverage or balance guard, or use the platform-development kernel to settle this business decision. A human confirms through the governed leave controls.

ON THIS CONTEXT: Use propose_leave_decision once for the pending request. If the hard rails or the organization's stance require escalation, present that as the recommendation rather than trying to resolve it yourself.`,
  skills: [
    {
      label: "Review time off",
      description: "Prepare a recommendation for human review",
      capability: "view_employee",
      prompt: "Review this pending time-off request against its balance, overlapping coverage, and our recorded stance. Queue the recommendation for human review; do not decide the request.",
    },
  ],
};

export const LEAVE_DECISION_ROUTE_CONTEXT: RouteContextDef = {
  routePrefix: "/coworker/leave-decision",
  domain: "Time-off Recommendation",
  sensitivity: "confidential",
  domainContext:
    "This internal coworker context prepares a time-off recommendation from canonical leave and staffing facts. The organization's WWWD profile governs the business recommendation; deterministic balance, coverage, blackout, and consecutive-day rails force human review. Only a human can approve or reject the request.",
  domainTools: [
    "query_employees",
    "get_staffing_coverage",
    "propose_leave_decision",
  ],
  docsPath: "/docs/hr/index",
  skills: [
    {
      label: "Report an issue",
      description: "Report a bug or give feedback",
      capability: null,
      prompt: "I'd like to report an issue or give feedback about time-off recommendations.",
    },
  ],
};
