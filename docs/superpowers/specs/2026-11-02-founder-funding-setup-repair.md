---
status: draft
---

# Restore explicit platform funding ownership setup

**Backlog item:** BI-B14253CD. **Workroom:** WC-7ECC15DA.
**Branch:** `codex/founder-funding-setup`.
**Delivery shape:** large, because this repairs an authority-bearing setup path.
**State:** scoped design; implementation, native reviews and runtime acceptance pending.

## Problem and evidence

The delivered [owner-scoped investment design](2026-09-27-owner-scoped-investment-balance-design.md), BI-0ACB97B5, requires owner-confirmed setup and preserves owner choices (AC-BAL-1, AC-BAL-2 and AC-BAL-6). Its ecosystem mirror BI-F59FD918 is not a separate repair owner.

On 2026-11-02, supported read-only `admin_query_db` returned the active `mark-dpf-platform` profile with `ownerPrincipalId=null` and `ownerOrganizationId=null`. Its current `mark-dpf-platform-v1` version also has `promotedByPrincipalId=null`. `get_workroom` on WC-B2EF4840 reports `funding-organization-unresolved`. The only visible owner-organization scope returns organization ownership, the default 20/80, no policy revision and no installation binding. These are actual recorded facts; another installation's state is not inferred.

Named source baseline: `origin/main` 36b46866870694dab1763e691862da38dc577e76. `portfolio/investment-balance-server.ts` loads founder ownership only from the active platform profile, and cannot find an organization for unbound platform work without that profile's organization. `portfolio/investment-balance-policy.ts` correctly refuses to infer founder ownership. The platform seed never supplies either owner field. The profile writer inventory and supported tool catalog expose no ownership setup writer. Policy ratification writes a version's promoter, a different fact.

The operator explicitly selected his existing founder-funded shared-platform allocation, authorized "Repair founder funding setup, then resume", and confirmed the exact person and organization. The concrete identifiers and trusted answer are recorded in WC-7ECC15DA evidence rather than the shared source artifact. This authorizes delivering the repair and preparing its concrete confirmation; it does not bypass the writer's human decision control.

Expected: a supported, audited initial ownership confirmation lets that person record the platform policy/funding owner and then use the existing allocation binding. Actual: the platform has a correct refusal and no supported setup action.

## Decision and authority

WWMD DI-9DB16C1CC376 recommends an explicit initial confirmation over automatic derivation or an indefinitely unresolved setup. Its outcome is recorded as the agent following that recommendation. It supplies architectural direction, not the human ownership attestation.

This is a **new recorded ownership act**, not discovery of founder status from an administrator bit, display name, installation, organization role or policy ratifier. Existing `manage_platform` capability constrains who may use setup; organization accountability constrains which organization the person can select. Neither independently proves founder ownership.

The concrete confirmation identifies the local installation, profile, authenticated person's principal, chosen organization and expected current-state digest. It establishes local recorded ownership only; it is not a global identity attestation or authority on a peer. It says that this records the **platform policy owner as well as the funding owner**. The policy projector consumes the owner identity, so this consequence is material. This repair does not ratify the current or any later policy version; the current unratified version remains unratified. The preview reads and shows any existing explicit allocation, its value and validity; the default 80/20 applies only when no override exists. Allocation revisions and historical spending are unchanged. Applying funding to a Workroom is a subsequent existing governed action.

## One supported read and confirmation path

1. A bounded read service beside `investment-balance-server.ts` resolves the authenticated active nonautomation human, the active platform profile and that person's explicitly owned organizations. Return only authorized choices, current ownership state, an installation-bound digest, the effective prospective allocation and plain consequence. Page organizations; never silently truncate. The existing allocation page uses this read model.
2. `read_platform_funding_setup` is an immediate read requiring `manage_platform` and existing `admin_read`. It returns `available`, `already-recorded`, `partial-or-conflicting`, or an honest unavailable state, not invented owners.
3. `confirm_platform_funding_owner` is a proposal, side effect and authority action, requiring `manage_platform` and existing `admin_write`. Both MCP and portal enter the same governed handler. Inputs are the chosen organization, expected state digest, explicit attestation and reason; the owner principal is always resolved from the authenticated user and is never accepted from an arbitrary caller field.
4. For an agent-origin call, `humanApprovalForExecution` verifies the server-supplied reserved envelope ID, tool name, exact parameters, current capability and persisted human marker. Require approver equals that user and `onBehalfOf=null`. Policy-generated approved envelopes are insufficient. A proposal uses the existing CoworkerActionEnvelope/Owner Inbox; no new approval store is added.
5. Direct portal confirmation requires trusted governed REST provenance and the current active nonautomation human with capability. Missing agent identity on an MCP/PAT call cannot masquerade as portal confirmation. No agent may manufacture the human marker or click through a human-only decision as if it were the person.
6. Inside one serializable transaction, re-read actor/principal/account, organization accountability, installation identity, profile kind/status/owner fields/version and expected digest. The digest also binds the prospective allocation's current revision and validity so changed confirmation consequences require a fresh read. Both owner fields must still be null. Existing, partial or conflicting ownership refuses. Compare-and-set on the observed profile revision prevents racing confirmations; errors roll back the audit as well as the profile write.
7. Store ownership only in the existing profile fields. Append an immutable, installation-bound audit record through existing PlatformConfig revision conventions, identifying actor, organization, before/after state, digest, reason and approval reference. This is provenance, not a second owner source. Do not store a new allocation revision, ratify a policy, backfill telemetry or send anything to a peer.
8. An exact repeated confirmation may return the matching completed audit result without another mutation only after current actor, organization, profile status and ownership still match its after-state; historical audit alone cannot hide a later ownership change. Changed or unproven repetition refuses. The read and expected digest are installation-bound, and a copied audit cannot authorize another installation. A later ownership transfer is outside this initial setup path.

## UX and surface fit

The [interactive prototype](../../prototypes/2026-11-02-founder-funding-setup.html) was authored before this plan. Canonical home remains Delivery Flow → Portfolio budgets → Investment balance (`/ops/demand?investment=1`), reusing InvestmentBalance and report-kit primitives. No route or navigation layer is added.

The founder/operator sees "Confirm platform ownership", their name, an eligible organization, the effective prospective allocation and a reason. Existing explicit allocations keep their saved target and validity; only an unconfigured scope shows the founder default. Exact identifiers and state digest are disclosed on demand. Explicit attestation and one confirmation finish setup. Already recorded ownership is informational; partial/conflicting state offers a truthful repair explanation and no overwrite action. Loading, refusal and concurrency states keep the original choice and permit a fresh read. The page never sends a coworker prompt when opening details.

The shared authorized-surface projection exposes the same read state and persistent action. Rendered UI, MCP and headless consumers share one model. Human review of the actual owner confirmation remains required; the prototype's simulated confirmation changes no production record.

## Standards and design grounding

The OWASP [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) supports denying by default and validating authorization on each request. The [Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html) supports binding confirmation to the transaction details and protecting against changed data and replay. Reuse DPF's existing exact-input envelope and state-comparison mechanisms; introduce no external identity provider or authorization protocol.

Existing specs/plans: owner-scoped investment design and October 13 plan; WWMD authority-ratification repair; exact-workroom peer communication design; architecture orientation, data-model stewardship, governed surface and theme runbooks.

Existing code: profile schema and seed; `investment-balance-{server,policy,binding}.ts`; `portfolio-budget-pack.ts`; `actions/portfolio-budget.ts`; InvestmentBalance and ops/demand page; `human-approved-execution.ts`; envelope-actions, escalation-gate and policy-authority-projector; existing workroom sensitivity read/digest/correction pattern; tool grants and authorized-surface registry. Profile ownership remains normalized in its existing foreign keys. Queries touch one profile and a bounded organization page; no estate scan or fleet fan-out occurs.

## Objectives and acceptance

**OBJ-FF-1:** Explicit authorized human ownership can be recorded without inferring identity or silently transferring it.

**OBJ-FF-2:** Existing allocation behavior can resume with one shared, safe and durable setup path.

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-FF-1 | OBJ-FF-1 | An authenticated, explicitly authorized person sees the exact principal, candidate organization, founder shared-platform consequence and current profile owner state before confirming initial ownership; no generic admin/name/install inference establishes ownership. |
| AC-FF-2 | OBJ-FF-1 | Portal and MCP share one governed action; owner setup is persisted with reason, actor and expected-state concurrency control. Existing, partial, mismatched, inactive or concurrently changed ownership refuses safely and cannot silently transfer. |
| AC-FF-3 | OBJ-FF-2 | Setup and upgrades preserve confirmed ownership; allocation revisions, budget amounts and historical attribution remain unchanged. No owner is guessed or backfilled. |
| AC-FF-4 | OBJ-FF-2 | On the canonical live install, confirmed founder scope resolves the existing80/20 default and can be bound through bind_investment_funding to WC-B2EF4840/BI-0F8CEAD4; get_workroom then reports the exact resolved scope. |
| AC-FF-5 | OBJ-FF-1, OBJ-FF-2 | Negative cases cover unauthorized/agent-only attestation, cross-owner/cross-org, stale/replay/race, inactive identity/profile, partial ownership and cloned install; tests/typecheck/shared gate, independent review and live served UI/MCP verification pass before acceptance. |

## Ordered implementation and verification

This is one atomic repair. A writer without honest human authorization and its confirmation/read surface is unusable; UI without a writer repeats the defect. Implementation awaits independent scope/architecture/security/data/UX reviews, exact plan coverage, plan review and current implementation admission.

1. Publish this immutable design and prototype, record author research against the named source/live reproduction, and obtain required independent decisions. Record exact paths and related tests from scope claims. Refuse an implementation claim until admitted.
2. Write failing behavioral tests for absent owner setup, approval provenance, current actor/organization resolution, initial-only CAS, matching repeat, rollback, clone and policy/telemetry preservation. Implement the read/confirmation service and reuse existing profile/audit stores.
3. Register read/proposal tools, existing grant mapping and shared portal action. Test direct REST versus MCP provenance, forged/policy-only/expired envelopes, changed parameters, on-behalf approval and same-user human confirmation. Never grant a capability or add a provider to make a test pass.
4. Render the bounded setup flow in the existing allocation surface, update its authorized projection and translations, and verify empty/permission/conflict states plus light/dark, keyboard and narrow layouts. Obtain measured UX-fit evidence and the UX specialist's critique on the immutable prototype/served target.
5. Run affected tests and web typecheck, seed-preservation regression, transaction/concurrency tests on the shared governed environment, generated/data-impact and surface guards. Obtain exact-current full gate and independent semantic review; publish DCO-signed protected PR and merge through the queue.
6. Deploy only through canonical self-upgrade. Re-read exact profile state and present the implemented confirmation for the actual person's decision. After the human acts, prove read-only setup and allocation projections, then use the existing tool to bind only WC-B2EF4840/BI-0F8CEAD4. Record before/after record, approval, served commit and Workroom funding evidence. No stored comment or source test substitutes for live acceptance.

Traceability: requirements AC-FF-1 through AC-FF-5; contract CONTRACT-FF-EXPLICIT-OWNER; flow FLOW-FF-READ-CONFIRM-BIND; verification VER-FF-AUTHORITY-CAS, VER-FF-PRESERVATION, VER-FF-SURFACE, VER-FF-LIVE.

## Backlog coverage

- Decision: atomic
- Parent: BI-B14253CD
- Receipt: blocked-by: immutable artifact publication, independent scope approval and current native implementation admission are not yet complete.
- Rationale: identity confirmation, audit, proposal provenance and user surface form one usable owner setup repair; none independently restores the safe workflow.
- Dependencies: existing profile, allocation and human approval substrate only; the person's final concrete ownership confirmation is required for live setup. BI-0F8CEAD4 resumes after this repair but is not delivered here.

## Risk, convergence and rollback

The material risk is wrong platform ownership, including its future interaction with a ratified WWMD policy. Human exact-state confirmation, current checks and initial-only CAS address it. No profile version is ratified. An existing ownership conflict stops setup rather than choosing a winner. Audit is append-only; telemetry and allocation history retain their original attribution.

No schema migration or identity backfill is planned. Setup/upgrade code must keep preserving the existing fields. This install changes only after a supported human confirmation; paired installs require their own authorization and binding. Roll back code while retaining the recorded ownership/audit; do not erase an ownership act or invent a reverse transfer. If native validation or operator confirmation is unavailable, preserve the source checkpoint and report acceptance unrun.
