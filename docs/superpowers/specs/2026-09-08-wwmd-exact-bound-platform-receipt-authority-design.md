---
status: active
---

# WWMD Exact-Bound Platform Receipt Authority

**Backlog item:** BI-B19AF1F3

**Workroom:** WC-60566397

**Profile:** fix

**Decision:** DI-3F125C09C368 (`wwmd-exception-routing`)

## Problem and reproduced defect

The receipt writer is already constrained to an external MCP TaskRun, an exact writer, one backlog item, an immutable repository blob, and an eligible reviewer. At named pre-fix ref `d67c4d5dd469e73e0947102dfbabd8c7c10f578b`, `deriveCoworkerApprovalPolicy` turns Build Specialist's tier-1 identity into `approvalPolicy = all`. At delivered ref `f5681171c826a328c6795dfbdac8868efc2e4506`, a binding-specific shortcut instead returns `none`. The first behavior asks the founder to rubber-stamp routine evidence; the second skips the action-specific WWMD projector entirely. Neither makes the Workroom outcome and exact action evidence the authority boundary.

The live reproduction is BI-B3584737, TaskRun `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-133C509AF2C9`, and envelope `cmti2racd18zq01lht28321dp`: an immutable, finding-free research pass expired awaiting a human click. Source inspection ruled out receipt-schema validation and reviewer-independence validation: those gates run after authority and remain intact. It also ruled out the WWMD projector itself as absent; the projector exists, but the binding shortcut prevents the request from reaching it.

## Options considered

1. **Human every time.** Keep coworker-global approval as the final authority. Rejected because a routine exact-bound pass adds no unresolved judgment for the human and blocks unattended governed delivery.
2. **WWMD exception routing.** Project a current, high-confidence WWMD yes into one exact call; route every non-routine or uncertain case to a concise human decision card. Chosen by DI-3F125C09C368 with high confidence, no commandment conflict, and `autonomyEligible=true`.
3. **Never-human research.** Treat immutable binding or reviewer identity as authorization. Rejected because binding constrains what may be attempted but does not decide whether it should be written.

## Research and benchmarking

- [Open Policy Agent decision logs](https://www.openpolicyagent.org/docs/management-decision-logs) attach a decision ID, evaluated input, result, and policy/bundle revision for audit and offline reconstruction. DPF adopts the decision-ID and exact-input traceability shape, using its existing `DecisionInteraction`, `AuthorizationDecisionLog`, and envelope records rather than adding OPA.
- [Cedar](https://github.com/cedar-policy/cedar-docs/blob/main/docs/index.md) separates application operations from an authorization decision engine. DPF adopts that policy-decision/policy-enforcement separation at the universal governed-execute seam; it rejects a parallel Cedar policy language because WWMD and the existing projector already own platform judgment.
- [OpenFGA contextual tuples](https://openfga.dev/docs/interacting/contextual-tuples) demonstrate request-scoped authorization context that is checked under the same model as durable relations. DPF adopts the request-scoped principle for immutable TaskRun and Workroom bindings, but rejects a new relationship store because Workroom, TaskRun, grant, and receipt records are already canonical.

## Design grounding

- Existing specs/plans reviewed: `docs/superpowers/specs/2026-08-31-taskrun-async-push-delivery-design.md` owns TaskRun transport; it does not define this receipt-authority policy.
- Current code substrate reviewed: `apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts`, `apps/web/lib/govern/authority/resolve-policy-action-authority.ts`, `apps/web/lib/govern/authority/policy-authority-projector.ts`, and `apps/web/lib/tak/initiative-readiness-tool-grants.ts`.
- Source of truth: `INITIATIVE_READINESS_LANES` owns writer/gate pairings; TaskRun metadata owns immutable review binding; Workroom owns branch/head identity; the WWMD ledger and authority projector own platform judgment and its exact-call projection.
- Decision: extend those existing homes. Do not add a parallel policy store, binding registry, or receipt writer.

## Design

### One authority seam

Immutable initiative-review binding no longer returns an approval policy of `none`. A bound side effect enters the existing `evaluateCoworkerAuthority` approval branch. The existing policy-action resolver may satisfy that branch only for the routine class below. An explicit operator `always` policy remains human-only.

The validated `InitiativeReviewBinding` is preserved ephemerally on the server-resolved authority input. No model-visible parameter becomes authority, and no new persistent authority store is introduced.

### Routine admission predicate

All conditions are conjunctive:

- canonical organization scope is the platform sentinel and the subject is the binding's backlog item;
- TaskRun metadata was validated as an external MCP review and binds this exact writer;
- binding includes a Workroom ID, repository, branch, and head SHA;
- immutable artifact repository and commit equal the Workroom repository and head;
- writer and gate are paired by `INITIATIVE_READINESS_LANES`, the existing single registry;
- tool is an immediate, ordinary internal side effect with no outward, irreversible, authority-changing, or external-integration consequence;
- receipt decision is `pass`, `findings` is empty, and `resolvedFindingRefs` is empty;
- explicit operator policy permits policy projection.

The resolver then asks WWMD one action-specific question bound to the existing approval fingerprint. Only a sealed, current, high-confidence, usable, stable, autonomy-eligible `proceed` without commandment conflict projects. The resulting existing envelope is single-use. Existing persistence records the WWMD interaction, policy version, contribution/audit digest, exact action fingerprint, and approval-binding fingerprint.

### Human residue

If routine admission fails, WWMD is unavailable or uncertain, WWMD declines/conflicts, provenance or binding fails, risk exceeds the floor, or dual control applies, the resolver does not auto-authorize. It returns a short residue explanation to the existing approval-envelope path, which creates the human decision card. This reuses the platform's current card and resume mechanics rather than inventing a second escalation surface.

Receipt schema, immutable read evidence, independent-review enforcement, baseline minting, objective mapping, token scope, grant intersection, and database repository validation remain unchanged. There is no direct database writer or validation exception.

### Recovery packet binding

Every immutable initiative-review recovery packet carries its server-issued Workroom reference, not only objective mapping. This lets the authority seam prove Workroom/head exactness for research, specification, plan, and specialist-review receipts. A retained artifact from an older commit remains reviewable, but is intentionally human-routed rather than auto-authorized because it is not the current Workroom head.

## Ordered implementation

1. Preserve the validated immutable review binding in server-owned authority context.
2. Route bound side effects through the existing approval/policy seam while honoring explicit operator policy.
3. Add the pure routine-admission predicate using the existing readiness-lane registry and declared tool consequence.
4. Project only eligible exact calls and send every rejected/resolution residue to the existing human card.
5. Add Workroom refs to all immutable recovery packets.
6. Verify unit behavior, production type/build behavior, canonical runtime execution, independent receipts, objective reconciliation, and completion evidence.

## Objectives and acceptance

- **OBJ-WWMD-EXACT-AUTH:** Routine exact-bound platform receipts complete without a human click under an eligible WWMD decision.
  - **AC-WWMD-ROUTINE-PASS:** The BI-B3584737 receipt shape records and cites DI-3F125C09C368 or a fresh equivalent.
  - **AC-WWMD-AUDIT-BINDING:** Each automatic authorization persists the WWMD decision and exact binding fingerprints.
- **OBJ-WWMD-EXCEPTION-RESIDUE:** Non-routine or uncertain actions remain under human control.
  - **AC-WWMD-HUMAN-CARD:** Finding-bearing pass, fail/not-applicable, low confidence, unusable/unstable signal, commandment conflict, binding mismatch, cross-scope, destructive/outbound, customer-business, specialist-policy, and explicit-human-policy cases create a concise decision card stating the residue.
- **OBJ-WWMD-SINGLE-SOURCE:** Existing validation and authority stores remain canonical.
  - **AC-WWMD-NO-BYPASS:** No direct database bypass, parallel policy store, or weakened immutable receipt validation exists.

## Verification matrix

- Approval policy: tier 1/2/3 bound reviewers reach action-specific authority; unbound behavior and explicit `always` remain unchanged.
- Admission: routine pass; finding-bearing pass; fail; absent/mismatched writer, item, artifact, Workroom, or gate; customer organization; external integration; proposal; non-side-effect; declared outward/irreversible/authority consequence; explicit human policy.
- Projection: exact high-confidence pass; low confidence; unusable/unstable/weak coverage; commandment conflict; policy decline; stale provenance; action fingerprint mismatch; risk/delegation/dual-control; single-use replay.
- Escalation: unresolved residue is present on the existing human decision envelope.
- Packet seam: every emitted immutable binding parses and carries the exact Workroom ref; writer and reader tool scope remains closed.
- Live acceptance: an independent reviewer reads the current blob and records a passing routine receipt without a human click; ToolExecution and authority evidence cite the WWMD interaction and fingerprints.

## Data, scale, rollback, and documentation

No schema or migration is required. The hot path adds no unbounded collection: it performs constant-time checks over one parsed binding, then uses the existing bounded recent-decision lookup (25 candidates) and existing transactional projection. Broader role-derived coworker authority remains owned by EP-31815F97.

Rollback is a source revert of this scoped change. Existing human approval remains the fail-safe because every ineligible or unavailable projection returns to the envelope path. No data backfill is needed; already-recorded policy decisions and envelopes remain valid under their original fingerprints and expiry rules.

This design is the user/coworker-facing documentation impact for the authority behavior. The asynchronous TaskRun transport remains documented separately in `docs/superpowers/specs/2026-08-31-taskrun-async-push-delivery-design.md`; this document does not duplicate that transport design.
