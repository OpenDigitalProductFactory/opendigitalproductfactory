// apps/web/lib/gpp/shape-language/gate-ratification.ts
//
// The gate ratification table. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §7.2 (and the §4.5
// worked example); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3a-2, BI-6DA17863).
//
// A governed advance in today's registry is
// `{ kind: "governed-decision", condition, decisionScope }`, and `decisionScope`
// is a free string: it says nothing about which authority owns the gate,
// whether it is enforced, or whether it blocks. The decompiler (PR-3a-3) may
// add a typed `gate` to an advance only from a RATIFIED entry here. This file
// turns the parent design's "reported for founder ratification" step into a
// reviewable file.
//
// EVERY ENTRY IS `proposed` AT MERGE. Ratifying an entry is the founder's
// decision (WWMD), recorded as a DI, and lands as its own small PR (PR-3b-R
// for `outbound-customer-communication`). A ratification is a one-entry edit:
//
//   "outbound-customer-communication": {
//     status: "ratified",
//     proposed: { ...the gate the founder ratified... },
//     basis: "...",
//     decisionId: "DI-XXXXXXXXXXXX",   // matches DECISION_ID_PATTERN
//     ratifiedAt: "YYYY-MM-DD",
//   },
//
// plus deleting the "no entry is ratified at merge" assertion in the test, the
// first time. gate-ratification.test.ts refuses a ratified entry without a DI
// id and an ISO date, and refuses a table whose keys differ, in either
// direction, from the decision scopes the registry uses.
//
// How the proposals were made (each is a proposal only; the founder may change
// any value when ratifying):
// - `mode: "enforced"`, `blocking: true`: every governed stage today has a
//   `role:` principal. The drive never executes such a stage; it raises
//   attention and waits for the stage's completing receipt (drive-resolution.ts).
//   Nothing advances the room without it. The test derives this from the
//   registry, so a proposal cannot claim it for a stage it does not hold for.
// - `resolution: "accountable-human"`: a person holding the role decides. For
//   most scopes the person records `decision-record` evidence through
//   workroom-stage-decision.ts. The delivery scopes complete on other receipts
//   (merged-sha, acceptance-receipt, deployment-record, pir-receipt, plan,
//   spec and decomposition receipts); their basis says so.
// - `authority`: NOT derivable from the registry. It is the proposed owning
//   decision scope, grouped below: WWMD (platform direction), WWWD (the
//   organization's business choices), WSID (profession and craft judgment).
//   Each entry's `basis` gives the reason, so a reviewer can disagree with one
//   line rather than with the whole table.
// - Only `{ authority, mode, blocking, resolution }` is proposed. Escalation,
//   checkpoint, advisory and resolver are left for ratification: none of them
//   is a fact of today's runtime.
//
// OFFLINE TOOLING in Phase 3a: nothing in the running app imports this module.

import { DECISION_ID_PATTERN } from "@/lib/gpp/binding-enforcement";

import type { GppGate } from "./gpp-shape-schema";

export type GateRatificationEntry =
  | { status: "proposed"; proposed: GppGate; basis: string }
  | { status: "ratified"; proposed: GppGate; basis: string; decisionId: string; ratifiedAt: string };

type GateAuthority = GppGate["authority"];

/** A proposal for a `role:` stage the drive will not execute: enforced, blocking, decided by a person. */
function proposed(authority: GateAuthority, basis: string): GateRatificationEntry {
  return Object.freeze({
    status: "proposed",
    proposed: Object.freeze({ authority, mode: "enforced", blocking: true, resolution: "accountable-human" }),
    basis,
  });
}

const DELIVERY_RECEIPT_NOTE = "The stage completes on its delivery receipt, not on a decision-record.";

/**
 * Keyed by `decisionScope`. Grouped by proposed owning scope; alphabetical
 * within each group. Keys must equal the decision scopes used across
 * `listWorkShapes()` and `WORK_SHAPE_PRIOR_VERSIONS` (two-way test).
 */
export const GATE_RATIFICATION: Readonly<Record<string, GateRatificationEntry>> = Object.freeze({
  // ── Proposed WWMD: platform direction (how the platform itself is built, changed, released and extended) ──
  "architecture-alignment": proposed(
    "wwmd",
    "Ratifying delivered state against the recorded architecture is platform direction.",
  ),
  "break-fix-post-implementation-review": proposed(
    "wwmd",
    `Confirms a break-fix on the live install; part of the platform delivery process. ${DELIVERY_RECEIPT_NOTE}`,
  ),
  "change-merge-decision": proposed("wwmd", "Merging a change to the repository is governed by the platform delivery doctrine."),
  "contributor-admission": proposed("wwmd", "Who may contribute to the platform's source is platform direction."),
  "delivery-acceptance": proposed(
    "wwmd",
    `Independent acceptance on the live install is a platform delivery gate. ${DELIVERY_RECEIPT_NOTE}`,
  ),
  "delivery-deploy": proposed(
    "wwmd",
    `Advancing the install through /ops/self-upgrade is platform direction. ${DELIVERY_RECEIPT_NOTE}`,
  ),
  "delivery-merge": proposed(
    "wwmd",
    `Landing a delivery through the merge queue is platform direction. ${DELIVERY_RECEIPT_NOTE}`,
  ),
  "external-delivery-acceptance": proposed(
    "wwmd",
    "Accepting externally produced work on its evidence is the platform's evidence doctrine.",
  ),
  "external-tool-adoption": proposed(
    "wwmd",
    "Adopting an external tool falls under the platform's absorb-don't-adopt commandment.",
  ),
  "initiative-decomposition": proposed(
    "wwmd",
    `Approving an initiative's decomposition is part of the platform delivery process. ${DELIVERY_RECEIPT_NOTE}`,
  ),
  "initiative-outcome-reconciliation": proposed(
    "wwmd",
    `Reconciling delivered outcomes against the hypothesis closes a platform delivery. ${DELIVERY_RECEIPT_NOTE}`,
  ),
  "initiative-plan-coverage": proposed(
    "wwmd",
    `Plan and backlog coverage before build is platform delivery doctrine. ${DELIVERY_RECEIPT_NOTE}`,
  ),
  "initiative-spec-approval": proposed(
    "wwmd",
    `Spec approval and architecture review before build are platform delivery doctrine. ${DELIVERY_RECEIPT_NOTE}`,
  ),
  "integration-surface-authorization": proposed(
    "wwmd",
    "Authorizing an integration adoption, contract change or retirement changes the platform's dependency surface.",
  ),
  "release-cut-decision": proposed("wwmd", "Cutting a platform release is platform direction."),
  "repository-policy-change": proposed("wwmd", "Ratifying or correcting enforced repository policy is platform direction."),

  // ── Proposed WWWD: the organization's business choices ──
  "adopter-relationship-action": proposed("wwwd", "Acting on an adopter's health signal is a customer-relationship choice."),
  "backlog-admission": proposed(
    "wwwd",
    "Admitting an issue into the organization's backlog is the owner's prioritization choice. On the platform's own install this overlaps WWMD.",
  ),
  "bookkeeping-period-close": proposed("wwwd", "Accepting a reconciled books period is the organization's financial choice."),
  "compliance-obligation-response": proposed(
    "wwwd",
    "Accepting, deferring or remediating an obligation is the organization's risk choice.",
  ),
  "coworker-authority-change": proposed(
    "wwwd",
    "What the organization's coworkers may do; matches the WWWD authority of the existing coworker-authority-escalation binding.",
  ),
  "credential-rotation": proposed("wwwd", "Rotating a credential or accepting that it stands is the organization's risk choice."),
  "demand-prioritization": proposed("wwwd", "Directing the consume value stream is the organization's prioritization choice."),
  "estate-drift-response": proposed(
    "wwwd",
    "Accepting or remediating observed estate drift is the organization's operational choice.",
  ),
  "evaluation-priority": proposed("wwwd", "Directing the evaluate value stream is the organization's prioritization choice."),
  "exploration-direction": proposed("wwwd", "Directing the explore value stream is the organization's prioritization choice."),
  "finance-position-response": proposed("wwwd", "Deciding what to record or correct in the money position is a business choice."),
  "governance-position": proposed("wwwd", "Directing the governance value stream is the organization's choice."),
  "integration-sequencing": proposed("wwwd", "Directing the integrate value stream is the organization's prioritization choice."),
  "licensing-requirement-adoption": proposed(
    "wwwd",
    "Adopting, disputing or deferring a licensing requirement is the organization's compliance choice.",
  ),
  "market-research-adoption": proposed("wwwd", "What a market brief changes is a commercial choice."),
  "operational-response": proposed("wwwd", "Directing the operate value stream is the organization's choice."),
  "org-business-answer-confirmation": proposed(
    "wwwd",
    "Only a confirmed answer becomes the organization's stated position; WWWD by definition.",
  ),
  "outbound-customer-communication": proposed(
    "wwwd",
    "Replying to a customer is the organization's business decision; matches the WWWD tak-alignment-admit binding that covers outward calls (design §4.5).",
  ),
  "outbound-reply-approval": proposed(
    "wwwd",
    "Approving a reply that leaves under the organization's name is a business decision, as for outbound-customer-communication.",
  ),
  "outward-content-publication": proposed("wwwd", "Publishing outward content under the organization's name is a business decision."),
  "payables-disbursement": proposed("wwwd", "Paying, scheduling or disputing a bill is the organization's financial choice."),
  "portfolio-direction": proposed("wwwd", "Reprioritizing or restaffing the portfolio is the owner's business choice."),
  "promotion-readiness": proposed("wwwd", "Directing the deploy value stream is the organization's choice."),
  "release-authorization": proposed("wwwd", "Directing the release value stream is the organization's choice."),
  "seasonal-operations-response": proposed(
    "wwwd",
    "Work on land, livestock or crop is the operator's to commit; a business choice.",
  ),
  "security-advisory-response": proposed(
    "wwwd",
    "Accepting, patching or deferring an advisory is the organization's risk choice.",
  ),
  "security-incident-closure": proposed("wwwd", "The customer closes its own incident; a business decision."),
  "security-response-authorization": proposed(
    "wwwd",
    "The customer authorizes each response action on its own estate; a business decision.",
  ),
  "service-schedule-commitment": proposed(
    "wwwd",
    "Committing a schedule makes a customer-facing promise; a business decision.",
  ),
  "time-off-policy-publication": proposed("wwwd", "Publishing the organization's leave policy is a business decision."),
  "vendor-renewal-decision": proposed("wwwd", "Renewing, renegotiating or cancelling a vendor is a business decision."),
  "workforce-admission": proposed(
    "wwwd",
    "Admitting a person and granting access is the organization's workforce decision.",
  ),

  // ── Proposed WSID: profession and craft judgment ──
  "detection-content-activation": proposed(
    "wsid",
    "Activating, amending or declining a detection rule tuning is security-engineering craft judgment.",
  ),
  "ux-critique-adjudication": proposed(
    "wsid",
    "Accepting, amending or rejecting a UX critique finding is design craft judgment.",
  ),
});

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Why each ratified entry in `table` is not acceptable: a ratification must
 * cite a WWMD decision id (the pattern binding-enforcement.ts uses) and an ISO
 * 8601 date. Empty means every ratified entry is well-formed.
 */
export function gateRatificationRefusals(table: Readonly<Record<string, GateRatificationEntry>>): string[] {
  const refusals: string[] = [];
  for (const [scope, entry] of Object.entries(table)) {
    if (entry.status !== "ratified") continue;
    if (!DECISION_ID_PATTERN.test(entry.decisionId)) {
      refusals.push(`${scope}: decisionId must match ${DECISION_ID_PATTERN.source.replace(/^\^|\$$/g, "")} (a WWMD decision id)`);
    }
    if (!ISO_DATE_PATTERN.test(entry.ratifiedAt) || Number.isNaN(Date.parse(entry.ratifiedAt))) {
      refusals.push(`${scope}: ratifiedAt must be an ISO 8601 date`);
    }
  }
  return refusals;
}

/**
 * The ratified gate for a decision scope, or null when the scope is unknown or
 * only proposed. The decompiler adds `advance.gate` only from this. `table` is
 * injectable so tests can exercise a ratified entry without ratifying one.
 */
export function ratifiedGateFor(
  decisionScope: string,
  table: Readonly<Record<string, GateRatificationEntry>> = GATE_RATIFICATION,
): GppGate | null {
  const entry = Object.hasOwn(table, decisionScope) ? table[decisionScope] : undefined;
  return entry?.status === "ratified" ? entry.proposed : null;
}
