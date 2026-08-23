---
status: draft
---

# Initiative readiness traversal and external evidence reconciliation

**Backlog item:** BI-F0715C9C  
**Workroom:** WC-2ABA65F7  
**Binding design:** `docs/superpowers/specs/2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md`  
**Policy change:** `initiative-readiness.v1` -> `initiative-readiness.v2`

## Problem

Initiative readiness fails closed, but several independent defects combine to
make the workflow impossible to traverse from a normal external development
identity.

The WordPress reproduction is authoritative:

- `BI-A45D744A` is a small bug with `scopeKind=platform`.
- `WC-E8275570` is bound to `fix/wordpress-operator-regressions`.
- `IRD-F6A6FC2E8BCC` assigned `cross-domain` and required canonical design,
  research, spec approval, six specialist reviews, objective baseline,
  artifact author, plan review, plan coverage, and traceability.
- The development PAT could not load any initiative receipt writer.
- `request_coworker` refused with `missing_threadId`; no matching coworker
  service offer existed.
- `record_external_development_evidence` recorded published commit
  `6b4ea6b906836b8e67b2afa53cf2aab25fdf03b1` and the design/plan paths, but
  left `Workroom.headSha=null`.

A separate pet-rescue initiative reproduces the reviewer-routing failure:

- `BI-D2A51B36` / `WC-B0DD2B2F` is pinned to provider commit
  `49140d33a9f7c2d62abcf1ffc28e0fbff50b1203`.
- External coworker handoff rejected `missing_threadId`; native build routing
  could not load the handoff tool after discovery; the workforce UI opened an
  ineligible/default coworker instead of the requested Enterprise Architect.
- Manual-check evidence `cmt5b0dy006gd01rmfykifyq3` records the blocked route.

Independent traversal on this repair BI also exposed a second authority
defect. `record_initiative_design_review(gate="spec-approval")`, executed by
the correctly granted `AGT-WS-REVIEW`, failed with `AUTHORIZATION_DENIED` and
"Spec approval requires an organization-bound authority decision."

This is not permission to skip readiness. The gate denies implementation
correctly but does not expose a governed path to satisfy the denial.

## Live evidence and root causes

| Area | Evidence | Root cause |
|---|---|---|
| Profile derivation | `profiles.ts` maps `platform` and `common` directly to `cross-domain` | Ownership scope is incorrectly treated as risk/coupling. |
| Requirement policy | `evaluate.ts` gives fix, feature, and cross-domain the same plan requirements and almost the same implementation requirements | The approved profile semantics were not encoded. |
| Tool disclosure | Exact `load_tools` requests for every initiative receipt writer returned no granted tools | The developer correctly lacks reviewer grants, but the response does not identify who can act. |
| Reviewer routing | `request_coworker` and `summon_coworker` reject PAT calls without `threadId` | The collaboration adapter assumes a portal thread and ignores the existing auth-bound `tasks/submit` substrate. |
| Workforce routing | WC-B0DD2B2F exhausted native discovery and the workforce UI opened a default/ineligible coworker | Handoff intent and exact eligible reviewer identity are not carried end to end. |
| Eligible reviewers | The live agent/grant registry has separate design, architecture, data, UX, security, compliance, domain, and evidence agents | The existing roster is not joined to unmet receipt authority. |
| Spec-approval authority | `writeAuthorizationDecision` persists `organizationId=null`; `deriveCoworkerAuthoritySubject` ignores `itemId`; the baseline repository requires an allow decision bound to the initiative organization | The generic authority gate discards the canonical initiative subject and organization before the independently authorized reviewer reaches receipt persistence. |
| Workroom synchronization | `adoptWorktreeCapsule` already updates `baseSha`, `headSha`, and `lastSyncedAt` | External evidence never verifies a provider branch head or passes a SHA to adoption. |
| Artifact author | `resolveRepositoryArtifact` requires one subject Workroom whose head equals the immutable commit | `ARTIFACT_AUTHOR_REQUIRED` is downstream of the missing head sync. |

The defect is a combination of profile derivation, per-profile policy,
progressive disclosure/recovery, external reviewer dispatch, authority-decision
subject binding, Workroom head synchronization, and downstream artifact-author
resolution. No new table, receipt type, grant, or reviewer role is needed.

## Existing substrate to preserve

- `BacklogItemActivity` remains the receipt and decision audit log.
- Initiative lane tools and grants remain the only receipt authority.
- `AuthorizationDecisionLog` remains the reviewer allow-decision audit record.
- The agent registry plus live `Agent.toolGrants` remains reviewer authority.
- `submitRemoteCoworkerTask` remains the auth-bound external TaskRun executor.
- `adoptWorktreeCapsule` remains the only Workroom head writer.
- `resolveRepositoryArtifact` remains the immutable blob, DCO, Workroom owner,
  and author resolver.
- Branch ambiguity, subject mismatch, reviewer/author separation, provider
  failure, and DCO mismatch remain fail-closed.

## Decision

### 1. Separate ownership scope from readiness risk

`scopeKind=platform` and `scopeKind=common` do not raise a profile by
themselves. They identify ownership, not how many contracts or domains a change
crosses.

Profile derivation remains monotonic from stronger evidence:

1. A recorded approved baseline/profile wins over weaker current metadata.
2. Explicit cross-domain/platform-wide, archetype, or active build-kind signals
   still raise the profile.
3. Archetype scope/categories remain conservative.
4. A bug with no stronger signal derives `fix`, including platform-owned code.

### 2. Encode a material, monotonic policy matrix

Version 2 implements the approved profile meanings.

| Profile | Plan-entry obligations | Additional implementation obligations |
|---|---|---|
| `doc-only` | classification and authorization | capsule identity; delivery/acceptance at completion |
| `fix` | classification, authorization, reproduction/causal research | canonical plan evidence, dependency disposition (N/A allowed), capsule identity |
| `feature` | fix plus canonical design, spec approval, architecture review, objective baseline, artifact author | plan review, coverage, traceability, dependency disposition, capsule identity |
| `cross-domain` | feature plus data, UX, security, compliance, and domain review/disposition | feature implementation obligations |
| `archetype` | cross-domain obligations | cross-domain plus archetype provisioning and completeness |

For a fix, `PLAN_REQUIRED` uses the canonical plan-coverage artifact projection
already used by the adapter. This keeps immutable plan verification without
feature-style objective mapping or six specialist reviews. Regression tests,
semantic review, blast-radius proof, DCO, pregate, and CI remain delivery gates
outside this policy function.

For feature and higher profiles, specialist `not-applicable` is an authenticated
reviewer disposition, not missing evidence. Cross-domain work must account for
every named lane. Archetype requirements remain strictly additive.

### 3. Return authority-aware recovery

Centralize initiative lane metadata (tool, grant, gates, accountable roles,
independence) in the existing initiative tool-grant module. The receipt pack
and recovery builder both consume it.

When a decision is not allowed, the claim response adds a bounded `recovery`
array. Each actionable entry contains:

- unmet code and accountable role;
- canonical receipt tool and required grant;
- whether independent authority is required;
- active, production, non-archived agents with the exact grant;
- one recommended agent, excluding the current author agent;
- an exact `request_coworker` packet and deterministic request key;
- one manual escalation only when no eligible reviewer exists.

Recovery never changes the verdict and never grants the caller reviewer
authority.

### 4. Reuse auth-bound tasks for threadless handoff

Do not add a reviewer-dispatch tool or session table. Do not require legacy
`Mcp-Session-Id`.

When `request_coworker` has no portal parent thread but has an authenticated
external PAT context, adapt it to `submitRemoteCoworkerTask`:

1. The caller remains a human-principal PAT with `agentId=null`.
2. `requestKey` becomes the idempotency key.
3. The task substrate creates a server-owned, auth-bound thread and TaskRun.
4. The target is resolved through lifecycle, clearance, and grant checks and
   receives only its own tools.
5. Receipt persistence still proves reviewer authority and separation.
6. The response returns the TaskRun/outcome; retries reuse the prior task.

Non-PAT missing-thread calls still fail. Portal calls retain the visible
collaboration-card path.

This supersedes the earlier transport-session proposal. DPF supports MCP
2025-11-25 sessions, but the 2026-07-28 MCP release candidate removes protocol
sessions and `Mcp-Session-Id`. Existing auth-bound tasks are already implemented
and follow the stateless direction.

The kernel comparison could not autonomously recommend because feature-vector
ingestion returned no usable signal (`DI-AA4E4F26593C`). The BI owner specified
the decision criterion: smallest architecture-consistent repair. Reusing the
existing task substrate meets it; no authority is inferred from the
inconclusive score.

### 5. Bind reviewer authority to the governed initiative

Do not accept an organization identifier from the receipt caller. Extend the
existing subject derivation so the server-recognized `itemId` becomes
`{ kind: "backlog-item", id }`. Before writing the generic authority decision,
resolve that canonical BacklogItem server-side and copy its `organizationId`
into `AuthorizationDecisionLog`.

The decision writer must bind `objectRef` to the derived backlog subject and
must fail closed when the item is absent, the item has no governed organization,
or the resolved organization conflicts with any authenticated execution
context. Other subject kinds keep their current behavior until they have an
equally canonical server-side organization resolver; there is no permissive
fallback from caller input.

This lets an independently granted design reviewer traverse the existing
`spec-approval` repository checks. It does not relax the checks, grant the
author review authority, or manufacture an organization for platform scope.

### 6. Reconcile provider-verified external evidence through adoption

Extend `record_external_development_evidence` with optional `headSha`.

- An explicit `headSha` must be 40-hex and, when `commits` is non-empty, must be
  present there.
- For compatibility, exactly one full SHA in `commits` is inferred when
  `headSha` is omitted.
- Ambiguous/non-immutable refs do not update the head and return an exact next
  action.
- The server resolves the canonical repository and provider branch ref. The
  provider branch head must equal the candidate SHA.
- Only a verified match reaches `captureExternalSessionEvidence`, which passes
  it to `adoptWorktreeCapsule`.
- Evidence remains durable when verification is unavailable, but the response
  says `not-reconciled`; artifact resolution remains blocked.

The response reports `reconciled`, `not-requested`, or `not-reconciled`, the
Workroom when known, accepted SHA when verified, and one next action. No parallel
Workroom writer is introduced.

### 7. Existing Workroom reconciliation is replay, not migration

No schema migration is needed. Replay the canonical external-development
evidence call with the same BI, branch, worktree, session, commit list, and
explicit head SHA. Adoption updates the existing Workroom and records the old
and new heads. The artifact resolver then performs provider blob and DCO checks.
Unverified, mismatched, ambiguous, or foreign artifacts remain blocked.

## Trust boundaries

| Boundary | Fail-closed rule |
|---|---|
| Metadata -> profile | Ownership is neutral; approved stronger profiles and explicit cross-domain/archetype signals stay monotonic. |
| Decision -> recovery | Recovery is advice/routing only; it cannot mutate receipt state. |
| Developer -> reviewer | The caller cannot load or borrow reviewer tools; an eligible agent executes with its own grant. |
| PAT -> TaskRun | User, token capability, clearance, lifecycle, idempotency, and risk class use the existing task checks. |
| Receipt call -> authority log | The server derives the backlog subject and organization; caller-supplied organization claims are ignored. |
| Evidence -> Workroom | Only a full provider branch-head match reaches adoption. |
| Workroom -> author | Exact subject/repo/head, provider blob, one DCO identity, and accountable owner remain required. |

## Acceptance and traceability

| ID | Requirement | Verification |
|---|---|---|
| `AC-PROFILE-FIX` | A small platform bug without stronger signals derives `fix`. | Profile unit test and BI-A45D744A-shaped fixture. |
| `AC-PROFILE-MONOTONIC` | Recorded cross-domain/archetype evidence still wins. | Profile regression tests. |
| `AC-POLICY-DIFFERENT` | Fix, feature, and cross-domain have materially different sets. | Table-driven pure-policy tests. |
| `AC-RECOVERY-ROUTE` | Missing grants identify exact eligible agents and request packet. | Recovery resolver and claim tests. |
| `AC-REVIEW-SEPARATION` | External fallback executes as target reviewer and never grants caller authority. | Coworker/task and receipt separation tests. |
| `AC-SPEC-AUTHORITY` | A correctly granted independent reviewer gets an organization-bound allow decision for the governed item; missing/mismatched subjects fail closed. | Authority-gate and exact spec-approval traversal tests. |
| `AC-HEAD-RECONCILE` | Provider-verified evidence updates the existing subject Workroom through adoption. | Provider, evidence handler, and capture tests. |
| `AC-AUTHOR-AFTER-SYNC` | Artifact author resolves after synchronization. | Repository-artifact integration fixture. |
| `AC-FAIL-CLOSED` | Unverified, mismatched, ambiguous, foreign, unsigned, or DCO-conflicting artifacts do not resolve. | Negative tests. |
| `AC-REPLAY` | Replaying evidence reconciles null/stale heads idempotently, and blocked Workrooms receive an exact reviewer route. | WC-E8275570- and WC-B0DD2B2F-shaped regression tests. |

## Non-goals

- No fabricated/proxy receipts for BI-A45D744A.
- No mutation of the WordPress repair branch.
- No new receipt type, reviewer role, grant, session table, or workflow engine.
- No automatic dispatch merely because readiness was read.
- No weakening of cross-domain, archetype, immutable artifact, DCO, semantic
  review, pregate, exact-tree CI, or PR health gates.
