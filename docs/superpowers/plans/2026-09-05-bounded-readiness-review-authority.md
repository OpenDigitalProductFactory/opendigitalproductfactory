---
status: delivered-awaiting-closure
---

# Bounded initiative-readiness receipt authority

**Backlog item:** BI-921B7DC2  
**Workroom:** WC-FA670B64  
**Design:** `docs/superpowers/specs/2026-08-24-external-mcp-coworker-thread-context-design.md`  
**Decision:** DI-50CBE054E410

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion
gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Deliver OBJ-BTRA-1 and AC-BTRA-1 through AC-BTRA-4: an authenticated technical
coworker may write the exact initiative-readiness receipt fixed by a validated
server-issued binding without asking the business owner to approve that
technical judgment. Explicit `hitlPolicy: "always"` and every mission, spend,
destructive, external, legal, clinical, privacy, and safety approval boundary
remain unchanged.

## Delivery sequence

### 1. Reproduce the authority-policy defect

- Add the failing research-receipt case to
  `apps/web/lib/govern/authority/resolve-coworker-tool-authority.test.ts`.
- Prove the pre-fix generic tier/side-effect path creates an approval requirement
  even though the server binding, writer, subject, and grant all match.
- Verify with the focused authority test.

### 2. Make the narrow authority correction

- Update `apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts` to
  derive bounded initiative-review authority from the already validated binding.
- Reuse the canonical readiness-writer registry; do not create a second writer
  allow-list, envelope type, capability, table, or business-decision bypass.
- Keep explicit always-HITL first in precedence and keep unbound, malformed,
  mismatched, ungranted, wrong-subject, and consequential calls on their existing
  approval or denial path.
- Verify the regression turns green and the negative matrix remains green.

### 3. Reconcile the operating contract

- Update the canonical external-MCP coworker design with OBJ-BTRA-1,
  AC-BTRA-1 through AC-BTRA-4, the bounded authority rationale, and the ordered
  fix sequence.
- Update `docs/architecture/backlog-and-planning-runbook.md` so implementers do
  not route internal technical-readiness receipts to a nontechnical owner.
- Verify documentation links and generated-document guards in the merged-code
  gate.

### 4. Deliver and prove the outcome

- Pass the exact-tree local merged-code gate and independent semantic review.
- Deliver through a DCO-signed protected pull request and merge queue.
- Advance the canonical install through the governed self-upgrade path.
- Replay the BI-69803ACC server-bound research handoff and verify a persisted
  receipt, completed TaskRun, `requiresApproval=false`, and zero
  `CoworkerActionEnvelope` rows.
- Record final runtime and execution evidence before closing BI-921B7DC2.

## Backlog coverage

Decision: **atomic**. The regression, resolver change, preserved negative
authority matrix, documentation, protected delivery, and live replay are one
narrow policy correction. None is independently safe or useful without the
others, so all work remains mapped to BI-921B7DC2.

Traceability for the single delivery unit is explicit:

- Requirement: `OBJ-BTRA-1`.
- Contracts: `initiativeReviewBinding`, `coworker-authority-v1`, and
  `hitlPolicy:always`.
- Flow: `FLOW-BTRA-1` — validate the server-issued binding, resolve the bounded
  technical writer authority, persist the receipt, and verify the live result.
- Verification: `AC-BTRA-1`, `AC-BTRA-2`, `AC-BTRA-3`, and `AC-BTRA-4`.

| Deliverable | BI | Requirements | Contracts | Verification |
|---|---|---|---|---|
| Bounded readiness-receipt authority | BI-921B7DC2 | OBJ-BTRA-1; AC-BTRA-1–4 | `initiativeReviewBinding`; `coworker-authority-v1`; `hitlPolicy: always` | focused authority tests; merged-code CI; semantic review; canonical live replay |

The authoritative coverage receipt is recorded in DPF against this plan's
immutable repository revision. DPF remains the source of truth for the receipt
and deliverable mapping.

## Risks and rollback

- **Over-broad autonomy:** contained by exact item, artifact, gate, writer,
  grant, token-scope, tenant, and subject matching plus the always-HITL veto.
- **Duplicated policy sources:** avoided by deriving writer eligibility from the
  canonical initiative-readiness lane registry.
- **False success from structural tests:** prevented by the canonical live
  TaskRun/receipt/envelope replay.
- **Rollback:** revert the resolver commit through the protected PR path. That
  restores the prior approval behavior without a schema or data rollback.

## Completion gate

- Exact focused tests, typecheck/preflight obligations, merged-code CI, and
  independent semantic review pass.
- The protected pull request is merged and present in the served runtime.
- A fresh bound research TaskRun completes, persists its receipt, and creates no
  owner-facing approval envelope.
- Explicit always-HITL and consequential-action controls remain covered by the
  negative test matrix.
