---
status: draft
---

# Principle-directed agent engineering: composition design

Epic **EP-B932453F**; normative design **BI-A484D58F**; Workroom **WC-69A3C17B**.
Date: 2026-09-27. This is an informative implementation design awaiting independent
review. The [baseline](2026-09-27-trusted-agent-mbse-baseline-design.md) owns the
programme evidence inventory; the live backlog owns status and delivery coverage.

## Design decision and boundary

Compose established modeling approaches around a versioned agent control loop.
TAK remains the runtime-control owner, GAID the identity/receipt owner and JSI the
qualification owner. The [standards family map](../../architecture/agent-standards-family.md)
is the ownership entry point. This design adds no policy engine, scheduler, graph
store, transport or global certification authority. It does not prescribe an LLM,
vendor, OS, hardware boundary or decision-scoring algorithm.

The object being engineered is the complete operating composition: actor and
principal, job, instructions, doctrine, models, tools, data, memory, oversight,
execution boundary and feedback. A model benchmark or imported skill bundle
cannot by itself qualify this composition or authorize its actions.

## Proposed requirements and assurance trace

Normative text lives in the existing standards. The new identifiers remain stable
even if section numbering changes. An assessment pins the reviewed source revision;
this draft does not silently revise existing conformance or qualification claims.

| Normative owner | Clauses | Observable assertion owner |
|---|---|---|
| [TAK §7.13](../../architecture/trusted-ai-kernel.md#713-principle-directed-decision-contract) | TAK-PD-001 through TAK-PD-008 | [TAK-029 through TAK-036](../../architecture/tak-conformance-tests.md#principle-directed-amendment-assertions) |
| [TAK §12.5](../../architecture/trusted-ai-kernel.md#125-data-admission-and-processing-boundaries) | TAK-DG-001 through TAK-DG-004 | TAK-037 through TAK-040 in the same rubric |
| [GAID §10.2.1](../../architecture/GAID.md#1021-principle-directed-execution-binding) | GAID-PD-001 | Resolve a receipt to the evaluated profile, decision, authorization and effect/attempt identity. Join a delayed uncertain-effect observation to the same effect; verify unauthorized readers cannot retrieve protected evidence. |
| [JSI §8.4](../../architecture/job-specific-intelligence.md#84-qualification-of-principle-directed-work) | JSI-PD-001 | Run scope-conflict, hard-constraint and missing-evidence work samples against the assessed composition; resolve corpus/axis, work-shape, routing, tool/data and oversight versions from the qualification record. |
| JSI §8.4 | JSI-PD-002 | Import a definition into a different harness. Retain Defined status until target evidence or a scheme-defined equivalence decision supports a stronger claim; disclose unsupported controls. |

The two JSI and one GAID assertions above are proposed assessment cases, not a
second source of normative requirements. BI-2AB781FA owns their executable form
and integration with the existing family rubrics. No assertion has been run by
writing this design.

## Semantic vocabulary and modeled links

| Concept | Meaning and minimum binding |
|---|---|
| Requirement | Stable clause and source revision; accountable owner and applicability |
| Operating composition | GAID subject plus immutable profile revision; JSI scope/status |
| Authority scope | Owning platform, organization or craft authority; doctrine and resolver |
| Work definition | Versioned activity shape, participants, prerequisites, transitions, bounds and stop conditions |
| Evidence snapshot | Source references, access/purpose constraints, freshness and observed versus inferred status |
| Decision | Question/options, eligible alternatives, governing scope and recommendation/hold/refusal |
| Action proposal | Exact effect, target, parameters, purpose and required preconditions |
| Authorization | Attributable permission for the bound action, validity and revocation conditions |
| Effect attempt | Durable identity and target submission/reconciliation state |
| Receipt and observation | Attributed execution evidence and the subsequently established outcome |
| Assurance claim | Versioned assertion, enforcement boundary, test evidence, limitations and residual-risk owner |

The trace is requirement → work/decision → control boundary → effect → receipt →
observed outcome → qualification/revalidation. Intended model state, deployed
control state and observed outcome remain separate facts. A projection or diagram
is a view of their relationships, never a replacement authority record.

DPF binds platform judgment to WWMD, organization judgment to WWWD and craft
judgment to WSID. Other implementations can use different names and doctrine.
Cross-scope material is advisory until its competent owning authority adopts it.
Do not merge the three scopes by averaging scores or silently inheriting the
founder's preferences into a customer's business decisions.

## Research & Benchmarking

Primary sources were checked on 2026-09-27. These are design comparisons, not
claims that DPF implements all semantics or that a vendor passes TAK assessment.
The [external alignment companion](../../architecture/agent-standards-external-alignment.md#mbse-composition-mapping)
owns the modeling crosswalk and its limitations. SysML 2.0 supplies a systems
modeling specification and machine-readable artifacts; DMN 1.5 supplies the
decision-model specification; PROV-O supplies provenance terms. Their combination
does not itself establish runtime enforcement.

| Open-source comparison | Pattern used in this design | Disposition |
|---|---|---|
| [Temporal workflow execution](https://docs.temporal.io/workflow-execution) | Durable history, explicit execution identity and recovery from recorded events | Absorb the recovery discipline into DPF's existing work/attempt records; do not add another scheduler or infer exactly-once external effects. |
| [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) | Explicit durable pause/resume boundaries | Require fresh authority on resume and declared effect boundaries; checkpointing alone does not authorize actions. No new framework dependency. |
| [Cedar](https://docs.cedarpolicy.com/) | Candidate comparison for principal/action/resource/context policy | Existing baseline identified this comparison; the specific authorization page could not be retrieved in this check. No new Cedar-specific semantic claim or adoption decision is made. |

Temporal and LangGraph provide the two retrieved implementation comparisons.
Neither replaces the existing DPF authority intersection. Hermes and Cursor are
adapter targets owned by BI-FEA232AF and BI-0E56BA38; their actual enforcement
capabilities need separate inspection before a portability claim.

## Reference control loop

The following pseudocode is informative. BI-F9582C48 owns executable schemas and
reference implementation; this proposal is not a runnable security boundary.

```text
advance(work_id, trigger):
    work = load_versioned_work(work_id)
    if not within_declared_bounds(work, trigger): return record_hold(work)
    scope = resolve_owning_scope(work, trigger)
    if scope.unresolved: return hold_for_scope_owner(work, scope)
    profile = resolve_current_operating_composition(work.actor)
    evidence = collect_authorized_evidence(work, scope)
    context = assemble_with_source_restrictions(evidence)
    destination = resolve_actual_processing_destination(profile)
    if not process_allowed(context, destination): return record_refusal(work)
    options = formulate_options(scope, context, profile)
    eligible = apply_hard_constraints(options, current_policy())
    if eligible.empty: return record_refusal_or_evidence_hold(work)
    judgment = rank_or_compare(eligible, versioned_preferences(scope))
    proposal = bind_exact_action(judgment, work, profile, evidence)
    decision = record_decision(proposal, scope, evaluated_versions())
    authority = resolve_current_authority(proposal)
    if authority.needs_ruling: return persist_bounded_review_request(decision)
    if authority.denies: return record_refusal(work)
    attempt = prepare_effect_identity(proposal, decision, authority)
    # Adapter supplies the documented revalidation/use atomicity contract.
    result = mediated_execute_with_current_checks(attempt)
    persist_receipt(attempt, result)
    if result.effect_uncertain: return schedule_bounded_reconciliation(attempt)
    observation = observe_effect(attempt)
    record_outcome_and_revalidation_signals(observation)
```

Tool-assisted evidence gathering is itself governed execution. Every additional
context source, delegate, model fallback and outbound result re-enters the
applicable data and destination checks. Record an attempt before submission;
reconcile accepted-but-unacknowledged effects after a crash. If the adapter cannot
prevent an authorization/use race, disclose its containment mechanism and refuse
claims requiring stronger atomicity. A transaction in DPF alone cannot make an
unrelated external system transactional.

## DPF realization and scale

Extend the existing decision-perspective admission, TAK preexecution controls,
MCP governed-execution wrapper, work shapes, authority projector and receipt/evidence
records identified in the baseline. GAID/profile identities remain canonical;
architecture grounding and existing SysML projections provide views. Any schema
change belongs to its implementation item after a current schema audit.

Use per-workroom transitions and bounded evidence references. Render portfolio
summaries from paginated projections and support incremental updates; do not scan
every decision or materialize every source into a single prompt. Each adapter
declares maximum active work, evidence payload and retry budgets. This design makes
no tested throughput claim; BI-F3C2EC7A measures the reference implementation's
ceiling, while broader scaling remains with EP-MBSE-WORKROOM-SPINE. A partial or
truncated projection identifies what it omitted.

BI-1F8CCBFF owns admission, BI-0212E871 owns destination/provider policy convergence
and BI-BBE6A910 owns source restriction propagation. These items remain separately
owned. Conformance evidence consumes their actual delivered controls, not their
backlog status or a global enforcement switch.

## Hazard analysis and acceptance

| Unsafe control action | Business effect | Prevention, detection and recovery |
|---|---|---|
| Wrong authority resolves the decision | Customer intent replaced by another scope | Scope binding; wrong-owner fixture; hold for competent resolver |
| Attractive score outweighs a prohibition | Unauthorized action | Eligibility before ranking; adversarial-score fixture; refusal before effect |
| Approval reused after mutation/revocation | Unauthorized changed effect | Exact binding/current checks; race fixture; adapter containment and reconciliation |
| Retry repeats an uncertain external action | Duplicate publication, charge or change | Durable effect identity; lost-response fixture; target reconciliation |
| Context transformation or fallback erases restrictions | Unauthorized disclosure | Source/purpose/destination checks; transformation fixtures; stop processing and investigate exposure |
| Review or infrastructure stalls independent work | Avoidable delay and misleading status | Durable status and specific blocker; bounded recovery; continue only independent authorized work |

Residual risks include compromised hosts, unmediated reachable tools, external
system races, incomplete evaluations and unavailable accountable reviewers. Each
implementation statement assigns their owner and disposition; this draft does
not accept those risks for a customer or claim universal safety.

Design acceptance requires independent clause/ownership review, a version-pinned
crosswalk for every new requirement and an explicit disposition of unsupported
semantics. Runtime acceptance additionally requires executable fixtures, target
effect observations and evidence on the canonical install. Source documentation
checks establish only document consistency. Rollback for this slice is a PR revert;
no runtime, data migration or enforcement-mode change is included.
