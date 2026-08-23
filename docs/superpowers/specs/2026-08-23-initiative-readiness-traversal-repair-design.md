---
status: active
---

# Initiative readiness traversal and external evidence reconciliation

**Backlog item:** BI-F0715C9C
**Workroom:** WC-2ABA65F7
**Status:** active — architecture and the one-time repository contribution envelope are ratified
**Binding design:** `docs/superpowers/specs/2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md`
**Policy change:** `initiative-readiness.v1` -> `initiative-readiness.v2`
**Kernel consults:** `DI-053D69EADEDC` (policy-authority bridge) · `DI-568FF23AF27B` (bootstrap authorizer) · `DI-5B6BF3990A83` (corroborating) · `DI-AA4E4F26593C` (inconclusive, §4) · `DI-ECE6A1FCFFCA` (abstained) · `DI-F7361DD540E2` (superseded)
**Budget:** ~80% refactor/integration of existing substrate, ~20% new surface — the inverted allocation
(`docs/design/golden-triangle-design.md:654` still states the retired 80/20 feature-first split). Every decision
below extends a named existing module; §10's projector is the only new component, and it composes three
existing tables.

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
| Receipt freshness | With no approved baseline, `entry-adapter.ts` passes `canonicalDigest=null`, so specialist receipts bound to superseded commit `e89f362` still project as satisfied against the current `ad873ed` design | Pre-baseline review evidence has no canonical proposed-design digest anchor. |
| Workroom synchronization | `adoptWorktreeCapsule` already updates `baseSha`, `headSha`, and `lastSyncedAt` | External evidence never verifies a provider branch head or passes a SHA to adoption. |
| Artifact author | `resolveRepositoryArtifact` requires one subject Workroom whose head equals the immutable commit | `ARTIFACT_AUTHOR_REQUIRED` is downstream of the missing head sync. |
| Plan coverage persistence | WC-A31DBE53 now resolves plan blob `8f933b3c9312f0a3b2f01794f421ac4b9cace01e` and validates five mappings, but commit attempts expire at 5,532 ms and 8,431 ms against Prisma's 5,000 ms interactive-transaction limit | `recordPlanBacklogCoverage` performs provider commit, DCO, blob, alias, and Workroom resolution while holding a serializable parent-row lock. |
| Policy-to-authority bridge | `DecisionInteraction` seals the owning WWMD/WWWD/WSID judgment, profile version, evidence, scores, and outcome. `AuthorizationDecisionLog`, `DelegationGrant`, and `CoworkerActionEnvelope` already carry human-rooted, scoped, expiring action authority. Workroom evidence `cmt5wqbft0j8c01rm8l54p0g5` records `DI-053D69EADEDC`: `policy-authority-bridge`, high confidence, composite `15.883`, margin `5.984`, `autonomyEligible=true`, and no commandment conflict. | The judgment and action-authority substrates are not connected by one canonical projector. A raw DecisionInteraction reference is currently treated as presence evidence, not as a verified bounded authority decision, so a valid policy “yes” cannot authorize the exact action and a normal identity receives no lawful next step. |

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

Profile derivation stays monotonic: `deriveAuthoritativeReadinessProfile`
collects every signal and returns the strongest, so a change can only ever be
raised by adding evidence, never lowered by omitting it.

1. A recorded approved baseline/profile is one of the collected signals, so it
   can raise the profile but never lowers a stronger current signal.
2. Explicit cross-domain/platform-wide, archetype, or active build-kind signals
   still raise the profile.
3. Archetype scope/categories remain conservative.
4. A bug with no stronger signal derives `fix`, including platform-owned code.

Only the ownership-to-risk mapping changes: `scopeKind` values `platform` and
`common` stop contributing a `cross-domain` candidate. `scopeKind=cross-domain`,
`workType=platform-wide`, and every archetype scope keep their current strength.

### 2. Encode a material, monotonic policy matrix

Version 2 implements the approved profile meanings.

Each column is strictly additive over the row above it: a profile carries every obligation of the
weaker profiles plus the ones named in its own cell. `evaluate.ts` deduplicates by
`code:accountableRole`, so a repeated obligation is stated once.

| Profile | Plan-entry obligations | Implementation adds |
|---|---|---|
| `doc-only` | classification, authorization | *(none — but see OQ-1)* |
| `fix` | adds reproduction/causal research | adds canonical plan evidence, dependency disposition (N/A allowed), capsule identity |
| `feature` | adds canonical design, spec approval, architecture review, objective baseline, artifact author | adds plan review, plan coverage, traceability |
| `cross-domain` | adds data, UX-fit, security, compliance, and domain review/disposition | *(none beyond feature)* |
| `archetype` | *(none beyond cross-domain)* | adds archetype provisioning and completeness |

Completion is a fourth target and is uniform across profiles: it adds delivery evidence, acceptance
evidence, objective baseline, and objective reconciliation on top of the implementation set.

**This table was reshaped to be strictly additive, and two cells changed meaning in the process. Both
are open questions (§OQ), not ratified decisions** — the earlier prose described obligations that
`evaluate.ts` does not implement, and it is not settled which side is wrong.

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
sessions and `Mcp-Session-Id`
⟦runtime: upstream spec state read 2026-08-23 — re-verify against the published
MCP changelog before citing it as settled; the decision below does not depend on
it⟧. Existing auth-bound tasks are already implemented and follow the stateless
direction, so reusing them is the smallest architecture-consistent repair even if
protocol sessions survive upstream.

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

### 6. Anchor pre-baseline receipts to the proposed design

The approved baseline digest remains authoritative after spec approval. Before
a baseline exists, derive one proposed-design digest from the latest valid
`design-spec` receipt for the subject. Project all other artifact-bound receipts
against that digest; a different digest is `stale`, not satisfied. A malformed
or absent `design-spec` receipt provides no permissive fallback: dependent
review lanes remain missing or stale.

The `design-spec` receipt that supplies the digest is itself projected with no
anchor (`canonicalDigest=null`); every other gate is projected against the digest
it yields. Without that exemption the anchor would be circular. Only the latest
`design-spec` receipt is consulted, matching `latestGateStates`, which already
keeps one receipt per gate.

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
evidence call with the same BI, repository, branch, worktree, session, and a
commit list containing exactly the published branch-head SHA. Adoption updates
the existing Workroom and records the old and new heads. The artifact resolver
then performs provider blob and DCO checks.
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
non-affirmative result never receives autonomous authority. It never falls back
to a generic platform subject or superuser authority. A messy-maybe result may
enter the existing exact-call human approval path as human resolution, but that
approval is not represented as a policy-derived authorization. An explicit
decline/conflict or an unmet dual-control floor cannot use that fallback.

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
  packet for the current subject/action/artifact or a bounded exact-call human
  resolution envelope;
- dual-control floor: require a fresh distinct-human approval with the exact
  approval-binding fingerprint; never substitute the initiating-human envelope;
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

- BI `BI-F0715C9C`, Workroom `WC-2ABA65F7`, repository
  `OpenDigitalProductFactory/opendigitalproductfactory`, and branch
  `fix/initiative-readiness-bootstrap`;
- the exact design and plan commit/blobs named by the post-amendment
  ratification, plus the ratified base commit;
- test-first authorship, refactoring inside the same contracts, documentation,
  verification, DCO publication, independent review, protected PR, and merge
  queue actions only;
- these path envelopes and their colocated tests:
  `apps/web/lib/backlog/initiative-readiness/**`,
  `apps/web/lib/work-capsules/{governed-work-claim,work-capsule-store,external-session-capture,mcp-handlers}*`,
  `apps/web/lib/mcp/packs/{initiative-readiness-pack,work-capsules-pack,build-evidence-extra-pack,decomposition-pack,workforce-pack}*`,
  `apps/web/lib/{mcp-task-submit,planning/plan-backlog-coverage}*`,
  `apps/web/lib/govern/authority/{coworker-tool-authority-gate,resolve-coworker-tool-authority}*`,
  the two BI-F0715C9C design/plan documents, and the generated docs index.

When effective, it authorizes production authorship only. It does not change the failed
initiative-readiness claim, satisfy or fabricate a receipt, grant reviewer
authority, turn a DecisionInteraction into RBAC, mutate the WordPress branch,
or authorize an out-of-envelope file.

The writer audit found three adjacent substrates, none of which should be
misrepresented as runtime activation of the new projector:

- `record_workroom_evidence` can preserve an immutable pointer and evidence
  packet, but its contract is evidence, not action authority;
- `createAuthorizationDecisionLog` is a server helper used by specific
  governed actions, not a generic callable authorization writer, and it does
  not validate or consume this policy/artifact bundle;
- `ensureAuthorityApprovalEnvelope` persists a 15-minute exact-tool approval
  proposal linked to an authority decision, then requires the initiating human
  to approve it. There is no registered source-implementation action binding
  for BI-F0715C9C, and this path does not project an autonomy-eligible DI.

The operator selected the second, non-circular first-deployment path. Workroom
activity `cmt5xoo250jj401rm57xnzi6f`, recorded at
`2026-08-23T15:00:06.989Z`, preserves the explicit human ratification of the
repository contribution boundary, the three-DI lineage, the exact ratified
design tree/commit/blobs, semantic-review receipt, three-band semantics, and
prohibitions. A second evidence entry, `cmt5xqem60jjv01rms0eubr7l`, preserves
the operator's systemic trusted-autonomy directive and `DI-6A25809B4683`.

That ratification activates source authorship under this one-time repository
envelope only. It deliberately does not create an `AuthorizationDecisionLog`,
approve a runtime initiative action, or claim the projector is deployed. The
first deployment is instead governed by the independently verifiable
contribution chain: explicit human directive, immutable design identity,
DCO-signed exact diff, fresh independent exact-tree review, protected checks,
and merge queue. After merge, the runtime projector becomes the canonical
writer for later action-specific authorizations.

The envelope expires at the earliest of `2026-08-26T15:00:06.989Z`, explicit
revocation, protected merge, unexplained branch/design/plan drift, an out-of-envelope
path, a non-DCO candidate, review or check failure, a commandment conflict, or
a new `no`, `revise`, `defer`, or `escalate` judgment. Amend/rebase/squash is
allowed only onto a newer `main` when the resulting patch stays within the
ratified path contract and receives a fresh exact-tree review. The envelope is
consumed by one protected merge and can never authorize later work.

#### Active first-deployment boundary

The exact ratified design identity is commit
`a537d7a1ebb19b40f9ccc1426d9fb62fc0312b89`, tree
`7033afb666113bb5e3dc33122a21552028c37fb0`, design blob
`dedf8f19a94e5bcb126f2e5774e60237974ff4da`, plan blob
`de1703b6cae2f6ec1b555c20e66346b5311a6ebd`, and semantic-review receipt
`cmt5xkrai0jhk01rm4apogtih`. The repository was subsequently refreshed onto a
newer `main`; that does not widen the authorized patch. Every edited path is
claimed exactly on `WC-2ABA65F7`, and the final rebased tree still requires a
fresh independent semantic and architecture review.

No direct DB write, synthetic principal, reused human, AI proxy, superuser
fallback, fabricated receipt, or relabelled design mutation is valid. The
normal initiative implementation denial remains visible until the deployed
repair lawfully changes its prerequisites.

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

| ID | Requirement | Verification |
|---|---|---|
| `AC-PROFILE-FIX` | A small platform bug without stronger signals derives `fix`. | Profile unit test and BI-A45D744A-shaped fixture. |
| `AC-PROFILE-MONOTONIC` | Recorded cross-domain/archetype evidence still wins. | Profile regression tests. |
| `AC-POLICY-DIFFERENT` | Fix, feature, and cross-domain have materially different sets. | Table-driven pure-policy tests. |
| `AC-RECOVERY-ROUTE` | Missing grants identify exact eligible agents and request packet. | Recovery resolver and claim tests. |
| `AC-UI-TARGET` | Following a recovery action preserves the exact eligible agent identity or fails visibly; it never opens a default coworker. | Recovery-action/launcher component test. |
| `AC-REVIEW-SEPARATION` | External fallback executes as target reviewer and never grants caller authority. | Coworker/task and receipt separation tests. |
| `AC-SPEC-AUTHORITY` | A correctly granted independent reviewer gets an organization-bound allow decision for the governed item; missing/mismatched subjects fail closed. | Authority-gate and exact spec-approval traversal tests. |
| `AC-RECEIPT-FRESHNESS` | Superseded specialist receipts never satisfy a newer proposed or approved design, including before the first baseline. | Entry-adapter tests shaped from the e89f362 -> ad873ed reproduction. |
| `AC-HEAD-RECONCILE` | Provider-verified evidence updates the existing subject Workroom through adoption. | Provider, evidence handler, and capture tests. |
| `AC-AUTHOR-AFTER-SYNC` | Artifact author resolves after synchronization. | Repository-artifact integration fixture. |
| `AC-FAIL-CLOSED` | Unverified, mismatched, ambiguous, foreign, unsigned, or DCO-conflicting artifacts do not resolve. | Negative tests. |
| `AC-REPLAY` | Replaying evidence reconciles null/stale heads idempotently, and blocked Workrooms receive an exact reviewer route. | WC-E8275570- and WC-B0DD2B2F-shaped regression tests. |
| `AC-COVERAGE-TX` | A slow provider preflight does not consume the interactive transaction window; five valid mappings commit, while changed bindings or transaction expiry write no receipt and return an exact retry action. | WC-A31DBE53-shaped timing, race, and failure tests. |
| `AC-POLICY-BRIDGE-YES` | A current explicit WWMD/WWWD/WSID affirmative result with eligible signal and human-rooted standing provenance projects one scoped, expiring authorization that cites the complete decision evidence. | Pure projector plus authorization-log/envelope integration tests for all three gates. |
| `AC-POLICY-BRIDGE-DENY` | No, revise, defer, escalate, ambiguous, unusable, advisory-only, conflicted, or missing judgments never authorize and return the owning gate's exact route. | Table-driven negative and recovery tests. |
| `AC-POLICY-BRIDGE-SCOPE` | Subject, organization, action, actor, route, policy version, delegation, artifact, expiry, and use limits are revalidated; cross-scope, stale, revoked, expired, or replayed authority fails closed. | Binding mutation, expiry, revocation, reuse, and cross-WWMD/WWWD/WSID tests. |
| `AC-POLICY-NOT-RBAC` | A DecisionInteraction id alone never grants access, and projection never creates a role/grant or marks an initiative receipt satisfied. | Prohibition tests at the policy and governed-execution gates. |
| `AC-POLICY-RECOVERY` | A developer receives the exact owning evaluation/escalation or eligible independent-reviewer route rather than an impossible receipt checklist. | Claim-response and recovery-action tests. |
| `AC-FIRST-DEPLOY-WARRANT` | The one-time envelope is ineffective without the exact human root, DI, BI/Workroom, repository/branch, base, design/plan artifacts, action/path scope, expiry, and a governed authorization identity; an evidence note alone is insufficient. | Bootstrap contract/pregate fixture plus immutable authority and Workroom-pointer inspection. |
| `AC-FIRST-DEPLOY-INDEPENDENCE` | The candidate needs fresh independent exact-tree semantic and architecture review and every protected check; repository automation is never reported as a human approval. | Review-receipt identity, branch-rule snapshot, exact-tree CI, and PR-health evidence. |
| `AC-FIRST-DEPLOY-CONSUME` | Drift, failure, revocation, timeout, non-affirmative judgment, or merge invalidates the envelope; one merge consumes it and no later work can reuse it. | Bootstrap contract negative/replay fixtures and protected-merge audit. |


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

These are unresolved discrepancies between the design prose and `evaluate.ts`,
surfaced while reshaping the §2 matrix. **Neither is decided here.** The
implementing thread and the accountable reviewer own the resolution; until then
the table above reflects current code behavior with these markers, and no test
should be written to lock in either reading.

### OQ-1 — Does `doc-only` carry a capsule-identity obligation at implementation?

- **Earlier design prose said yes:** the `doc-only` row read "capsule identity;
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

- **Earlier design prose omitted it:** the `feature` implementation cell listed
  "plan review, coverage, traceability, dependency disposition, capsule identity"
  — repeating two `fix` obligations while dropping a third.
- **`evaluate.ts` includes it:** `feature` inherits all three `fix` implementation
  obligations, `PLAN_REQUIRED` among them.
- **Most likely a prose slip, not a policy difference** — the omission is
  inconsistent with the same cell repeating the other two. Recorded rather than
  silently corrected because the additive rewrite changes what a reader infers.

If OQ-1 resolves toward "yes", it is a separate defect with its own backlog item;
folding it into this branch would widen a repair that already spans nine slices.

## Non-goals

- No fabricated/proxy receipts for BI-A45D744A.
- No mutation of the WordPress repair branch.
- No new receipt type, reviewer role, grant, session table, or workflow engine.
- No reusable readiness bypass, direct DecisionInteraction-as-RBAC, or generic
  break-glass authority.
- No automatic dispatch merely because readiness was read.
- No weakening of cross-domain, archetype, immutable artifact, DCO, semantic
  review, pregate, exact-tree CI, or PR health gates.
