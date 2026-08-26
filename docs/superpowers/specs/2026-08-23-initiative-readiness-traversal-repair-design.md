---
status: active
---

# Initiative readiness traversal and external evidence reconciliation

**Backlog item:** BI-F0715C9C
**Workroom:** WC-7FF8A505
**Status:** active — **delivered** by PR #4633 (`ddd1ae31e`, 2026-08-24). See Delivery status.
**Binding design:** `docs/superpowers/specs/2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md`
**Policy change:** `initiative-readiness.v1` -> `initiative-readiness.v2`
**Kernel consults:** `DI-053D69EADEDC` (policy-authority bridge) · `DI-568FF23AF27B` (bootstrap authorizer) · `DI-5B6BF3990A83` (corroborating) · `DI-C9486164C49A` (publication route) · `DI-AA4E4F26593C` (inconclusive) · `DI-ECE6A1FCFFCA` (abstained) · `DI-F7361DD540E2` (superseded)
**Budget:** ~80% refactor/integration of existing substrate, ~20% new surface — the inverted allocation (`docs/design/golden-triangle-design.md:654` still states the retired 80/20 feature-first split).

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

## Objectives

1. **OBJ-IRT-001:** Small platform repairs derive the `fix` readiness profile unless stronger recorded evidence applies, and each profile retains a materially distinct monotonic requirement set.
2. **OBJ-IRT-002:** Every readiness refusal returns a deterministic, executable recovery packet for the exact eligible reviewer without changing the verdict, dispatching automatically, or opening a default coworker.
3. **OBJ-IRT-003:** External reviewers can inspect immutable source and record only their independently authorized lane while reviewer identity, artifact identity, and author separation remain server-bound.
4. **OBJ-IRT-004:** Initiative authority remains human-rooted, subject- and organization-scoped, expiring, single-use, and fail-closed for missing, stale, mismatched, or non-affirmative evidence.
5. **OBJ-IRT-005:** Provider-verified evidence reconciles the existing Workroom and plan coverage without holding network I/O inside the transactional commit boundary.
6. **OBJ-IRT-006:** The first-deployment bootstrap warrant is narrowly bound to the ratified artifact and path envelope, requires independent verification and protected checks, and cannot become a reusable bypass.

## Live evidence and root causes

| Area | Evidence | Root cause |
|---|---|---|
| Profile derivation | `profiles.ts` maps `platform` and `common` directly to `cross-domain` | Ownership scope is incorrectly treated as risk/coupling. |
| Requirement policy | `evaluate.ts` gives fix, feature, and cross-domain the same plan requirements and almost the same implementation requirements | The approved profile semantics were not encoded. |
| Tool disclosure | Exact `load_tools` requests for every initiative receipt writer returned no granted tools | The developer correctly lacks reviewer grants, but the response does not identify who can act. |
| Claim recovery serialization | On candidate `702332388d009950670bd7ecaf6facff1710a393`, preview claim decision `IRD-5B5D2B34D6C3` correctly returned profile `fix`, verdict `input-required`, and unmet `RESEARCH_REQUIRED` plus `PLAN_REQUIRED`, but the MCP result contained no `recovery` object | `claimGovernedBacklogWorkspace` computes recovery, then `claim-backlog-item-handler.ts` serializes only `workIntent` and `readiness` on `!governed.ok`, dropping the recovery contract at the MCP boundary. |
| Recovery packet completeness | The computed reviewer route contains role, tool, grant, target identity, and independence only; the operator had to construct the no-thread handoff packet out of band | The recovery producer omits `requestKey`, `objective`, `questionPacketSummary`, exact gate/artifact bindings, and the executable `request_coworker` arguments required by the design. |
| Reviewer routing | `request_coworker` and `summon_coworker` reject PAT calls without `threadId` | The collaboration adapter assumes a portal thread and ignores the existing auth-bound `tasks/submit` substrate. |
| Workforce routing | WC-B0DD2B2F exhausted native discovery and the workforce UI opened a default/ineligible coworker | Handoff intent and exact eligible reviewer identity are not carried end to end. |
| Eligible reviewers | The live agent/grant registry has separate design, architecture, data, UX, security, compliance, domain, and evidence agents | The existing roster is not joined to unmet receipt authority. |
| Spec-approval authority | `writeAuthorizationDecision` persists `organizationId=null`; `deriveCoworkerAuthoritySubject` ignores `itemId`; the baseline repository requires an allow decision bound to the initiative organization | The generic authority gate discards the canonical initiative subject and organization before the independently authorized reviewer reaches receipt persistence. |
| Receipt freshness | With no approved baseline, `entry-adapter.ts` passes `canonicalDigest=null`, so specialist receipts bound to superseded commit `e89f362` still project as satisfied against the current `ad873ed` design | Pre-baseline review evidence has no canonical proposed-design digest anchor. |
| Workroom synchronization | `adoptWorktreeCapsule` already updates `baseSha`, `headSha`, and `lastSyncedAt` | External evidence never verifies a provider branch head or passes a SHA to adoption. |
| Artifact author | `resolveRepositoryArtifact` requires one subject Workroom whose head equals the immutable commit | `ARTIFACT_AUTHOR_REQUIRED` is downstream of the missing head sync. |
| Plan coverage persistence | WC-A31DBE53 now resolves plan blob `8f933b3c9312f0a3b2f01794f421ac4b9cace01e` and validates five mappings, but commit attempts expire at 5,532 ms and 8,431 ms against Prisma's 5,000 ms interactive-transaction limit | `recordPlanBacklogCoverage` performs provider commit, DCO, blob, alias, and Workroom resolution while holding a serializable parent-row lock. |
| Policy-to-authority bridge | `DecisionInteraction` seals the owning WWMD/WWWD/WSID judgment, profile version, evidence, scores, and outcome. `AuthorizationDecisionLog`, `DelegationGrant`, and `CoworkerActionEnvelope` already carry human-rooted, scoped, expiring action authority. Workroom evidence `cmt5wqbft0j8c01rm8l54p0g5` records `DI-053D69EADEDC`: `policy-authority-bridge`, high confidence, composite `15.883`, margin `5.984`, `autonomyEligible=true`, and no commandment conflict. | The judgment and action-authority substrates are not connected by one canonical projector. A raw DecisionInteraction reference is currently treated as presence evidence, not as a verified bounded authority decision, so a valid policy “yes” cannot authorize the exact action and a normal identity receives no lawful next step. |
| Portal projection | Candidate preview renders BI-F0715C9C as `READY TO BUILD` with an enabled Build Studio action while the canonical claim verdict is `input-required`; `/build/work/WC-7FF8A505` omits the verdict, unmet requirements, reviewer route, head SHA, and next action | Existing BI `BI-812AC0D8` owns the cross-surface readiness presenter and action suppression. This repair must not claim multi-surface completion before that governed follow-up is delivered. |

The defect is a combination of profile derivation, per-profile policy,
progressive disclosure/recovery, external reviewer dispatch, authority-decision
subject binding, Workroom head synchronization, and downstream artifact-author
resolution, plus the missing policy-to-authority projection. No new table,
receipt type, grant, or reviewer role is needed.

## Existing substrate to preserve

- `BacklogItemActivity` remains the receipt and decision audit log.
- `DecisionInteraction` remains the judgment system of record; it is never
  queried directly as RBAC.
- `DecisionPerspectiveProfileVersion` and its promoting principal remain the
  versioned, human-rooted standing-policy provenance.
- `DelegationGrant`, `AuthorizationDecisionLog`, and `CoworkerActionEnvelope`
  remain the delegation, decision-audit, expiry, and execution substrates. No
  policy-authorization or standing-order table is introduced.
- Initiative lane tools and grants remain the only receipt authority.
- `AuthorizationDecisionLog` remains the reviewer allow-decision audit record.
- The agent registry plus live `Agent.toolGrants` remains reviewer authority.
- `submitRemoteCoworkerTask` remains the auth-bound external TaskRun executor.
- `adoptWorktreeCapsule` remains the only Workroom head writer.
- `resolveRepositoryArtifact` remains the immutable blob, DCO, Workroom owner,
  and author resolver.
- Serializable parent/baseline/mapped-item validation remains the plan coverage
  commit boundary; provider network I/O does not run while that lock is held.
- Branch ambiguity, subject mismatch, reviewer/author separation, provider
  failure, and DCO mismatch remain fail-closed.
- Superseded receipts remain immutable audit history but never satisfy a newer
  proposed or approved artifact.

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

**Two cells of this table do not match the shipped `evaluate.ts`** — `doc-only`
implementation obligations and whether the `feature` row restates `PLAN_REQUIRED`.
Both are recorded as open questions (see Open questions, OQ-1 and OQ-2) rather than
corrected in place, because it is not settled which side is wrong.

### 3. Return authority-aware recovery

Centralize initiative lane metadata (tool, grant, gates, accountable roles,
independence) in the existing initiative tool-grant module. The receipt pack
and recovery builder both consume it.

> **Hazard — realized, not hypothetical (BI-CC9D5997).** "The receipt pack and
> recovery builder both consume it" is under-specified, and the implementation
> read it the dangerous way. `initiativeReadinessPack` derives its `handlers` and
> `grants` from every `LANES` key while hand-listing `definitions`, so PR #4641
> adding a `record_plan_backlog_coverage` lane **for disclosure only** also
> installed a competing handler. `composeToolPacks` rejects duplicate definitions
> but overwrites handlers silently and last-pack-wins, so the readiness
> gate-receipt handler replaced `decompositionPack`'s real one. The tool now
> rejects its own published schema with `gate-not-authorized`, blocking both
> plan-bearing PRs and completion of delivered items.
>
> **The lane registry is a disclosure catalogue, not an authority source.** Naming
> a tool so recovery can point at it must never confer the right to serve it.
> Handlers and grants must derive from a pack's declared `definitions` — or from
> an explicit non-disclosure subset — and `composeToolPacks` must reject handler
> and grant collisions as loudly as it rejects definition collisions. Read this
> paragraph as part of §3, not as an erratum.

When a decision is not allowed, the governed claim and its MCP adapter return
the same bounded `recovery` object. The adapter may add transport metadata, but
it may not select or omit fields. Every unmet requirement is represented by
either an executable next action or one explicit escalation; unmapped
requirements may not silently disappear.

Each eligible reviewer route contains:

- unmet code and accountable role;
- canonical receipt tool and required grant;
- whether independent authority is required;
- active, production, non-archived agents with the exact grant;
- one recommended agent, excluding the current author agent;
- the exact unmet gate, BI, Workroom, repository, branch, and immutable
  artifact identity used by the reviewer action;
- an exact `request_coworker` packet with `targetAgent`, `objective`,
  `questionPacketSummary`, deterministic `requestKey`, `tier=2`, and
  `enteredVia=handoff`;
- one manual escalation only when no eligible reviewer exists.

The server constructs, returns, and tests the whole packet. Callers and portal
components must not synthesize it. For artifact-bound review, the deterministic
key is `initiative-readiness:<BI>:<gate>:<headSha>` and the objective names the
exact BI, Workroom, canonical artifact, receipt tool, and independent-review
constraint. If the Workroom, gate, target, or immutable artifact binding is
missing or stale, recovery returns a bounded escalation explaining that exact
binding failure and no executable dispatch packet. Returning recovery never
dispatches automatically.

Recovery never changes the verdict and never grants the caller reviewer
authority.

The operator-facing action must preserve the recommended agent's canonical
`agentId` from projection through dispatch. A portal launcher may render the
agent's display name, but it must open or submit to that exact identity. If the
identity is no longer eligible, show the stale-route reason and refresh
recovery; never fall back to the first/default coworker. This is the UI
invariant violated by `WC-B0DD2B2F`.

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

The superseded transport-session design and plan are removed from this branch.
Their commits remain in Git history for audit, but they are not part of the
approved architecture artifact and no transport-session production code exists
in this design-stage tree.

The kernel comparison could not autonomously recommend because feature-vector
ingestion returned no usable signal (`DI-AA4E4F26593C`). The BI owner specified
the decision criterion: smallest architecture-consistent repair. Reusing the
existing task substrate meets it; no authority is inferred from the
inconclusive score.

### 5. Bind reviewer authority to the governed initiative

Do not accept an organization identifier from the receipt caller. Extend the
existing subject derivation so the server-recognized `itemId` becomes
`{ kind: "backlog-item", id }`. Before writing the generic authority decision,
resolve that canonical BacklogItem server-side. For an organization-bound item,
require an authenticated execution organization and an exact match to the
item's `organizationId`. For an organizationless platform item, retain the exact
backlog-item subject and bind the decision to the existing non-tenant authority
scope sentinel `organizationId="platform"`.

The decision writer must bind `objectRef` to the derived backlog subject and
must fail closed when the item is absent, an organization-bound item lacks a
matching authenticated execution organization, or the resolved organization
conflicts with that context. The caller cannot select, supply, or fabricate an
organization for either case: the server derives the tenant organization or
the `platform` authority scope from the governed BacklogItem. Other subject
kinds keep their current behavior until they have an equally canonical
server-side organization resolver; there is no permissive fallback from caller
input.

This lets an independently granted design reviewer traverse the existing
`spec-approval` repository checks. It does not relax the checks, grant the
author review authority, collapse the object to a generic platform subject, or
manufacture a tenant organization for platform scope.

### 6. Anchor pre-baseline receipts to the proposed design

The approved baseline digest remains authoritative after spec approval. Before
a baseline exists, derive one proposed-design digest from the latest valid
`design-spec` receipt for the subject. Project all other artifact-bound receipts
against that digest; a different digest is `stale`, not satisfied. A malformed
or absent `design-spec` receipt provides no permissive fallback: dependent
review lanes remain missing or stale.

This uses the existing receipt artifact digest and chronological append-only
log. It adds no candidate table or mutable pointer. Re-reviewing a revised
design appends a new `design-spec` receipt, making prior specialist receipts
stale while preserving them for audit. Atomic spec approval then pins that same
digest as the baseline.

### 7. Reconcile provider-verified external evidence through adoption

Extend `record_external_development_evidence` with the canonical repository
identity and infer a reconciliation candidate only when `commits` contains
exactly one full 40-hex published SHA.

- The caller never supplies a trusted `headSha`; it supplies development
  evidence, and the server derives the only immutable candidate.
- Zero, multiple, abbreviated, or malformed SHAs leave the Workroom head
  unchanged.
- The server resolves the canonical repository and provider branch ref. The
  provider branch head must equal the candidate SHA.
- Only a verified match reaches `captureExternalSessionEvidence`, which passes
  it to `adoptWorktreeCapsule`.
- Evidence remains durable when verification is unavailable, but the response
  says `not-reconciled`; artifact resolution remains blocked.

The evidence record remains durable when reconciliation is unavailable, but no
head is adopted and artifact resolution remains blocked. No parallel Workroom
writer is introduced.

### 8. Existing Workroom reconciliation is replay, not migration

No schema migration is needed. Replay the canonical external-development
evidence call with the same BI, branch, worktree, session, commit list, and
explicit head SHA. Adoption updates the existing Workroom and records the old
and new heads. The artifact resolver then performs provider blob and DCO checks.
Unverified, mismatched, ambiguous, or foreign artifacts remain blocked.

### 9. Keep provider verification outside the plan-coverage transaction

The veterinary recovery fixture proves provenance is no longer its active
boundary. `WC-A31DBE53` is synchronized to base
`abaa0452d199b058bbdcb638c7d370075947f82a` and head
`d7470e7457e958b5919e98e017fd5865ea4c22fb`; the immutable plan resolves and
all five mappings validate. The remaining failure is transaction shape, not a
reason to increase a global timeout.

Resolve the immutable provider commit, DCO identity, and plan blob before
opening the interactive transaction. Carry the resolved digest, bytes, author,
and exact capsule/repository/commit binding into the transaction. Under the
existing serializable boundary:

1. lock the parent BacklogItem;
2. lock and re-read the exact subject Workroom;
3. require its repository, head, accountable principal, and non-terminal state
   to match the preflight binding;
4. re-read the current scope baseline and mapped BacklogItems;
5. validate the supplied mappings against the pre-resolved immutable bytes;
6. append the coverage receipt.

No fetch, credential lookup, provider call, or DCO parsing occurs while the
database locks are held. A changed head, owner, baseline, mapping target, or
ambiguous Workroom fails closed and writes no receipt. A Prisma transaction
expiry/conflict returns a typed, actionable retry response for the same
immutable packet; it is never reported as `plan-artifact-invalid` and never
implies a partial receipt.

### 10. Project owning policy judgments into bounded action authority

This repair exposed a general gap, not a reason for a BI-specific exception.
DPF can decide what should happen through WWMD, WWWD, and WSID, and it can
enforce action authority, but it cannot yet translate a high-quality owning
policy judgment into the exact authority envelope that the action gate
consumes.

The existing substrate audit considered four shapes:

| Shape | Disposition |
|---|---|
| Read `DecisionInteraction` as RBAC | Reject. A judgment record is evidence, not a reusable grant; direct reads would omit expiry, subject/action/artifact binding, delegation provenance, and consumption. |
| Require fresh human approval for every work item | Reject. It defeats approved trusted autonomy and is non-traversable on an install with one human principal. Independent human or specialist review remains mandatory only where the risk policy requires it. |
| Add a policy-authorization or standing-order table | Reject. Versioned policy, human promotion, delegation, authorization logging, expiry, and action-envelope lifecycle already exist. |
| Add one policy-authority bridge | Select. Keep judgment and enforcement separate, then project only an explicit eligible “yes” into the existing bounded authority substrate. |

`DI-053D69EADEDC` selected `policy-authority-bridge` with high confidence,
composite `15.883`, margin `5.984`, `autonomyEligible=true`, and no commandment
conflict. Workroom activity `cmt5wqbft0j8c01rm8l54p0g5` preserves the
recommendation and contribution evidence. It supersedes the earlier
BI-specific two-human binding recommendation `DI-F7361DD540E2`; the earlier
row remains immutable audit history.

The bridge's first deployment needs a separate, non-circular authority
boundary because the projector cannot authorize the code that first deploys
it. A follow-up kernel comparison considered three bootstrap shapes. The
authoritative bootstrap-authorizer consult is `DI-568FF23AF27B`; an independent
architecture-local comparison, `DI-5B6BF3990A83`, reached the same ordering:

| Shape | Composite | Disposition |
|---|---:|---|
| Universal second distinct human | `1.282` in the corroborating consult | Reject as the default. It recreates per-work approval and makes a single-owner install structurally non-traversable. It remains mandatory when a standing policy, regulation, risk class, commandment conflict, or irreversible/outbound floor explicitly requires dual-human control. |
| Human-rooted standing policy + explicit eligible judgment + independent exact-tree review + scoped warrant | `7.574` in the corroborating consult | Select. It preserves the human root and independent control without mistaking review for authority. |
| Root human instruction alone | `0.338` in the corroborating consult | Reject. It lacks the sealed policy judgment, immutable artifact binding, independent review, expiry, and consumption boundary. |

`DI-568FF23AF27B` selected `policy-derived-second-check` with high confidence,
composite `16.683`, margin `5.305`, `autonomyEligible=true`, and no commandment
conflict. Corroborating `DI-5B6BF3990A83` selected the same middle shape with
high confidence, margin `6.293`, stable sensitivity, and no conflict.
`DI-ECE6A1FCFFCA` is retained as an abstained, unusable evidence attempt; it
grants nothing. The selected bootstrap does not change the universal bridge
design and is not a reusable break-glass path.

#### Judgment input

The bridge is universal across the three owning policy gates:

- WWMD governs platform/founder policy;
- WWWD governs the subject organization's business policy;
- WSID governs the owning profession's practice policy.

The caller supplies only the intended action envelope. The server resolves the
owning gate and loads the sealed `DecisionInteraction`, its current
`DecisionPerspectiveProfileVersion`, promoting principal, evidence bundle,
scored options, weighting/contribution ledger, signal-quality flags, human
outcome, and commandment-conflict state. The closed action registry maps the
action to the affirmative option identifier; the bridge never treats arbitrary
free text, confidence alone, or a caller-provided interpretation as “yes.”

An unattended allow requires all of these facts:

1. The owning decision is final and explicitly selects the registered
   affirmative option. A `no`, `decline`, `revise`, `defer`, `escalate`, null,
   ambiguous, or unregistered outcome cannot authorize the action.
2. The recorded signal is usable, high-confidence, sensitivity-stable,
   strongly covered, `autonomyEligible=true`, and free of commandment conflict.
3. The policy profile/version is current for the owning subject and its human
   approval provenance is resolvable. For WWMD, Mark's approval of the WWMD
   criteria is the human-rooted standing delegation; WWWD and WSID must resolve
   their own organization/profession owner and may not inherit WWMD authority.
4. Any required `DelegationGrant` is active, unexpired, within risk, workflow,
   subject, object, action, and use-count limits, and rooted in that human
   principal.
5. The exact actor, organization, BI/Workroom or other subject, action key,
   repository/branch, immutable artifact digest, route, constraints, and
   current policy version match the decision context.

Missing or stale evidence, a superseded policy version, revoked delegation,
wrong gate, cross-organization or cross-profession reuse, artifact drift, or a
non-affirmative result returns deny or escalate. It never falls back to a
generic platform subject, superuser authority, or per-work approval proxy.

The projected standing-policy version is the existing
`DecisionPerspectiveProfileVersion.versionId`, with
`promotedByPrincipalId` as its human approval provenance. “Standing order” in
the authority receipt names that versioned policy relationship; it does not
introduce the deferred `StandingOrder` model described by capacity-continuity
designs.

#### Authority projection and consumption

On an eligible affirmative judgment, one transactional projector appends an
`AuthorizationDecisionLog` and creates or advances the existing exact-call
`CoworkerActionEnvelope` to the approved state under the standing delegation.
The log and envelope record:

- the `DecisionInteraction.interactionId`, owning gate, profile and version;
- standing-policy approval provenance and any `DelegationGrant` or
  `DelegationChain` reference;
- evidence references, scored options, weights/contribution digest,
  signal-quality result, confidence, and conflict flags;
- human root plus acting agent, organization, subject, action, route,
  immutable artifact/input fingerprint, and constraints;
- issue/expiry times, bounded use count, rationale, and projector policy
  version.

The action gate consumes the projected authorization, not the
`DecisionInteraction`. It re-derives the same server-owned binding, requires an
unexpired approved envelope and matching allow log, retains every intrinsic
role/grant and reviewer-author check, and atomically records execution success
or failure. The projection cannot create a reviewer grant, satisfy an
initiative receipt, widen the original delegation, or authorize a different
action. Retry is idempotent for the same decision and fingerprint; a changed
artifact or action requires a new owning judgment.

#### Actionable recovery

When no authorization can be projected, a normal development identity receives
one executable next step instead of an impossible checklist:

- `deny`: show the owning gate's explicit reason and stop;
- `defer` or `escalate`: route to that gate's existing human decision surface;
- missing or stale judgment: return the exact WWMD, WWWD, or WSID evaluation
  packet for the current subject/action/artifact;
- eligible “yes” but unavailable reviewer receipt authority: dispatch or name
  the independently eligible reviewer through the recovery route in section 3.

The bridge does not remove independent review. It removes the unrelated demand
for a second human to ratify every policy decision that already falls within a
human-approved standing autonomy envelope.

#### One-time first-deployment bootstrap envelope

The existing repository contribution boundary is independent of the broken
runtime projector and can lawfully bootstrap its first deployment, but only as
one conjunctive, immutable envelope. It consists of:

1. Mark's versioned approval of the WWMD criteria as the human root;
2. the explicit, autonomy-eligible recommendation `DI-568FF23AF27B` for this
   bootstrap shape, corroborating `DI-5B6BF3990A83`, and a fresh operator
   ratification of the exact published design/plan identity after this
   amendment;
3. one DCO-signed candidate derived from the ratified base and confined to the
   permitted paths below;
4. a fresh independent semantic and architecture review bound to the exact
   candidate base tree, head tree, and diff digest;
5. the protected repository's required checks, linear-history rule,
   conversation resolution, and merge queue.

Live branch-rule evidence on 2026-08-23 confirms required `DCO`, `Merge
Readiness`, and `UX Route Budget Sweep` checks, enforced administrators,
linear history, blocked force-push/deletion, conversation resolution, and the
merge queue. It also confirms `required_approving_review_count=0`, no code-owner
review requirement, and no last-push approval requirement. Therefore this
design does not misstate GitHub automation as a second human. Independent
exact-tree review is a governed precondition. A distinct human GitHub approval
is additionally required only when a policy floor explicitly requires it; on
this one-human install such a floor must fail closed until another eligible
human exists or the root policy is explicitly amended.

The envelope is bound to:

- BI `BI-F0715C9C`, Workroom `WC-7FF8A505`, repository
  `OpenDigitalProductFactory/opendigitalproductfactory`, and branch
  `fix/initiative-readiness-traversal-recovery`;
- recovery base `f20a78f63dc1884eea0fc171d04556b4be8de32f`;
- the exact design and plan commit/blobs named by the post-amendment
  ratification, plus the ratified base commit;
- test-first authorship, refactoring inside the same contracts, documentation,
  verification, DCO publication, independent review, protected PR, and merge
  queue actions only;
- only the exact candidate files below; no directory-wide or adjacent-package
  authority is implied:
  - `apps/web/lib/backlog/initiative-baseline-repository.test.ts`
  - `apps/web/lib/backlog/initiative-readiness-policy.test.ts`
  - `apps/web/lib/backlog/initiative-readiness/baseline-repository.ts`
  - `apps/web/lib/backlog/initiative-readiness/entry-adapter.test.ts`
  - `apps/web/lib/backlog/initiative-readiness/evaluate.ts`
  - `apps/web/lib/backlog/initiative-readiness/profiles.ts`
  - `apps/web/lib/backlog/initiative-readiness/repository-artifact.test.ts`
  - `apps/web/lib/govern/authority/authority-subject.ts`
  - `apps/web/lib/govern/authority/coworker-authority-decision.test.ts`
  - `apps/web/lib/govern/authority/coworker-authority-decision.ts`
  - `apps/web/lib/govern/authority/coworker-tool-authority-gate.ts`
  - `apps/web/lib/govern/authority/policy-authority-projector.test.ts`
  - `apps/web/lib/govern/authority/policy-authority-projector.ts`
  - `apps/web/lib/govern/authority/resolve-coworker-tool-authority.test.ts`
  - `apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts`
  - `apps/web/lib/govern/authority/resolve-policy-action-authority.test.ts`
  - `apps/web/lib/govern/authority/resolve-policy-action-authority.ts`
  - `apps/web/lib/mcp-governed-execute-authority.cases.ts`
  - `apps/web/lib/mcp-governed-execute.test.ts`
  - `apps/web/lib/mcp-governed-execute.ts`
  - `apps/web/lib/mcp/packs/build-evidence-extra-pack.ts`
  - `apps/web/lib/mcp/packs/coworker-pack.test.ts`
  - `apps/web/lib/mcp/packs/coworker-pack.ts`
  - `apps/web/lib/mcp/packs/initiative-readiness-pack.ts`
  - `apps/web/lib/planning/plan-backlog-coverage.test.ts`
  - `apps/web/lib/planning/plan-backlog-coverage.ts`
  - `apps/web/lib/planning/plan-backlog-dependency-projection.ts`
  - `apps/web/lib/tak/initiative-readiness-tool-grants.ts`
  - `apps/web/lib/work-capsules/claim-backlog-item-handler.test.ts`
  - `apps/web/lib/work-capsules/claim-backlog-item-handler.ts`
  - `apps/web/lib/work-capsules/external-session-capture.test.ts`
  - `apps/web/lib/work-capsules/external-session-capture.ts`
  - `apps/web/lib/work-capsules/governed-work-claim.test.ts`
  - `apps/web/lib/work-capsules/governed-work-claim.ts`
  - `apps/web/lib/work-capsules/work-capsule-store-types.ts`
  - `docs/superpowers/plans/2026-08-23-initiative-readiness-traversal-repair.md`
  - `docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md`

The preview acceptance correction expands the exact envelope from 35 to 37
paths only by adding `claim-backlog-item-handler.ts` and its focused boundary
test. It authorizes no portal source changes. Cross-surface readiness display
and action suppression remain governed by existing `BI-812AC0D8`; therefore
this BI may claim the MCP/external-contributor recovery contract repaired, but
not the portal journey complete.

The earlier envelope for `WC-2ABA65F7` and
`fix/initiative-readiness-bootstrap` was revoked by a non-fast-forward force
update and subsequent Workroom identity pollution. Its audit history remains
immutable, but it authorizes nothing. Recovery proceeds only through
`WC-7FF8A505` and `fix/initiative-readiness-traversal-recovery`; the abandoned
Workroom and compromised branch may not be revived, rewritten, or used as
review evidence. The expanded authority and execution paths above are named
explicitly because the pre-recovery candidate touched them while the prior
path envelope did not. That mismatch is corrected before re-ratification; a
scope claim alone never amends an authorization envelope.

When effective, it authorizes production authorship only. It does not change the failed
initiative-readiness claim, satisfy or fabricate a receipt, grant reviewer
authority, turn a DecisionInteraction into RBAC, mutate the WordPress branch,
or authorize an out-of-envelope file.

The writer audit found three adjacent substrates, none of which can activate
this warrant today:

- `record_workroom_evidence` can preserve an immutable pointer and evidence
  packet, but its contract is evidence, not action authority;
- `createAuthorizationDecisionLog` is a server helper used by specific
  governed actions, not a generic callable authorization writer, and it does
  not validate or consume this policy/artifact bundle;
- `ensureAuthorityApprovalEnvelope` persists a 15-minute exact-tool approval
  proposal linked to an authority decision, then requires the initiating human
  to approve it. There is no registered source-implementation action binding
  for BI-F0715C9C, and this path does not project an autonomy-eligible DI.

Consequently, the repository envelope is an architecture-approved
first-deployment proposal, not yet an active authorization. A Workroom note,
DI id, semantic review, or operator chat message alone cannot activate it. The
exact activation path must either (a) expose an existing governed action writer
that server-resolves and atomically persists the ratification, DI, policy
version, subject/action/artifacts, expiry, revocation, and consumption binding,
or (b) receive an explicit human bootstrap ratification that names the
repository contribution boundary itself as the one-time authority and whose
durable governed pointer is independently verifiable before Red. Until one of
those paths is proven and ratified, the envelope is inactive.

The envelope expires at the earliest of 72 hours after ratification, explicit
revocation, protected merge, branch/base/design/plan drift, an out-of-envelope
path, a non-DCO candidate, review or check failure, a commandment conflict, or
a new `no`, `revise`, `defer`, or `escalate` judgment. Amend/rebase/squash is
allowed only if the result stays within the ratified base/path contract and
receives a fresh exact-tree review. The envelope is consumed by one protected
merge and can never authorize later work.

#### Current implementation stop and ratification text

The earlier operator reply `go` predates this universal bridge and exact
bootstrap envelope, so it is not production implementation authority. Design
and plan evidence may be amended, published, and reviewed. Production source
or test mutation starts only after the operator supplies this text with the
post-amendment immutable values filled in:

> I ratify the one-time first-deployment bootstrap envelope for BI-F0715C9C
> and WC-7FF8A505 in OpenDigitalProductFactory/opendigitalproductfactory on
> fix/initiative-readiness-traversal-recovery. My authority is the current
> Mark-approved WWMD criteria; I accept DI-568FF23AF27B's explicit,
> autonomy-eligible policy-derived-second-check recommendation, corroborated
> by DI-5B6BF3990A83. This
> ratification is bound to base `<base-sha>`, design/plan commit
> `<design-plan-sha>`, design blob `<design-blob>`, plan blob `<plan-blob>`,
> and only the actions and paths in the ratified design. It authorizes
> test-first implementation, verification, DCO publication, independent
> exact-tree semantic and architecture review, protected PR checks, and merge
> queue delivery. It does not satisfy initiative receipts, authorize the
> WordPress branch, grant reviewer authority, treat DecisionInteraction as
> RBAC, or permit out-of-scope work. It expires at the earliest of 72 hours
> from this ratification, my revocation, protected merge, artifact/scope drift,
> review or check failure, commandment conflict, or a no/revise/defer/escalate
> judgment; it is single-use and consumed at merge.

Until that exact ratification is received, its governed persistence path is
proven, and the resulting immutable authorization identity is durably pointed
to from the Workroom, implementation remains stopped. No direct DB write, synthetic
principal, reused human, AI proxy, superuser fallback, fabricated receipt, or
relabelled design mutation is valid.

## Research & Benchmarking

Nine of the ten decisions repair named DPF modules and need no external
comparison. §10 is the exception: projecting a policy judgment into a bounded,
expiring action authority is a general authorization problem with mature prior
art, so it is benchmarked here before DPF commits to a shape (AGENTS.md §7).

The vocabulary is XACML's: a **PAP** authors policy, a **PDP** decides, a **PEP**
enforces, a **PIP** supplies facts. DPF already has all four —
`DecisionPerspectiveProfileVersion` is the PAP, the WWMD/WWWD/WSID gate is the
PDP, the coworker tool authority gate is the PEP, and the evidence bundle is the
PIP. What DPF lacks is the artifact that carries a PDP result to a PEP that runs
later, in a different transaction, under a different actor.

### Open Policy Agent (OPA) / Rego

The reference decoupled PDP. Policy is data-driven and versioned, evaluation is
deny-by-default, and the decision log is a first-class audit artifact.

- **Adopt:** deny-by-default with an explicit registered affirmative outcome —
  DPF's closed action registry is the same idea, and it is why free text,
  confidence alone, or a caller's interpretation can never mean "yes".
- **Adopt:** the decision log as an audit artifact separate from the decision.
- **Reject:** OPA's re-evaluate-per-call model. DPF's owning judgments are
  human-weighted deliberations with evidence bundles and scored options, not
  microsecond rule evaluations; re-running one per action call is neither
  affordable nor auditable. DPF needs the result to be durable and consumable.

### AWS Cedar / Amazon Verified Permissions

Cedar types every request as principal / action / resource / context against a
schema, and returns allow-or-deny plus the determining policies.

- **Adopt:** the typed request quadruple as the exact binding shape. §10's
  fingerprint is deliberately the same: actor, action key, subject, organization,
  route, artifact digest, constraints.
- **Adopt:** returning the determining policy, not just the verdict — the
  projected `AuthorizationDecisionLog` cites the `DecisionInteraction`, profile
  version, and contribution digest for exactly this reason.
- **Reject:** adopting a second policy language. DPF's policy already lives in
  versioned perspective profiles with a human promoter; a Cedar schema would be a
  parallel home for a rule that already has one (AGENTS.md §1).

### Macaroons / Biscuit, and OAuth 2.0 Rich Authorization Requests (RFC 9396)

The capability-token lineage: macaroons (Birgisson et al., 2014) and Biscuit mint
a bearer credential that can be *attenuated* — a holder may add caveats that
narrow scope, never widen it. RFC 9396 gives the structured counterpart, an
`authorization_details` object naming the type, actions, locations, and
identifiers a grant covers, replacing an opaque scope string.

- **Adopt:** the attenuation invariant. §10 states it as "the projection cannot
  widen the original delegation"; this is the same monotone-narrowing rule that
  makes caveated capabilities safe to delegate.
- **Adopt:** RFC 9396's structured authorization detail as the model for the
  `CoworkerActionEnvelope` constraint set — a named action plus explicit
  locations and identifiers, not a coarse scope word.
- **Adopt:** bounded lifetime and bounded use count as intrinsic properties of
  the grant rather than of the caller.
- **Reject:** the bearer-token transport. A macaroon's value is that it travels
  off-box; DPF's envelope is server-side, resolved by the PEP from its own
  tables, and consumed transactionally. There is no token to exfiltrate, and
  server-side consumption is what makes single-use enforceable.

### Google Zanzibar / SpiceDB

Relationship-tuple authorization with `zookie` consistency tokens that pin a
decision to the data version it was computed against.

- **Adopt:** the consistency token. §10's requirement that the immutable artifact
  digest and current policy version be re-derived at consumption is a zookie in
  DPF's terms — it is what makes artifact drift fail closed instead of silently
  authorizing a different tree.
- **Reject:** relationship tuples as the authority store. DPF authority is
  derived from a deliberated judgment about a specific action, not from a
  standing relation between subjects; ReBAC would model the wrong thing.

### What DPF builds

One transactional projector: PDP result in, `AuthorizationDecisionLog` +
`CoworkerActionEnvelope` out, with Cedar's typed binding, RFC 9396's structured
detail, the macaroon narrowing invariant, and a Zanzibar-style consistency pin.
No new policy language, no new table, no bearer credential. The three substrates
it writes to already exist and already carry expiry, delegation provenance, and
execution lifecycle.

## Delivery status

Recorded 2026-08-26 from live state, not from this branch. `main` carries the
implementation; this branch is 50 commits behind it and holds only these two
documents.

### Delivered — PR #4633 (`ddd1ae31e`, 2026-08-24)

**Canonical lineage.** This document exists in two divergent copies, and the one on
`main` is the authoritative ancestor of the delivery:

| Workroom | Branch | Outcome |
|---|---|---|
| `WC-2ABA65F7` | `fix/initiative-readiness-bootstrap` | **Abandoned.** Its own status override records "Non-fast-forward publication breached the one-time envelope and later branch/head adoption polluted canonical identity. Recovery continues in `WC-7FF8A505`." |
| `WC-7FF8A505` | `fix/initiative-readiness-traversal-recovery` | The recovery line. Minted the research, spec-approval, baseline, and plan-coverage identities. |
| `WC-11D831A1` | `…-recovery-dco` | DCO publication carrier, identical tree `7fff292b92`, head `b8756d5751`. |

Publication failed closed first — six ancestral commits lacked DCO trailers — and
`DI-C9486164C49A` chose `new-clean-dco-branch` over rewriting history. The repair
then landed through the protected merge queue. The §10 envelope was never consumed
by a projected warrant; it stands as the reasoning of record for why that path was
lawful, not as an active authorization.

Live confirmation from `BI-F0715C9C` readiness at 2026-08-26:

- `policyVersion: initiative-readiness.v2` — §2 is live.
- `profile: "fix"` for this `workType=bug`, `scopeKind=platform` item — §1 is live,
  and `AC-PROFILE-FIX` holds against the very item that motivated it. The same BI
  derived `cross-domain` under `v1` on 2026-08-24T03:06.
- `policy-authority-projector.ts`, `resolve-policy-action-authority.ts`, and
  `authority-subject.ts` are on `main` — §5 and §10 are live.

Follow-on PRs #4603, #4605, and #4641 extended the same surface.

### Not delivered — the completion lane

Acceptance 20 and 21 were added to `BI-F0715C9C` on 2026-08-25, **after** this
design was written, and no decision here addresses them. Every reproduction in
§Problem is blocked *before* implementation. The newer failure mode is its mirror:
work that ships correctly and still cannot reach `done`.

`BI-1819D34F` merged as `63c858add9` (PR #4661) with 34 green checks and its CodeQL
alert closed, and remains open on `RESEARCH_REQUIRED`, `PLAN_REQUIRED`,
`DELIVERY_EVIDENCE_REQUIRED`, `ACCEPTANCE_EVIDENCE_REQUIRED`,
`OBJECTIVE_BASELINE_REQUIRED`, and `OBJECTIVE_RECONCILIATION_REQUIRED`.
`BI-A8BFEFCE` (`aa456254b6`) and `BI-DBEEC15B` (`0ad91e688c`) reproduce it
independently.

This is a real gap in the policy this document defines. §2 makes obligations
materially different by profile but still assumes every profile *enters through
design*. A `fix` filed from an automated detection and repaired directly has no
honest forward-looking scope artifact to point at, and `retire` is the only
disposition left. Closing it needs a decision this design does not contain: either
a terminal state meaning "shipped and verified", or a plain statement that such
items are ineligible for `done`. That belongs in a successor design, not an
amendment here.

One narrower signal is already visible and worth a look while that is open:
`DELIVERY_EVIDENCE_REQUIRED` returns `state: "fail"` rather than `"missing"` while
its `evidenceRefs` correctly list the supplied activities — a writer and a reader
disagreeing about an evidence contract, in two independent occurrences.

### Caused by the delivery — BI-CC9D5997

The recovery-disclosure mechanism specified in §3 shipped in a form that silently
replaced the plan-coverage handler. See §3's hazard note. This is this design's own
blast radius, not an unrelated regression, and it is why the companion plan cannot
mint its own coverage receipt. Claimed on `WC-C3B828AE`, branch
`fix/plan-coverage-tool-registry`.

## Trust boundaries

| Boundary | Fail-closed rule |
|---|---|
| Metadata -> profile | Ownership is neutral; approved stronger profiles and explicit cross-domain/archetype signals stay monotonic. |
| Decision -> recovery | Recovery is advice/routing only; it cannot mutate receipt state. |
| Developer -> reviewer | The caller cannot load or borrow reviewer tools; an eligible agent executes with its own grant. |
| PAT -> TaskRun | User, token capability, clearance, lifecycle, idempotency, and risk class use the existing task checks. |
| Receipt call -> authority log | The server derives the backlog subject and organization; caller-supplied organization claims are ignored. |
| Policy judgment -> action authority | Only a current, explicit, autonomy-eligible owning-policy “yes” with human-rooted version/delegation provenance can project a scoped, expiring authorization; the runtime never treats DecisionInteraction itself as RBAC. |
| First deployment -> repository boundary | Only the exact operator-ratified, DCO-signed, path-confined candidate with fresh independent exact-tree review and protected checks/merge may bootstrap the projector; runtime claim denial remains visible and the envelope is consumed at merge. |
| Proposed design -> receipts | Latest valid design-spec digest anchors pre-baseline reviews; superseded artifact digests are stale. |
| Evidence -> Workroom | Only a full provider branch-head match reaches adoption. |
| Workroom -> author | Exact subject/repo/head, provider blob, one DCO identity, and accountable owner remain required. |
| Provider preflight -> coverage commit | Immutable bytes/digest may be reused; mutable Workroom, author ownership, baseline, and mapped items are locked and revalidated before append. |

## Acceptance and traceability

| ID | Objectives | Requirement | Verification |
|---|---|---|---|
| AC-PROFILE-FIX | OBJ-IRT-001 | A small platform bug without stronger signals derives `fix`. | Profile unit test and BI-A45D744A-shaped fixture. |
| AC-PROFILE-MONOTONIC | OBJ-IRT-001 | Recorded cross-domain/archetype evidence still wins. | Profile regression tests. |
| AC-POLICY-DIFFERENT | OBJ-IRT-001 | Fix, feature, and cross-domain have materially different sets. | Table-driven pure-policy tests. |
| AC-RECOVERY-ROUTE | OBJ-IRT-002 | Missing grants identify exact eligible agents; the governed claim and MCP result preserve the complete deterministic no-thread request packet without changing the verdict or dispatching. | Recovery resolver, claim, and `claim-backlog-item-handler` boundary tests. |
| AC-UI-TARGET | OBJ-IRT-002 | Following a recovery action preserves the exact eligible agent identity or fails visibly; it never opens a default coworker. | Recovery-action/launcher component test. |
| AC-REVIEW-SEPARATION | OBJ-IRT-003 | External fallback executes as target reviewer and never grants caller authority. | Coworker/task and receipt separation tests. |
| AC-REVIEWER-READ | OBJ-IRT-003 | An immediate `sideEffect=false` immutable review read does not require a per-call HITL envelope solely because the coworker's coarse approval policy is `all`; proposal execution and all side effects remain approval-gated. | Coworker authority-decision regression test. |
| AC-SPEC-AUTHORITY | OBJ-IRT-003, OBJ-IRT-004 | A correctly granted independent reviewer gets an allow decision for the exact governed item: tenant items require the matching authenticated organization, while organizationless platform items use server-derived authority scope `platform`; missing/mismatched subjects fail closed. | Authority-gate and exact spec-approval traversal tests. |
| AC-RECEIPT-FRESHNESS | OBJ-IRT-003, OBJ-IRT-004 | Superseded specialist receipts never satisfy a newer proposed or approved design, including before the first baseline. | Entry-adapter tests shaped from the e89f362 -> ad873ed reproduction. |
| AC-HEAD-RECONCILE | OBJ-IRT-005 | Provider-verified evidence updates the existing subject Workroom through adoption. | Provider, evidence handler, and capture tests. |
| AC-AUTHOR-AFTER-SYNC | OBJ-IRT-005 | Artifact author resolves after synchronization. | Repository-artifact integration fixture. |
| AC-FAIL-CLOSED | OBJ-IRT-004, OBJ-IRT-005 | Unverified, mismatched, ambiguous, foreign, unsigned, or DCO-conflicting artifacts do not resolve. | Negative tests. |
| AC-REPLAY | OBJ-IRT-002, OBJ-IRT-005 | Replaying evidence reconciles null/stale heads idempotently, and blocked Workrooms receive an exact reviewer route. | WC-E8275570- and WC-B0DD2B2F-shaped regression tests. |
| AC-COVERAGE-TX | OBJ-IRT-005 | A slow provider preflight does not consume the interactive transaction window; five valid mappings commit, while changed bindings or transaction expiry write no receipt and return an exact retry action. | WC-A31DBE53-shaped timing, race, and failure tests. |
| AC-POLICY-BRIDGE-YES | OBJ-IRT-004 | A current explicit WWMD/WWWD/WSID affirmative result with eligible signal and human-rooted standing provenance projects one scoped, expiring authorization that cites the complete decision evidence. | Pure projector plus authorization-log/envelope integration tests for all three gates. |
| AC-POLICY-BRIDGE-DENY | OBJ-IRT-004 | No, revise, defer, escalate, ambiguous, unusable, advisory-only, conflicted, or missing judgments never authorize and return the owning gate's exact route. | Table-driven negative and recovery tests. |
| AC-POLICY-BRIDGE-SCOPE | OBJ-IRT-004 | Subject, organization, action, actor, route, policy version, delegation, artifact, expiry, and use limits are revalidated; cross-scope, stale, revoked, expired, or replayed authority fails closed. | Binding mutation, expiry, revocation, reuse, and cross-WWMD/WWWD/WSID tests. |
| AC-POLICY-NOT-RBAC | OBJ-IRT-004 | A DecisionInteraction id alone never grants access, and projection never creates a role/grant or marks an initiative receipt satisfied. | Prohibition tests at the policy and governed-execution gates. |
| AC-POLICY-RECOVERY | OBJ-IRT-002, OBJ-IRT-004 | A developer receives the exact owning evaluation/escalation or eligible independent-reviewer route rather than an impossible receipt checklist. | Claim-response and recovery-action tests. |
| AC-FIRST-DEPLOY-WARRANT | OBJ-IRT-006 | The one-time envelope is ineffective without the exact human root, DI, BI/Workroom, repository/branch, base, design/plan artifacts, action/path scope, expiry, and a governed authorization identity; an evidence note alone is insufficient. | Bootstrap contract/pregate fixture plus immutable authority and Workroom-pointer inspection. |
| AC-FIRST-DEPLOY-INDEPENDENCE | OBJ-IRT-006 | The candidate needs fresh independent exact-tree semantic and architecture review and every protected check; repository automation is never reported as a human approval. | Review-receipt identity, branch-rule snapshot, exact-tree CI, and PR-health evidence. |
| AC-FIRST-DEPLOY-CONSUME | OBJ-IRT-006 | Drift, failure, revocation, timeout, non-affirmative judgment, or merge invalidates the envelope; one merge consumes it and no later work can reuse it. | Bootstrap contract negative/replay fixtures and protected-merge audit. |

## Related

- Binding design:
  [`2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md`](2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md)
  — this document changes its policy version and adds §10; it does not replace it.
- Implementation plan:
  [`../plans/2026-08-23-initiative-readiness-traversal-repair.md`](../plans/2026-08-23-initiative-readiness-traversal-repair.md).
- Superseded within this branch: the transport-session readiness design and plan
  (§4). They were removed rather than marked `superseded` because they never
  reached `main`; commits `c1f6b9af5..3a9a5a732` carry them for audit.
- Superseded recommendation: `DI-F7361DD540E2` (BI-specific two-human binding),
  by `DI-053D69EADEDC` (§10).
- Decision-scope doctrine: `docs/founder-kernel/wiki/principles/decisions-belong-to-their-scope.md`
  — the reason §10 resolves the owning gate server-side and forbids WWWD/WSID
  inheriting WWMD authority.

## Open questions

Two cells of the §2 matrix describe obligations that the shipped `evaluate.ts`
does not implement. **Neither is decided here**, and the table is deliberately
left as written rather than silently corrected to match the code — it is not
settled which side is wrong. The accountable reviewer owns the resolution. Until
then, **no test should be written that locks in either reading**: a test here
freezes whichever side happens to be in the tree.

Both predate this repair, so both are outside its blast radius.

### OQ-1 — Does `doc-only` carry a capsule-identity obligation at implementation?

- **The §2 table says yes:** the `doc-only` row reads "capsule identity;
  delivery/acceptance at completion".
- **`evaluate.ts` says no:** `implementationRequirements` guards `PLAN_REQUIRED`,
  `DEPENDENCY_UNRESOLVED`, and `CAPSULE_IDENTITY_MISMATCH` behind
  `if (facts.profile !== "doc-only")`, so a documentation change acquires none of
  the three.
- **Why it matters:** capsule identity is what binds work to a Workroom. If
  `doc-only` genuinely needs it, the current guard is a real hole — documentation
  changes would reach implementation with no capsule binding. If it does not, the
  prose was aspirational and should stay dropped.
- **Not inferable from the repair:** this behavior predates BI-F0715C9C. It is not
  something §1 or §2 changed, so it is out of this repair's blast radius either way.

### OQ-2 — Should the `feature` row restate `PLAN_REQUIRED`?

- **The §2 table omits it:** the `feature` implementation cell lists "plan review,
  coverage, traceability, dependency disposition, capsule identity" — repeating two
  `fix` obligations while dropping a third.
- **`evaluate.ts` includes it:** `feature` inherits all three `fix` implementation
  obligations, `PLAN_REQUIRED` among them.
- **Most likely a table slip, not a policy difference** — the omission is
  inconsistent with the same cell repeating the other two. Recorded rather than
  silently corrected, because "the columns are cumulative" and "each cell is a full
  restatement" are both defensible readings of the table and they disagree here.

If OQ-1 resolves toward "yes", the guard in `implementationRequirements` is a real
hole — a documentation change would reach implementation with no capsule binding —
and it needs its own backlog item rather than an amendment here.

## Non-goals

- No fabricated/proxy receipts for BI-A45D744A.
- No mutation of the WordPress repair branch.
- No new receipt type, reviewer role, grant, session table, or workflow engine.
- No reusable readiness bypass, direct DecisionInteraction-as-RBAC, or generic
  break-glass authority.
- No automatic dispatch merely because readiness was read.
- No weakening of cross-domain, archetype, immutable artifact, DCO, semantic
  review, pregate, exact-tree CI, or PR health gates.
