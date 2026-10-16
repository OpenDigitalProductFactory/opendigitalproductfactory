---
status: proposed
backlog: BI-5445CECA
---

# Delivery verification tiers

Owner: platform. Workroom: WC-DD0E6AE5. Source baseline: e05900d547cd74989e79d07d31f70cf011a41f79.

## Problem and decision

Agents can author concurrently while verification has limited capacity. DPF already delegates production builds to protected GitHub checks, selects a documentation lane, and reuses some immutable evidence. The missing contract is a reviewable declaration of which verification a delivery owes, when it is required, and which executor supplies it. A successful local gate must not imply a successful production build or served acceptance.

Extend existing delivery shapes, evidence planning and evidence records. Do not replace Git, install another process framework, add a scheduler or create a second evidence database. Preserve required protected merge checks. This design reconciles BI-5445CECA with current source rather than implementing its historical description literally.

## Existing work and reconciliation

- [CI evidence efficiency](2026-07-26-ci-evidence-efficiency-design.md) owns affected checks and exact-tree reuse; its protected merge-queue contract remains binding.
- [Resilient development](2026-08-15-resilient-concurrent-development-process.md) owns durable waits, admission, resource lanes and immutable gate identity. Its September local-capacity decision remains intact; this work buys no cloud capacity and adds no local slots.
- [Delivery closeout](2026-09-04-delivery-closeout-cost-efficiency-design.md), BI-E3B918C2, owns durable served-release acceptance. Consume that path rather than rebuilding it.
- BI-25CB699C owns classification after refreshes/corrections; BI-329B6128 owns source-head CI diff scope. Both are awaiting acceptance in the database at this inspection; that label is not proof they work on this install.
- **Coordination reconciliation, 2026-10-16:** [PR #6441](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/6441), inspected at `f510fbaf5ac8965ab11af8965472e059b4bceea7`, implements BI-25CB699C's post-publication correction policy. `scripts/published-correction.mjs` owns `verifyPublishedCorrection`, affected command selection, existing stage-receipt persistence and single-flight locking; `packages/dpf-skill-pack/hooks/lib/published-correction.mjs` owns the shared classifier. The Git hook, packaged evidence guard, readiness and health readers consume that policy. It binds a qualified initial-publication anchor, current source/toolchain/environment/plan, protection observation and freshness, and labels integration UNRUN. Source inspection confirms those mechanisms; this design claims neither their live acceptance nor a passing independent security review.
- Consume PR #6441's published-correction policy rather than add another classifier, correction receipt, rerun engine or competing hook branch. Its initial anchor requirement is deliberate: an open PR alone does not authorize lighter checks. The residual scope here is lifecycle declaration, any demonstrated initial-publication gap, cross-executor/server evidence transport, release admission and operational projection. Verify each gap against the containing source before claiming its paths.
- [PR #6439](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/6439) merged as `03bbac43850f25a69575341c329c3d0ea4280238`. That proves source delivery of the review-request identity repair, not deployment. This Workroom's review dispatch was refused on the prior runtime; retry exact issuer packets only after containing served-release proof, without changing request keys or treating an alternative route as approval.
- `scripts/lib/local-integration-ci.mjs` defaults to `merge-queue` build delegation and fingerprints that strategy. `scripts/pregate.mjs` reuses an existing PASS at HEAD. Preserve both.
- `apps/web/lib/work-management/delivery-shapes.ts` declares `pr-gate` but has no lifecycle verification policy. `work-shape-evidence-kinds.ts` has no four-tier vocabulary. `config/ci-evidence-policy.json` governs evidence selection rather than lifecycle obligations.
- `apps/web/lib/nonprod/local-ci-slot-resources.json` declares two slots and a 16 GiB builder budget. This is configured capacity, not evidence that every current run reserves that amount or that the pool is presently congested.

## Research & Benchmarking

| Comparator | Data model or mechanism | Adopt | Reject |
| --- | --- | --- | --- |
| [Anthropic Scion](https://www.anthropic.com/engineering/redesigning-source-control) | Immutable changesets, derived data, source-control APIs; post-merge and pre-deploy testing at exceptional scale | Measure repeated work; make recovery and release testing first-class | Bespoke SCM, assumed DPF benchmark gains, removing protected integration checks |
| [GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | Temporary merge groups combine target branch and queued changes; required checks bind to that candidate | Keep authoritative integration evidence for the combined tree | Treating PR-head checks as proof of a different merge tree |
| [Nx affected](https://nx.dev/docs/features/ci-features/affected) | Git changes plus project graph determine affected projects and dependent tasks | Reuse DPF's existing planner with conservative uncertainty expansion | Adding Nx or allowing a shape label alone to narrow impact |
| [BMAD evaluation](../../security/tool-evaluations/2026-09-15-bmad-method.md) | File-backed workflows and size-adapted delivery paths | Proportional work and bounded review; use the existing recorded evaluation | A parallel file-based coordination plane or framework dependency |
| [Bazel remote caching](https://bazel.build/remote/caching) | Action inputs and outputs identify reusable build results | Explicit input identity and separation of cache hits from executed checks | Inferring runtime acceptance from cached source checks or adding a remote cache here |

Anthropic's numbers are first-party case-study reports, not independently reproduced results or DPF targets. Commercial execution comparisons are GitHub Actions and Nx Cloud; neither requires a new subscription for this design. Existing BMAD evaluation is reused as a dated benchmark rather than claimed as a fresh execution.

## Objectives

**OBJ-VT-1:** Declare verification obligations once for delivery shapes and project them into existing executor plans without independently hard-coding lifecycle requirements in hooks.

**OBJ-VT-2:** Preserve valid evidence and rerun only the obligations invalidated by changed inputs, while retaining conservative impact expansion and required integration coverage.

**OBJ-VT-3:** Prevent release promotion on missing, inconclusive or failed required release evidence and route a reproducible failure through existing deduplicated corrective-work machinery.

**OBJ-VT-4:** Explain delivery progress and cost through existing evidence, Workroom and queue projections, distinguishing execution, reuse, delegation, waiting and operational acceptance.

## Contract CT-VT-1: policy and compatibility

Use a versioned, renderer-neutral lifecycle policy consumed by Node executors and server delivery definitions. Extend the existing evidence-policy family instead of creating a second planner. A policy binding names a delivery shape reference, verification tier, lifecycle boundary, evidence producer and mandatory obligations. The tier vocabulary is `fast-local`, `merge-queue`, `post-merge`, `pre-deploy`; these describe evidence location and timing, not a blanket exemption.

`fast-local` means source-local guards, affected tests and required typechecks selected by the existing impact planner. Documentation retains its exact documentation contract. Auth, schema, workflow, install and unresolved changes retain their required additional checks. Missing/untrusted shape or policy never selects a lighter lane.

`merge-queue` remains mandatory before protected merge for every executable delivery shape. It proves the tested integration tree, not that the resulting release is deployed. `post-merge` consumes compatible protected evidence for a release candidate and executes missing integration obligations. `pre-deploy` binds the immutable canonical release artifact and migration/upgrade readiness. Served acceptance remains a separate obligation after deployment; do not rename it pre-deploy.

Xlarge is decomposition-only and cannot acquire an executable verification policy. Break-fix retains its existing declaration authority and PIR, and gains no permission to bypass required merge checks.

Changing a shape's stages or gates requires a new shape version. Existing `@1.0.0` records and readers remain resolvable with their historical obligations. New versions require coordinated registry, derivation, MCP schema and projection support; never silently rewrite an existing room or invalidate its receipts merely by deploying definitions. Introducing tier metadata alone cannot advance a stage. A receipt-kind declaration alone is not enforcement.

## Contract CT-VT-2: evidence and executors

Extend the existing gate/evidence identity: repository, tested tree, plan/policy digest, toolchain/dependencies, tier and required runtime context. Runtime checks also bind installation, immutable artifact, contract, persona, tenant and fixtures where applicable. Never accept a source SHA merely because it is equal to a previous author SHA when integration inputs differ.

Record obligations as executed, reused, delegated, pending, failed or inconclusive in existing evidence payloads. Delegation identifies the authority that must supply the missing receipt; it is not a PASS. Unknown or incompatible identity requests the missing checks. An infrastructure interruption preserves earlier immutable evidence and remains inconclusive. An authorized rerun creates an attempt, not an overwrite of the previous receipt.

The pre-push adapter asks the declared policy for pre-push obligations and invokes existing planners/runners. Build Studio and external clients use the same resolver. Preserve the current production-build delegation. No unchecked environment variable, client assertion, arbitrary evidence payload or shape title can create a passing tier receipt or waive a guard.

For an already-published correction, the existing `published-correction-v1` producer and classifier remain authoritative for their lane. Lifecycle policy consumes that qualified outcome and its explicit integration delegation; it does not recreate its identity, expiry, anchor or command validation. Preserve the stable branch merge-base binding that avoids invalidation from unrelated advancing main, and preserve validation of actual changed upstream inputs. The source's exclusion of `CODEX_TOOL_CALL_ID` from incidental invocation identity is not permission to exclude semantic environment inputs. Initial publication and server transport need explicit adapter contracts only where a current source audit proves they are missing.

## Contract CT-VT-3: release recovery

Reuse canonical promotion, self-upgrade, RuntimeVerification and closeout acceptance. A failed or inconclusive required release check prevents the candidate from advancing; it does not waive a protected merge check or automatically stop unrelated authoring. Reuse the existing corrective-work fingerprint keyed by contract, artifact and failure. Missing wiring is a blocker to policy activation, not permission to merely emit a new evidence label.

Use bounded retry for infrastructure failures and one corrective item for a reproduced behavioral failure. Application rollback uses the canonical recovery path; forward-only database migrations and external side effects require their existing recovery contracts. Do not promise that reverting a commit undoes them.

## Contract CT-VT-4: projection and measurement

Extend existing Workroom/Task Hub read models, not a new dashboard. Preserve phase distinctions: authored, checked, merged, release check pending, deployed, acceptance pending, accepted. Show the current blocker, responsible executor, next action, evidence freshness and executed/reused/delegated status; disclose detailed logs on demand. Use existing theme tokens, accessible labels and mobile layout conventions if a renderer changes.

Measure stage wait separately from execution, repeated executions per compatible identity, infrastructure retries, median/p95 push-to-merge time, queue depth/abandonment, and available inference cost. External subscription usage that is unavailable remains unknown. Compare seven-day cohorts without generating a synthetic 160-thread load; report sample size and workload mix. Targets are reduced repeat execution and delivery wait without increased escaped defects or lost required obligations; no throughput multiplier is assumed.

## Acceptance

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-VT-1 | OBJ-VT-1 | Every executable delivery shape resolves a versioned policy and required tier obligations; xlarge, unknown versions and missing policy cannot select a lighter verification path. |
| AC-VT-2 | OBJ-VT-1, OBJ-VT-2 | Pre-push and Build Studio consume the same resolver, preserve protected merge checks, and do not launch a local production build for the ordinary delegated small-delivery path. |
| AC-VT-3 | OBJ-VT-2 | Metadata-only and unchanged-source retries reuse compatible evidence; changed tree, dependencies, toolchain, policy, tier or required runtime context invalidate only compatible affected obligations and never inherit an unrelated PASS. |
| AC-VT-4 | OBJ-VT-1, OBJ-VT-2 | Migration, auth, workflow, shared setup and unresolved impact fixtures expand to all applicable checks regardless of shape; legacy shape references and receipts remain readable without claiming new-tier completion. |
| AC-VT-5 | OBJ-VT-3 | Through canonical release admission, failed, absent or inconclusive required post-merge/pre-deploy evidence blocks promotion; duplicate failure events create one corrective item and infrastructure retries stay bounded. |
| AC-VT-6 | OBJ-VT-3, OBJ-VT-4 | Served acceptance retains exact artifact and per-outcome context, and an authoring chat can end after durable handoff without losing a pending acceptance obligation. |
| AC-VT-7 | OBJ-VT-4 | Existing operational projections distinguish waiting, executed, reused, delegated and pending acceptance, with blocker and next action; any changed UI is verified in the served target in light/dark and desktop/mobile contexts. |
| AC-VT-8 | OBJ-VT-2, OBJ-VT-4 | A seven-day before/after report includes sample size, workload mix, duplicate executions, median/p95 delivery time and queue metrics, with unmeasured cost and unrun checks explicitly identified. |

## Rollout, risks and rollback

First reconcile and accept already-delivered evidence reuse and CI-scope fixes. Introduce policy resolution and comparison in shadow mode without weakening the current gate. Activate only after hook/server parity, evidence integrity, legacy compatibility and release failure-path tests pass. Record the effective policy digest in receipts and permit no client-selected downgrade. Required GitHub branch checks stay unchanged.

The main risks are trusting unvalidated new evidence labels, mismatching source and integration trees, silently changing versioned shapes, and moving checks later before release admission exists. Each has an explicit acceptance fixture above. Rollback restores the previous executor policy, preserves every evidence record and pending acceptance obligation, and treats unsupported tier/version evidence as requiring supported verification rather than synthesizing a PASS.

## Design grounding

Existing specifications and code are named above. The change extends the work-management definition contract and existing evidence/admission adapters; it introduces no persistent model, permission, deployment substrate or subscription. Deployment identity remains governed by canonical promotion/self-upgrade. Architecture review must confirm the shared policy ownership, version compatibility and activation fence before implementation. Independent spec approval and plan coverage are prerequisites, not claimed by this document.
