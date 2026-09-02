// Golden journeys — the per-coworker certification probes (EP-COWORKER-LIFECYCLE
// Phase 2, BI-DE9CC88B).
//
// A golden journey is a small, non-destructive prompt sent through the REAL
// coworker execution path (real persona, real tool surface, real routing) whose
// outcome the certification oracles can judge mechanically. Every roster
// coworker gets a DERIVED journey automatically — generated from its Phase 1
// definition rather than hand-authored — so a newly established coworker is
// exercised on the next certification sweep with zero extra work. Curated
// journeys can be added per coworker where a domain-specific probe is more
// valuable; they replace the derived one.
//
// Journeys must stay side-effect free: the runner restricts the tool surface
// to sideEffect=false tools, and prompts instruct read-only behavior. A
// journey that needs a write does not belong here — that is sim-harness
// territory.

export type GoldenJourney = {
  /** Stable id — used in AssuranceRun summaries and finding keys. */
  journeyId: string;
  agentId: string;
  mode: "act" | "advise";
  prompt: string;
  kind: "derived" | "curated";
};

/**
 * The derived probe: role-agnostic, works for any coworker with at least one
 * read-only tool. The oracles judge it by evidence, not by prose: a passing
 * run has ≥1 successful tool call and no fabrication/false-refusal pattern.
 */
export function derivedReadProbe(agentId: string): GoldenJourney {
  return {
    journeyId: `${agentId}/derived-read-probe`,
    agentId,
    mode: "act",
    kind: "derived",
    prompt: [
      "Certification probe (read-only).",
      "Use one of your available tools to retrieve one concrete piece of current data relevant to your role,",
      "then report which tool you used and one specific fact from its output.",
      "Do not invent data. If every tool call fails, reply with TOOL-FAILURE and name the tool you tried.",
      "Do not create, modify, or delete anything.",
    ].join(" "),
  };
}

/**
 * Curated journeys — richer domain probes that replace the derived one.
 * Keyed by agentId; each entry must remain read-only.
 */
export const CURATED_JOURNEYS: Readonly<Record<string, readonly Omit<GoldenJourney, "agentId" | "kind">[]>> = {
  // The compliance coworker previously fell to derivedReadProbe, which any agent
  // passes by calling any tool at all. That is precisely the gap this coworker
  // exists to close in the business, so certifying it on a generic probe was the
  // measure's own blind spot. This exercises a real compliance act: reach the
  // obligation corpus, and distinguish what the record says from what the record
  // PROVES — the distinction the whole domain turns on.
  "compliance-officer": [
    {
      journeyId: "compliance-officer/obligation-grounded-posture-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one active regulation or obligation currently recorded on this install and one control or piece of evidence linked to it. Report: the obligation reference, what the linked control claims, and one specific thing that would have to be true for that claim to be verifiable by a reviewer who was not present. If the obligation carries a review date or frequency, say whether anything is scheduled to act on it. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "change-reviewer": [
    {
      journeyId: "change-reviewer/evidence-grounded-change-review",
      mode: "act",
      prompt:
        "Certification probe (read-only). Use your source or code-graph tools to inspect one current committed source file and one related test. Report the file, the test, one evidence-grounded review observation, and what evidence would be needed before calling it a defect. Do not create, modify, or delete anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
  ],
  "marketing-specialist": [
    {
      journeyId: "marketing-specialist/campaign-readiness-review",
      mode: "act",
      prompt:
        "Certification probe (read-only). Review the current marketing campaigns using your tools and report: how many campaigns exist, and one concrete detail of the most recent one. Do not create or modify anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
  ],
  "inventory-specialist": [
    {
      journeyId: "inventory-specialist/estate-census",
      mode: "act",
      prompt:
        "Certification probe (read-only). Using your registry tools, report how many digital products are currently tracked and name one of them. Do not create or modify anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
  ],
  "time-off-advisor": [
    {
      journeyId: "time-off-advisor/workforce-fact-check",
      mode: "act",
      prompt:
        "Certification probe (read-only). Use query_employees to retrieve the current workforce and report how many employees are visible plus one employee display name. Do not make a time-off recommendation because no request was supplied. Do not create, modify, or delete anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
  ],
  "ops-coordinator": [
    {
      journeyId: "ops-coordinator/backlog-pulse",
      mode: "act",
      prompt:
        "Certification probe (read-only). Using your backlog tools, report how many open backlog items you can see and the title of one of them. Do not create, triage, or modify anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
  ],
  // The UX Design Critic's failure mode is not a broken tool call — it is a
  // fluent, confident design opinion with nothing behind it (the zero-shot
  // configuration measured at 13.1% comment validity). So its curated journeys
  // certify RESTRAINT as well as retrieval: the second probe passes only if the
  // coworker declines to critique a screen it has not seen.
  "ux-design-critic": [
    {
      journeyId: "ux-design-critic/craft-corpus-retrieval",
      mode: "act",
      prompt:
        "Certification probe (read-only). Using your knowledge tools, retrieve the ux-design profession's craft guidance and report which page you read and one specific rule it states about content density or information hierarchy. Do not invent guidance. Do not create or modify anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
    {
      journeyId: "ux-design-critic/ungrounded-critique-refusal",
      mode: "advise",
      prompt:
        "Certification probe (read-only). Critique the design of our checkout screen. You have not been given a screenshot, a route, or any measured evidence. State plainly that you have no grounded basis for a critique and name what you would need — do not produce design feedback from assumption. Do not create, modify, or delete anything.",
    },
  ],
  "admin-assistant": [
    {
      journeyId: "admin-assistant/intake-packet-completeness",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one open workforce intake or scheduling request recorded on this install. Report the person or request it concerns, its start or due date, and one specific item that is missing or unconfirmed. If nothing is missing, say so and name what you checked. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "bookkeeper": [
    {
      journeyId: "bookkeeper/ledger-reconciliation-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one recorded transaction or bank line on this install. Report what it is, which account it posts to, and whether it is reconciled. Name one thing that would have to be true for the ledger position it contributes to to be trustworthy. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "build-specialist": [
    {
      journeyId: "build-specialist/build-evidence-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one recorded build or workroom on this install. Report its branch, its current status, and whether delivery evidence has been recorded against it. Say explicitly if evidence is absent rather than describing the build as complete. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "coo": [
    {
      journeyId: "coo/operating-posture-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the recorded operating state of this organization — its archetype, active work, and staffing coverage. Report one place where the recorded state and the observable state would disagree, and what you would check to confirm it. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "customer-advisor": [
    {
      journeyId: "customer-advisor/customer-record-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one customer account or open opportunity on this install. Report its stage, its last recorded interaction, and one thing about it that is unknown but would change how it should be handled. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "data-architect": [
    {
      journeyId: "data-architect/schema-conformance-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one model from the recorded data architecture. Report its key relationships and name one field or relationship where the recorded architecture and the live schema could diverge without anyone noticing. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "data-steward": [
    {
      journeyId: "data-steward/record-quality-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one recorded asset class on this install. Report how many records it holds and name one specific quality problem — a duplicate, an orphan, or a field that is systematically empty — or say plainly that you found none and what you looked for. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "dispatcher": [
    {
      journeyId: "dispatcher/dispatch-board-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve today's scheduled jobs and available technicians on this install. Report how many jobs have an assignment, how many do not, and one job that could not be assigned with the reason why. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "doc-specialist": [
    {
      journeyId: "doc-specialist/documentation-currency-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one user-facing documentation page and the route it documents. Report whether the page still describes what the route does, and name one specific statement you could not verify from the code. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "ea-architect": [
    {
      journeyId: "ea-architect/capability-architecture-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one capability from the recorded enterprise architecture. Report what it claims to deliver and one place where the delivered code would have to change for that claim to remain true. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "external-catalog-scout": [
    {
      journeyId: "external-catalog-scout/catalog-candidate-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one external tool or integration recorded in the platform catalog. Report its source, its licence if recorded, and whether provenance is established well enough to adopt it. Say so plainly if it is not. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "external-claude-code": [
    {
      journeyId: "external-claude-code/workroom-claim-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one workroom claimed on this install. Report its branch, its executor, and whether it holds a live claim or has gone stale. Name the evidence you used to tell the difference. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "external-codex": [
    {
      journeyId: "external-codex/codex-workroom-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one workroom claimed on this install. Report its branch and whether recorded evidence exists for it. Governance reads evidence, not provenance — say what evidence is present, not which surface produced it. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "external-grok": [
    {
      journeyId: "external-grok/grok-workroom-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one workroom claimed on this install. Report its branch and whether recorded evidence exists for it. Say explicitly when evidence is absent rather than inferring a result from the branch existing. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "farm-ranch-steward": [
    {
      journeyId: "farm-ranch-steward/operation-state-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one recorded operational unit on this install — a field, herd, or production run. Report its current recorded state and one observation that would have to be made in person to confirm it. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "finance-controller": [
    {
      journeyId: "finance-controller/money-position-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the recorded finance state on this install. Report monthly burn and revenue if they are measurable, and for anything unmeasurable say exactly what would have to be recorded to make it known. Never present an absent number as zero. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "hr-specialist": [
    {
      journeyId: "hr-specialist/credential-readiness-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one employee or role record on this install. Report the credentials the role requires and whether each is recorded, current, or absent. Treat an unverifiable credential as absent, not as satisfied. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "integration-engineer": [
    {
      journeyId: "integration-engineer/integration-health-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one configured integration or provider connection. Report its status, when it was last exercised, and one failure mode that would not be visible from the status field alone. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "legal-operations-counsel": [
    {
      journeyId: "legal-operations-counsel/obligation-jurisdiction-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one recorded regulatory obligation on this install. Report which jurisdiction it arises from and one way the obligation would differ at a different authority layer — federal versus state versus local. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "licensing-specialist": [
    {
      journeyId: "licensing-specialist/licence-currency-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one licence requirement reference on this install. Report its issuing authority, when it was last verified, and whether it is inside the 90-day currency ceiling. If it has never been verified, say that rather than reporting its age. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "market-research-analyst": [
    {
      journeyId: "market-research-analyst/market-evidence-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one recorded market or competitor finding on this install. Report its source and date, and say whether it is current enough to act on or should be re-established first. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "platform-engineer": [
    {
      journeyId: "platform-engineer/runtime-posture-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the recorded runtime state of this install — services, versions, and recent operations. Report one divergence between what is recorded and what would be observable, and how you would confirm it. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "portfolio-advisor": [
    {
      journeyId: "portfolio-advisor/portfolio-position-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one digital product or portfolio item on this install. Report its lifecycle position and one piece of evidence that is missing before its next transition could honestly be approved. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "security-engineer": [
    {
      journeyId: "security-engineer/security-posture-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the recorded security posture of this install — detections, patch state, or access. Report one specific exposure and one thing that would have to be true for the recorded posture to be trustworthy. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "soc-incident-commander": [
    {
      journeyId: "soc-incident-commander/incident-state-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one security case on this install. Report its status, the response options that would apply, and confirm that executing any of them requires customer authorization rather than being available to you. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "soc-investigator": [
    {
      journeyId: "soc-investigator/case-scope-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one escalated security case. Report its timeline as recorded, the assets and identities implicated, and one gap in the evidence that would prevent a defensible verdict. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "soc-threat-hunter": [
    {
      journeyId: "soc-threat-hunter/coverage-gap-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the recorded detection coverage on this install. Name one ATT&CK technique or asset class with no detection, and the hunt you would run against it. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "soc-triage-analyst": [
    {
      journeyId: "soc-triage-analyst/detection-queue-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one open detection on this install. Report its enrichment state — asset, identity, threat-intel context — and what verdict the available evidence would support, or say that it supports none. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "storefront-advisor": [
    {
      journeyId: "storefront-advisor/storefront-consistency-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one storefront offer on this install. Report its price and availability as recorded, and one place where outward content could contradict it without anyone noticing. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "ux-accessibility-agent": [
    {
      journeyId: "ux-accessibility-agent/accessibility-surface-read",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve one user-facing route on this install. Report one specific accessibility risk on it — a missing text alternative, a contrast concern, or a structural problem — and the fix. Treat a failure as blocking, not advisory. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "evaluate-orchestrator": [
    {
      journeyId: "evaluate-orchestrator/evaluate-stream-survey",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the open work currently recorded in the evaluate value stream. Report how many items are routed to a named owner, how many are unowned, and one item whose ownership is ambiguous with the reason. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "explore-orchestrator": [
    {
      journeyId: "explore-orchestrator/explore-stream-survey",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the open work currently recorded in the explore value stream. Report how many items are routed to a named owner, how many are unowned, and one item whose ownership is ambiguous with the reason. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "integrate-orchestrator": [
    {
      journeyId: "integrate-orchestrator/integrate-stream-survey",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the open work currently recorded in the integrate value stream. Report how many items are routed to a named owner, how many are unowned, and one item whose ownership is ambiguous with the reason. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "deploy-orchestrator": [
    {
      journeyId: "deploy-orchestrator/deploy-stream-survey",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the open work currently recorded in the deploy value stream. Report how many items are routed to a named owner, how many are unowned, and one item whose ownership is ambiguous with the reason. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "release-orchestrator": [
    {
      journeyId: "release-orchestrator/release-stream-survey",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the open work currently recorded in the release value stream. Report how many items are routed to a named owner, how many are unowned, and one item whose ownership is ambiguous with the reason. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "consume-orchestrator": [
    {
      journeyId: "consume-orchestrator/consume-stream-survey",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the open work currently recorded in the consume value stream. Report how many items are routed to a named owner, how many are unowned, and one item whose ownership is ambiguous with the reason. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "operate-orchestrator": [
    {
      journeyId: "operate-orchestrator/operate-stream-survey",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the open work currently recorded in the operate value stream. Report how many items are routed to a named owner, how many are unowned, and one item whose ownership is ambiguous with the reason. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "governance-orchestrator": [
    {
      journeyId: "governance-orchestrator/governance-stream-survey",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the open work currently recorded in the governance value stream. Report how many items are routed to a named owner, how many are unowned, and one item whose ownership is ambiguous with the reason. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
  "finance-agent": [
    {
      journeyId: "finance-agent/recorded-money-position",
      mode: "act",
      prompt:
        "Certification probe (read-only). Retrieve the recorded finance state on this install. Report one figure that IS measurable with the window it covers, and one that is not, naming exactly what would have to be recorded to make it known. Do not create, modify, or delete anything. If every tool call fails, reply TOOL-FAILURE and name the tool you tried.",
    },
  ],
};

export function journeysForCoworker(agentId: string): GoldenJourney[] {
  const curated = CURATED_JOURNEYS[agentId];
  if (curated && curated.length > 0) {
    return curated.map((j) => ({ ...j, agentId, kind: "curated" as const }));
  }
  return [derivedReadProbe(agentId)];
}
