---
status: draft
---

# Security and identity backlog reconciliation implementation plan

**Backlog:** BI-FE678DA3

**Epic:** EP-413F2602

**Design:** `docs/superpowers/specs/2026-08-30-security-authentication-hardening-successors-design.md` §10

**Workroom:** WC-DE9971CA for the initial documentation/process closure; a fresh implementation workroom for the automated detector

> **For agentic workers:** preserve live PostgreSQL as backlog truth and source control as design/plan truth. Never infer completion from a merged PR alone. Use canonical-runtime evidence for runtime acceptance, `dpf-local-merge-ci-before-push` for merged-code verification, and `dpf-pr-with-dco` for each independently reviewable delivery.

## Current evidence and delivery boundary

The assessment found three distinct drift classes: merged source with stale BI lifecycle, canonical specs that present absent historical ids as current coverage, and a filing procedure that can stop after BI creation without producing or linking the design needed to make the item implementable. BI-A91004A7 demonstrates why these states must remain distinct: PR #4825 and runtime startup logs prove the LDAPS listener exists, but they do not satisfy the BI's required client bind/search and group-membership acceptance.

This plan has two independently reviewable delivery increments under one BI. Increment A restores the current records and closes the procedural design gap. Increment B adds the repeatable detector that prevents recurrence. They share one acceptance contract but Increment A can land without pretending the detector exists.

## Increment A — reconcile current truth and repair capture procedure

### Phase A1 — evidence ledger

Build a ledger for every active security/identity deliverable: live BI and epic, canonical design/plan, merged PR/source, canonical-runtime evidence, unresolved acceptance, and defensible lifecycle state. Evidence categories remain separate; absence in one category is visible rather than inferred from another.

**Verification:** every correction cites source/runtime evidence and every unresolved acceptance remains open.

### Phase A2 — live backlog reconciliation

Use governed MCP transitions to repair stale states. For BI-A91004A7, record `build`/`medium` and keep it open until an actual LDAP client bind/search and group-membership result is captured. File any uncovered successor under the closest live epic only after substrate and overlap checks.

**Verification:** live reads show one current BI per unresolved deliverable and no item is marked done from merge/startup evidence alone.

### Phase A3 — canonical design and historical pointers

Update the security assessment and shared successor design with live IDs. Mark the retired `EP-BROWSER-DRIVE` roster as a historical snapshot and point its surviving external-tool authority concern to BI-8B7B2FE9. Preserve old identifiers as evidence; do not silently rewrite history.

**Verification:** current delivery sections contain live pointers; historical sections are explicitly labeled and do not masquerade as backlog coverage.

### Phase A4 — make design part of BI capture

Update `dpf-file-backlog-item` and the backlog/planning runbook so every build-bound BI is paired with an existing, extended, or new proportional canonical design. The generated BI id is cross-linked in the same branch/PR. A source-incapable caller leaves the item in triage with a visible design handoff and cannot report it as build-ready.

**Verification:** skill metadata exposes `search_specs_and_plans`; instructions and output receipt require an exact design path/section and status; process-spine and instruction-plane checks pass.

## Increment B — deterministic drift detection

### Phase B1 — red extraction and classification tests

Add fixtures for live ids, absent ids, historical/superseded annotations, wrong-parent epic, missing spec coverage, missing plan coverage, and a build-bound designless BI. Tests must distinguish corpus unavailable from measured-zero coverage.

### Phase B2 — source/live comparison

Implement one deterministic check that extracts canonical spec/plan BI and epic references, queries or consumes a governed live-backlog snapshot, and reports unresolved, mismatched, or designless active records. Historical references require a narrow explicit annotation; broad path/id ignore lists are prohibited.

### Phase B3 — CI/cadence integration and remediation output

Run the check at the existing planning/documentation governance boundary or governed cadence. Output exact BI/spec/section and recommended MCP/source action. Network or corpus unavailability is `unmeasured`, never green.

**Verification:** fixtures prove all drift classes; a seeded mismatch fails; the corrected snapshot passes; operator output is actionable and value-free.

## Backlog coverage

- **Decision:** one BI with two increments. The current-reconciliation/process repair and detector address one source/live consistency invariant; Increment A is useful and reviewable before Increment B.
- **Parent / implementation BI:** BI-FE678DA3.
- **Deliverable mapping:** `current-security-identity-reconciliation` and `backlog-design-capture-contract` → Increment A; `spec-backlog-drift-detector` → Increment B.
- **Dependencies:** live DPF MCP backlog, canonical `docs/superpowers` corpus, existing doc-index/check infrastructure, and independent design approval.
- **Governed receipt:** pending independent spec approval and immutable plan commit; record through `record_plan_backlog_coverage` before Increment B source implementation.

## Risks and rollback

| Risk | Control | Rollback |
|---|---|---|
| A merged PR is mistaken for completed acceptance. | Evidence ledger keeps merge, runtime, functional acceptance, and done separate. | Reopen/correct the BI through MCP with the missing evidence named. |
| Historical specs are rewritten and lose provenance. | Add dated supersession notes and live successor links; retain original roster text. | Revert the pointer edit without restoring stale ids as current coverage. |
| The filing rule overburdens small fixes. | Require proportional design, including a short design section where appropriate, while preserving the authority/data/runtime/non-goal contract. | Simplify the design template, not the requirement that build-bound work has design coverage. |
| CI treats an unavailable backlog/corpus as clean. | Model `unmeasured` explicitly and fail the governance check. | Disable promotion while connectivity/corpus access is repaired; never cache a false green. |

## Success evidence

Success means current security/identity work resolves to live BIs and canonical designs, LDAP remains open for its missing functional evidence, the new external-tool BI has both design and plan coverage, the filing workflow cannot silently finish with a designless build BI, and the follow-on detector has an executable, independently reviewed plan rather than an unchecked aspiration.
