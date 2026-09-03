# Terminal Readiness Read Projection Repair

- **Backlog item:** BI-72CEB47A
- **Epic:** EP-129D11FD
- **Profile:** fix
- **Canonical parent design:** `docs/superpowers/specs/2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md`
- **Live reproduction:** BI-A45D744A / WC-04941646 / IRD-BFB7EB781EEE

## Problem

The governed terminal-transition path correctly persisted an allowed completion decision for BI-A45D744A and then completed WC-04941646. A later `get_backlog_item` call nevertheless reports `status=done` while recomputing `completion=input-required` with delivery, acceptance, and objective-reconciliation evidence missing.

The contradiction is produced by the technical read adapter, not by missing delivery. `backlog-pack-read-tools.ts` gives `projectBacklogItemReadinessSummary` only baseline, gate-receipt, and plan-coverage activities. The summary then evaluates completion without the completion facts that the terminal repository had already validated and recorded in the immutable `initiative_readiness_decision` activity.

## Existing substrate

This repair introduces no table, receipt, tool, role, or permission.

- `BacklogItemActivity(kind="initiative_readiness_decision")` is the durable decision ledger.
- `terminal-transition-repository.ts` writes the exact decision, facts digest, transition object, authority snapshot, and evidence references before a terminal state change.
- `entry-adapter.ts` owns the canonical read projection.
- `backlog-pack-read-tools.ts` owns the MCP serialization boundary.
- Initiative-governance deletion already treats initiative-readiness decisions as governed artifacts.

The source graph was current on `main` but did not return a semantic hit; direct `origin/main` inspection identified the paths above. No competing open PR covered this defect when the design was written.

## Decision

For a terminal BacklogItem, the completion read projection reuses the latest valid persisted completion decision whose subject matches the exact BI and whose transition target is `completion`. This is a projection of the authoritative decision that permitted the terminal mutation, not a new authorization or a shortcut around evidence.

The persisted decision is accepted only when its schema is structurally valid, its subject is the exact BI, its target is completion, and its verdict is `allowed`. A malformed, cross-subject, denied, or input-required record is ignored and the normal evaluator remains fail closed.

Nonterminal items continue to recompute current design, plan, implementation, and completion readiness from canonical baseline, receipt, coverage, and completion inputs. Read projections never convert arbitrary evidence timeline prose into gate facts.

### Rejected alternatives

1. **Reconstruct all completion inputs in every read adapter.** This duplicates terminal-repository joins and can drift from the exact decision that performed the mutation.
2. **Add a terminal snapshot table.** The existing immutable decision activity already is the audited snapshot; a second ledger would violate single source of truth.
3. **Return `allowed` whenever status is `done`.** Status alone has no evidence or authority binding and would weaken fail-closed behavior.

## Authority, data, and runtime boundaries

- The server selects the activity from the BI's own ledger; callers cannot supply a decision or subject.
- The projection does not alter receipt creation, reviewer independence, terminal mutation, deletion, or authorization.
- Governed deletion/revocation continues to operate on the existing activity classes. If no valid terminal decision remains, the projection falls back to current fail-closed evaluation.
- The MCP response returns the same sanitized decision shape already exposed by initiative readiness; it does not disclose new restricted payloads.

## Implementation sequence

1. Add red pure-adapter tests for an exact-subject allowed terminal decision and malformed, mismatched, and non-allowed variants.
2. Add a red MCP backlog-read boundary test proving `status=done` and completion readiness do not contradict after a governed completion.
3. Parse and select the latest valid terminal completion decision in `entry-adapter.ts`; keep all other targets on the existing evaluator.
4. Pass initiative-readiness decision activities through the MCP read adapter.
5. Run the focused readiness and backlog-pack suites, web typecheck, blast-radius review, source guards, semantic review, protected CI, and live BI-A45D744A replay.

This is one atomic fix: the parser and serializer change are not independently shippable because either one alone leaves the live response contradictory.

## Acceptance and traceability

| Requirement | Verification |
|---|---|
| AC-TERM-READ-001: exact allowed terminal decision survives later reads | `entry-adapter.test.ts` |
| AC-TERM-READ-002: wrong subject/target/verdict/malformed payload cannot allow completion | `entry-adapter.test.ts` |
| AC-TERM-READ-003: MCP backlog response is internally consistent for a completed item | `backlog-pack-read-tools.test.ts` |
| AC-TERM-READ-004: nonterminal readiness remains recomputed and fail closed | existing plus new adapter cases |
| AC-TERM-READ-005: live BI-A45D744A reports `done` and completion `allowed` | post-release canonical-runtime verification |

## Rollback

Revert the parser and MCP activity-selection changes together. The immutable decisions and completed records remain untouched; rollback returns the previous contradictory read behavior but does not corrupt governance data.

