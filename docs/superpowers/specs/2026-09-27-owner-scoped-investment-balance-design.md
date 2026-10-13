---
status: draft
---

# Investment balance belongs to the budget owner

**Backlog:** BI-0ACB97B5 · **Epic:** EP-PORTFOLIO-BUDGET-WIP · **Workroom:** WC-B5D4B788.

Extends [portfolio budgeting](2026-09-24-portfolio-budget-and-investment-wip-design.md) and [capacity allocation](2026-09-15-proactivity-and-capacity-allocation-design.md). This is a design for implementation review; runtime behavior has not changed.

## 1. Founder direction, 2026-09-27

The founder's investment in shared DPF functionality targets roughly **80% refactoring, integration and repair; 20% new functionality**. That direction covers the founder's development and production installations. Other owners' archetype functionality defaults to **20% refactoring; 80% new functionality**. The accountable person can change the balance for the budget they control.

These are cumulative investment targets over time. An individual task may be entirely a repair or entirely new functionality. Bug fixes normally count toward refactoring. Do not create cleanup work or inflate estimates to satisfy a task-level percentage. Preserve excellent UI design, architecture and alignment to shared platform capabilities in both allocations.

WWMD supplies the founder's shared-platform direction. WWWD supplies each organization's business investment choices. WSID supplies professional judgment about sound implementation, reliability and obligations. Professional judgment can identify necessary work; it does not acquire the owner's spending authority.

This direction supersedes a blanket reading of the older 20% refactor instruction. Development environment, production environment, installed archetype, administrator role, room coordinator and executor identity are each insufficient to identify the funding authority.

## 2. Evidence and existing substrate

Inspected on source `origin/main` at `71b9df9f087`, and through the development install's governed MCP on 2026-09-27:

| Existing home | What it supplies | Required extension |
| --- | --- | --- |
| `docs/founder-kernel/wiki/principles/absorb-dont-adopt.md` | Live corpus and source already state 80% refactor | State whose budget and which work the direction governs |
| `architecture-over-shortcuts.md`, `substrate-cleanup-before-substrate-addition.md` | Still cite a general 20% refactoring budget | Replace active blanket assertions with pointers to scoped policy; preserve historical spec facts |
| `PlatformConfig` and `packages/db/src/installation-operating-intent.ts` | Validated, versioned installation configuration | Persist scoped policy through the same configuration substrate |
| `DecisionPerspectiveProfile`, versions, canonical `Principal` and `Organization` | Scope ownership and ratified authority | Verify the budget principal against the applicable authority; never infer founder status from names or an admin flag |
| `Workroom`, participants and `room-ownership.ts` | Requester, decision scope, coordination ownership, policy JSON and activity history | Bind a funding policy separately from the execution coordinator |
| `PortfolioBudgetPeriod` and `portfolio/portfolio-budget.ts` | Quarterly points, attributable writes, supersession | Keep point admission intact; project balance alongside it |
| `demand/policy.ts`, `demand/buckets.ts` | Demand ordering and run/grow/transform targets | Keep those investment horizons distinct from refactor/new |
| `AgentBudgetEvent`, `TokenUsage`, `BuildPhaseRun` | Recorded inference consumption | Reuse one deduplicated attribution path; extend budget slice BI-0CA5DA2B |
| `mcp/agent-host-instructions.ts`, `build/build-agent-prompts.ts` | External and embedded execution context | Render the same resolved policy and provenance |
| `work-management/work-shapes.ts` | Stage ceilings and stop conditions | Preserve ceilings while adjusting eligible future work selection |

The MCP connection reports this operator's development install, purpose `evolve-dpf`, paired with the operator's production install, but carries an animal-rescue business context. This is an actual counterexample to deriving founder budgeting from the installed archetype. The peer remains read-only under this connection's contract.

The existing budget epic has nine items. None of their acceptance criteria supplies this owner-scoped balance. Their delivered code is reused even where backlog acceptance is pending. BI-9C384562 covers WWMD authority routing and policy ratification, not allocation; BI-6B33B1C8 covers craft-corpus curation, not budgeting. This work does not reopen either.

Current-base reconciliation (2026-10-13, `e4edd79cd6c`): `platform-dev-policy.ts` now supplies `resolveDevelopmentInvestmentTarget` and shared guidance to MCP and Build Studio. Extend this existing resolver. `absorb-dont-adopt` and `architecture-over-shortcuts` now express the owner-scoped policy; only active contradictory guidance still needs correction. `portfolio/accountable-owner.ts` supplies canonical accountable identity, but its fallback owner is not proof of funding authority. `portfolio/ai-resource.ts` counts BuildPhaseRun once per item; use that authoritative source for the initial observed mix and explicitly disclose external/other inference coverage gaps instead of summing overlapping ledgers.

## 3. Research & Benchmarking

The following are design precedents, not new dependencies:

| Source | Adopt | Reject |
| --- | --- | --- |
| [Apache Hadoop Capacity Scheduler](https://hadoop.apache.org/docs/r3.4.0/hadoop-yarn/hadoop-yarn-site/CapacityScheduler.html) | Hierarchical allocation and weights within a parent budget | Preempting a running governed task to repair a share imbalance |
| [Apache Airflow pools](https://airflow.apache.org/docs/apache-airflow/2.10.5/administration-and-deployment/pools.html) | Keep resource admission separate from ordering eligible work | Uniform task slots as a proxy for token investment |
| [Kubernetes resource quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/) | Bind resource policy to its owning scope and show usage | A hard admission refusal solely because one investment category exceeds its target |
| [AWS Budgets actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html) | Separate a budget threshold from the authority to perform a resulting action | Automatic resource shutdown for a planning-share deficit |
| [Microsoft Cost Management budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets) | Explicit scope and actual-versus-forecast labels | Treating incomplete observation as real-time complete consumption |

These systems do not establish DPF founder identity or decide customer business priorities. That authority comes from DPF's existing scoped identity and decision contracts.

### Storage decision

WWMD consultation **DI-A40A56094690** recommends extending existing scoped configuration instead of attaching the policy exclusively to quarterly points rows. The result is usable and autonomy-eligible, high confidence, with no commandment conflict. Strong contributors include Proper Fix Over Quick Fix, Ground New Work In Existing Platform and Single Source of Truth. It governs storage choice only; it does not approve implementation or ratify a customer's budget.

## 4. Authority and resolution contract

Resolve the funding authority before selecting a percentage. A policy names the canonical organization and accountable human principal, the owning decision profile, work scope, optional portfolio and effective interval. Verify those references and the actor's authority server-side on every write. A coordinator, assistant or installer can carry a valid delegation, but cannot manufacture one.

The same person may wear different hats. Founder-funded shared-platform work uses the founder's platform policy. A customer-funded contribution to shared code remains the customer's investment, although WWMD and WSID still govern the platform change's acceptability. Classifying the code as platform work never spends the customer's capacity under founder priorities by itself.

Resolution order, within one verified authority boundary:

1. An explicit, valid policy binding for the funded work in this Workroom.
2. The nearest applicable parent-room binding, following `contains` relations without crossing organization or authority boundaries.
3. An owner-approved portfolio policy, then that owner's installation policy for this work scope.
4. A labelled default: founder/shared-platform 80% refactor; non-founder archetype work 20% refactor. The default is a proposal when authority or purpose is unresolved.

Reject conflicting same-precedence policies, expired delegation, malformed percentages, stale writes and cross-owner references. Missing ownership stays unresolved. Do not silently interpret unresolved as either founder or customer, or overwrite an explicit policy with a default.

Changing executor leaves the binding intact. Changing coordinator does not transfer the funding policy. An actual transfer of funding ownership requires a governed successor binding; historical usage retains the old owner and policy revision. Mixed-purpose rooms bind each funded work item to its own policy rather than averaging unrelated owners' percentages.

## 5. Persistence and boundaries

Use `PlatformConfig` keys in an `investment-balance.v1` namespace: one current pointer per canonical authority/scope key and one immutable value per revision. Each revision contains validated canonical references, refactor target (new target is its complement), effective dates, rolling window, permitted steering bounds, actor, reason, prior revision and authority-decision reference. A transaction inserts a revision and compare-and-swaps the pointer. No fleet-wide JSON array and no replacement budget table.

`Workroom.promotionPolicy` holds only the validated binding/reference. Effective percentages are read projections, not another mutable policy copy. Preserve unrelated policy keys. Workroom activity records creation, rebinding, overrides and steering decisions. Existing canonical identity and `DecisionScope` values are reused; any new persisted closed axis follows the enum-generation contract.

Do not put a funding policy inside `DecisionPerspectiveProfile.autonomyPolicy`: authority to act and what investment should buy are different facts. Link to the governing profile/version instead. Likewise, run/grow/transform, quarterly investment points, dollar ceilings and task resource ceilings keep their existing meanings.

At setup, show the owner, funded scope, default and its reason in the existing installation journey. A verified founder can apply the shared-platform direction to installations they own. Pairing or cloning alone never grants this authority. Migration leaves existing owner choices intact; installs without a policy see a proposal. Re-running setup is idempotent. Applying to another install uses its governed write path and its ownership checks, not a mirrored-row mutation.

## 6. Measurement and dynamic steering

Reuse BI-0CA5DA2B's token attribution work rather than build a competing ledger. Initial observed totals use `BuildPhaseRun` exclusively, once per `(source installation, run id)`; do not add `TokenUsage` or `AgentBudgetEvent` totals to overlapping build summaries. Those sources may be added only after a canonical linkage and non-overlap invariant is demonstrated. External and other inference remain explicitly outside this initial measured coverage.

Add a nullable `BuildPhaseRun.investmentAttribution` JSON snapshot, validated by the shared policy contract. Capture it atomically at phase creation, before inference: source installation id, canonical funding principal and organization, purpose, funded item id, policy revision, classification and captured timestamp. Never update this snapshot on retries or policy/owner changes. A change applies at the next phase boundary; no mid-phase transfer. The existing `(buildId, phase)` uniqueness prevents retry double counting. A legacy run without a snapshot stays unassigned; do not backfill by guessing from current ownership or the mutable build-to-item relation. A snapshot is provenance, not current write authority; policy revisions remain the single home for target values. Apply the additive nullable migration through normal deployment, and classify the snapshot's identity fields in the existing data registry.

Project `bug` and `refactor` into refactoring by default. Project `feature` into new functionality. `chore`, `doc`, `tool` and `skill` need an outcome classification; a label alone cannot distinguish repair from expansion. Mixed work uses separately evidenced segments where available. Otherwise report the allocation as estimated; never split actual tokens by the desired ratio and call that measured spend. Emergency repair counts as refactor but remains eligible regardless of imbalance.

Report refactor tokens, new tokens, unattributed tokens, classification coverage, measurement source and freshness. Unobserved external work is a coverage limitation, not a numeric zero. Report dollars and latency beside tokens; do not convert investment points, money, model tokens or human time into one synthetic unit. Subscription consumption is not free merely because recorded dollars are zero.

Proposed initial observation window: rolling six weeks, matching the existing throughput window. This is an implementation default, not founder doctrine. At each ordinary dispatch boundary, compute the gap between target refactor tokens and attributed refactor tokens. A gap outside the configured tolerance biases selection among ready, funded candidates within the same owner/scope. Preserve demand ordering within a category. Apply bounded weights and record the reason; do not interrupt work, create artificial cleanup, change the target automatically or start unapproved work.

The owner may authorize bounded target adjustments or adopt a proposed revision. Until then, dynamic adjustment means adjusting future selection toward the owner's target. With insufficient or stale telemetry, show the target and missing evidence but do not apply measured-deficit steering. Obligations, urgency, hard spend limits, dependency readiness and existing WIP admission take precedence. No eligible work in the preferred category is a reportable supply gap; other authorized work can proceed.

## 7. Shared presentation and corpus

The existing budget view gains one compact balance row: **budget owner and purpose**, target, observed balance, coverage, and why the next selection is preferred. An owner can change the target through the existing governed budget control. Details disclose policy source, revision, delegation and usage provenance. Unknown data has text, not an empty bar. Compose report-kit, semantic labels and theme tokens; keyboard and narrow-screen operation are part of acceptance.

Build Studio and external MCP Workroom reads consume one resolver and formatter. Connection-time MCP context explains the default and scope requirement; a Workroom read supplies the exact bound policy. Re-resolve at claim/dispatch so a long-running external session cannot keep spending from stale connection text.

Corpus changes ship with runtime support: `AGENTS.md` points to the canonical policy; `absorb-dont-adopt` states the founder's scoped direction; the two stale active principles point to it rather than repeat a universal 20%. WWWD onboarding offers the customer default without impersonating a recorded customer decision. WSID portfolio-management and software-engineer guidance explains measurement and repair classification, while retaining the budget owner's authority. Historical plans are not rewritten as if they had always used the new rule.

## 8. Objectives and acceptance

**OBJ-BAL-1:** Allocation follows its accountable owner.

**OBJ-BAL-2:** Explicit choices survive lifecycle changes.

**OBJ-BAL-3:** Every delivery surface reads one policy.

**OBJ-BAL-4:** Long-run steering uses honest evidence.

**OBJ-BAL-5:** Obligations and authority remain intact.

**OBJ-BAL-6:** Owners and agents can understand the result.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-BAL-1 | OBJ-BAL-1 | The same verified founder shared-platform binding resolves 80/20 on dev and prod, including an install with a customer archetype; non-founder archetype work resolves 20/80 on either environment. |
| AC-BAL-2 | OBJ-BAL-2 | Owner overrides survive upgrade/setup reruns; executor changes preserve bindings; funding transfer requires a successor; cross-owner/expired/stale writes fail. |
| AC-BAL-3 | OBJ-BAL-3 | Identical fixtures produce identical effective policy and reason through Build Studio and MCP; per-item bindings keep mixed rooms separate. |
| AC-BAL-4 | OBJ-BAL-4 | Deduplicated token totals reconcile; missing, stale, mirrored, mixed and external usage are labelled; simulated multiple dispatches approach target when eligible demand permits without per-task quotas. |
| AC-BAL-5 | OBJ-BAL-5 | Emergency bugs remain eligible, counted as refactor; no policy bypasses spend/WIP/readiness checks; WWWD customer money cannot inherit WWMD spending direction. |
| AC-BAL-6 | OBJ-BAL-6 | Live setup, budget view, Build Studio and external reads show owner, scope, target and coverage; active corpus guidance agrees; light/dark, keyboard and narrow viewport checks pass. |

The test matrix crosses founder/customer, platform/archetype, dev/prod and embedded/external execution. It also includes no budget row, unknown owner, unratified authority, customer-funded platform contribution, mixed rooms, multi-parent conflict, cyclic hierarchy, ownership transfer, cloned installation, paired-install replay and missing telemetry. Cross-install production mutation is not part of this development verification.

## 9. Delivery boundaries, compatibility and risks

Implement as reviewed slices under this design: (1) governed configuration, resolver and installation lifecycle; (2) Workroom bindings and Build Studio/MCP parity with canonical guidance; (3) token-mix projection and bounded steering, extending BI-0CA5DA2B; (4) owner-facing setup/budget presentation and deployment verification. Before an implementation plan is approved, map each independently shippable slice to a live BI and record coverage. This design is not a substitute for those receipts.

Most work converges existing policy, identity, context and attribution seams. New code supplies the missing scope binding and balance calculation. Track the founder's refactor-heavy direction cumulatively; no fabricated exact 80% claim for this branch.

Initial persistence adds validated config values and policy references; no destructive schema migration. If attribution needs additional columns, use nullable additive fields and forward-only backfill. Existing configurations without bindings retain existing hard gates and receive an unresolved/proposed balance. Rollback disables balance steering and reverts code; preserve policy revisions and accounting evidence.

Bound parent traversal (cycle detection and explicit depth overflow), use indexed config-key reads and aggregate usage by bounded time range. Paginate owner policy listings and usage reconciliation. Acceptance load fixture: 10,000 Workrooms and one million usage rows in the measured window on one install; verify query plans and response budget before claiming this scale supported. Cross-install aggregation consumes authorized incremental summaries, never full-estate scans. The existing budget epic owns any measured scale gap.

Primary risks are false founder identification, customer spending governed by the wrong corpus, coordinator mistaken for payer, duplicate accounting and stale cached policy. Each has an explicit refusal or coverage state above. An 80% target does not excuse unnecessary changes or weaken architecture, security, production or peer-integrity controls.
