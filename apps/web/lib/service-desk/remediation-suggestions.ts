// EP-MSP-FEDERATION · A4 — deterministic remediation suggestions.
//
// The "diagnose → propose" step without the LLM: a rule-based mapper from an
// incident's class/summary to candidate remediation actions, then gated through
// the authority band (remediation-authority). The coworker-LLM diagnosis is the
// enhancement on top of this deterministic floor — so the loop produces useful,
// safe proposals even with no model in the loop. Pure + testable.

import {
  buildRemediationProposal,
  CONSERVATIVE_AUTHORITY_BAND,
  type AuthorityBand,
  type RemediationActionDraft,
  type RemediationProposalDraft,
} from "./remediation-authority";

export interface DiagnosableIncident {
  incidentKey: string;
  edgeNodeId: string;
  summary: string;
  highestSeverity: string;
  /** The edge event class, when known ("interface_down", "high_cpu", …). */
  eventClass?: string | null;
}

interface SuggestionRule {
  match: RegExp;
  build: () => RemediationActionDraft[];
}

// Diagnostics-first: every rule leads with a read-only evidence step (auto-approve
// under the conservative band) before any mutating action.
const RULES: SuggestionRule[] = [
  {
    match: /interface[\s_-]?down|link[\s_-]?down|port[\s_-]?down/i,
    build: () => [
      { actionType: "collect-interface-diagnostics", parameters: {}, riskClass: "read-only", rationale: "Capture interface counters + log tail before acting." },
      { actionType: "restart-interface", parameters: {}, riskClass: "medium", rationale: "Bounce the down interface to recover the link." },
    ],
  },
  {
    match: /high[\s_-]?cpu|high[\s_-]?mem|memory[\s_-]?pressure/i,
    build: () => [
      { actionType: "collect-resource-snapshot", parameters: {}, riskClass: "read-only", rationale: "Snapshot top processes + utilization." },
    ],
  },
  {
    match: /cert[\s_-]?expir/i,
    build: () => [
      { actionType: "rotate-certificate", parameters: {}, riskClass: "low", rationale: "Rotate the expiring certificate." },
    ],
  },
  {
    match: /service[\s_-]?down|process[\s_-]?down|daemon/i,
    build: () => [
      { actionType: "collect-service-diagnostics", parameters: {}, riskClass: "read-only", rationale: "Capture service status + recent logs." },
      { actionType: "restart-service", parameters: {}, riskClass: "medium", rationale: "Restart the down service." },
    ],
  },
  {
    match: /disk[\s_-]?full|storage[\s_-]?full|no[\s_-]?space|low[\s_-]?disk/i,
    build: () => [
      { actionType: "collect-disk-usage", parameters: {}, riskClass: "read-only", rationale: "Report disk usage by path for an operator." },
    ],
  },
];

const DEFAULT_ACTIONS: RemediationActionDraft[] = [
  {
    actionType: "collect-diagnostics",
    parameters: {},
    riskClass: "read-only",
    rationale: "No specific remediation rule matched; gather diagnostics for an operator.",
  },
];

export function suggestRemediationActions(incident: DiagnosableIncident): RemediationActionDraft[] {
  const haystack = `${incident.eventClass ?? ""} ${incident.summary}`;
  for (const rule of RULES) {
    if (rule.match.test(haystack)) return rule.build();
  }
  return DEFAULT_ACTIONS;
}

/**
 * The A4 diagnose→propose step: suggest actions for an incident and gate them
 * through the authority band. The result is a RemediationProposalDraft ready for
 * the consent gate (in-org or, with a link boundaryRef, cross-org).
 */
export function diagnoseAndPropose(
  incident: DiagnosableIncident,
  band: AuthorityBand = CONSERVATIVE_AUTHORITY_BAND,
  boundaryRef?: string,
): RemediationProposalDraft {
  const actions = suggestRemediationActions(incident);
  return buildRemediationProposal(
    {
      incidentKey: incident.incidentKey,
      edgeNodeId: incident.edgeNodeId,
      ...(boundaryRef ? { boundaryRef } : {}),
    },
    actions,
    band,
  );
}
