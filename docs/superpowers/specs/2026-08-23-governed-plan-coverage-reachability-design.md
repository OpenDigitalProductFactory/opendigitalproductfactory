---
status: active
---

# Governed Plan-Coverage Reachability

- **Date:** 2026-08-23
- **Backlog item:** `BI-72F368BC`
- **Adjacent, independent:** `BI-38A353B2` (remediation text), `BI-F83CF689` (workroom branch identity)
- **Scope:** platform governance — initiative scope baselines and schema-v2 plan coverage
- **Decision:** `DI-C4CA74763089` — coworker-principal reviewer

## 1. Outcome

The plan-coverage receipt is the mechanism that stops deliverables rotting into
markdown checkboxes nobody queries. It was unreachable on every install: zero
`initiative_scope_baseline` activities existed anywhere, and all 54 recorded
`plan_backlog_coverage` activities are legacy schema v1.

1. **OBJ-GPCR-001:** An install with a single human principal can obtain an initiative scope baseline through a governed route, so a schema-v2 plan-coverage receipt is reachable from every delivery surface.
2. **OBJ-GPCR-002:** Separation of duties is unchanged: an artifact author cannot approve their own artifact, and no disposition, flag, threshold, or environment value grants an exception.
3. **OBJ-GPCR-003:** One answer to "who acted" — reviewer attribution follows the platform's canonical actor precedence rather than a second, divergent rule inside initiative readiness.
4. **OBJ-GPCR-004:** Every refusal on this path names the offending value and the remedy, and states a condition rather than a backlog identifier that goes stale when the work behind it ships.
5. **OBJ-GPCR-005:** A workroom's durable branch identity is single and keyed, so claiming work on a branch late-binds the existing capsule instead of forking a second one.

## 2. Existing substrate

Verified against the live install before any change was designed:

- `resolveGaidActorEnvelope` (`apps/web/lib/tak/gaid-actor-envelope.ts`) is the platform's canonical actor resolution: when a call carries an agent id, the accountable principal is the AGENT's principal; otherwise it is the authenticated human's.
- `resolvePrincipalIdForAgent` (`apps/web/lib/identity/principal-linking.ts`) already resolves a coworker principal from an `aliasType: "agent"` alias.
- Forty-plus coworkers hold a `Principal` of `kind: agent`. `change-reviewer` (`AGT-WS-REVIEW`) holds the `initiative_design_review` grant in both `packages/db/data/agent_registry.json` and the live `AgentToolGrant` table, and resolves to `PRN-a490fdac-4930-4f55-9885-cf40ddb0c003`.
- The install has exactly one `Principal` of `kind: human`.
- `scripts/check-doc-anchor-existence.mjs` already proves a cited backlog id EXISTS, with an MCP lookup, a grandfather baseline, and warn-pass degradation.
- `adopt_worktree` already declares "a branch has one durable workroom identity" and keys it on `(repositoryFullName, headBranch)`.

Nothing in this design is new substrate. The independent reviewer, its principal, its grant, the actor-precedence rule, the anchor-verification transport, and the branch identity key all existed; each was either unused or contradicted by a local rule.

## 3. Contract

**Reviewer attribution.** Both receipt writers resolve the accountable reviewer through one shared resolver with the canonical precedence: the coworker's principal when the call carries a registered agent id, the authenticated human's otherwise, and a refusal rather than a guess when an alias is ambiguous. Previously both read the human alias alone, so on a single-principal install every reviewer WAS the author and the spec-approval lane could not pass — the sole reason no baseline existed.

**Independence.** Unchanged and unweakened. Independence binds between principals; superuser status does not waive it; there is no break-glass path. Adding one would require its own design with second approval, expiry, rationale and durable audit, per the initiative-readiness design.

**The single-principal paved road.** The independent reviewer is an in-platform reviewer coworker, not another person. Summon it and have it record `record_initiative_design_review` with `gate: "spec-approval"`; the receipt is attributed to its principal. Recording the same call yourself is a self-review and is refused, correctly.

**Refusal text.** Every refusal on the coverage path names the offending value — the item, the deliverable key, the uncovered acceptance ids, the absent traceability input, the author and reviewer principals — and names the remedy. None cites a backlog identifier as a live blocker; a condition does not go stale.

**Branch identity.** A workroom is never created without a repository, and adopting a branch that carries a live repo-less capsule binds the repository to it rather than forking. A repo-less capsule bound to a different item refuses loudly.

## 4. Authority and data architecture

No schema change and no migration. Reviewer identity is read from the existing `Principal`/`PrincipalAlias` graph; the receipt continues to record `reviewerPrincipalId` and `reviewerAgentId`, and now records the identity actually accountable rather than the delegating one, which strengthens the audit trail. Workroom repository binding writes an existing nullable column. Legacy repo-less rows are resolved lazily on adopt with the repository the caller names, because a migration cannot know an install's repository.

## 5. Scale, security, and privacy

The reviewer resolution adds at most one indexed `PrincipalAlias` read per governed receipt. No unbounded query. No personal data enters a URL or a log line; principal identifiers are opaque. The new reference guard performs one MCP lookup per NEW citation in a changed file and warn-passes when the install is unreachable, so a runner without a portal can neither fail nor invent a defect.

## 6. Research and benchmarking

- **SOX / ISO 27001 segregation of duties** treats "maker" and "checker" as *roles*, not necessarily two humans; an automated control with its own identity and audit trail is an accepted checker where the control is independently governed. DPF adopts that reading: the coworker is a distinct accountable principal with its own grant and receipt, not a proxy for the author.
- **GitHub / GitLab required reviews** solve the same one-maintainer problem with a CODEOWNERS bot or an app identity that reviews under its own account, never by letting the author self-approve. DPF adopts the app-identity shape and rejects the "allow self-approval on small repos" setting both offer, because that is the exception this platform's doctrine explicitly forecloses.
- **Sigstore / in-toto attestation chains** bind an attestation to the identity that produced it and refuse to re-attribute it to a delegating account. DPF adopts that principle — attribute the act to the actor — and it is precisely what the defect violated.
- Rejected: a principal-count threshold that relaxes the gate below N principals. It makes the strength of a governance guarantee a function of install size, which is the opposite of a guarantee, and it scored last in the kernel ledger.

## 7. Failure and rollback

Every change is behavioural and additive; reverting the commits restores the prior refusal behaviour exactly, with no data to unwind. The single new persisted effect — a repository stamped onto a previously repo-less workroom — is the value that column was always meant to hold. If the reviewer resolver cannot resolve exactly one principal it returns null and the caller refuses, so an ambiguous identity fails closed rather than silently attributing a review.

## 8. Acceptance mapping

| ID | Objectives | Statement | Sections |
| --- | --- | --- | --- |
| AC-GPCR-001 | OBJ-GPCR-001, OBJ-GPCR-003 | A call carrying a registered coworker agent id resolves the reviewer to that coworker's principal, so the spec-approval gate passes on a single-human-principal install | §§2-3 |
| AC-GPCR-002 | OBJ-GPCR-002 | An author recording the gate themselves is refused as a self-review, and no `requiresIndependentReviewer` value, disposition, or override lets them through | §3 |
| AC-GPCR-003 | OBJ-GPCR-003 | An agent id with no registered principal falls back to the authenticated human, and an ambiguous alias returns a refusal rather than a chosen principal | §§3, 7 |
| AC-GPCR-004 | OBJ-GPCR-004 | The independence refusal names the author principal, the reviewer principal and kind, the gate, and the grant a reviewer coworker must hold | §3 |
| AC-GPCR-005 | OBJ-GPCR-004 | Every plan-coverage refusal names the offending value, and none cites a backlog identifier as a live blocker | §3 |
| AC-GPCR-006 | OBJ-GPCR-004 | A CI guard fails when changed source cites a CLOSED backlog id from user-facing text, and stays silent on a closed id recorded as provenance in a comment | §§2-3, 5 |
| AC-GPCR-007 | OBJ-GPCR-005 | Creating and planning a workroom always stamps a repository, and claiming a branch that carries a live repo-less capsule late-binds it instead of creating a second capsule | §§3-4 |
| AC-GPCR-008 | OBJ-GPCR-005 | A live repo-less capsule bound to a different backlog item raises branch_occupied rather than silently forking | §3 |

## 9. Review boundary

This design changes approval semantics, so it requires an independent design review recorded through the governed lane — which is also the mechanism it repairs. Data review is N/A: no schema, migration, or classification change. UX review is N/A: no user-facing surface changes; the only rendered text is refusal copy, covered by AC-GPCR-004 and AC-GPCR-005. Security review is applicable and is satisfied by AC-GPCR-002 and AC-GPCR-003 — the design's whole risk is that reachability is bought by weakening separation of duties, and those two statements are the assertions that it was not.
