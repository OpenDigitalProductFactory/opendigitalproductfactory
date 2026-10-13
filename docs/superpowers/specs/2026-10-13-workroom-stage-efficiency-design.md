---
status: draft
---

# Workroom execution and approval efficiency

Owner: BI-E9555B2D, under EP-B932453F. Workroom: WC-471E24C1. Decision: WWMD DI-F0391366574D, followed by the agent after an autonomy-eligible, high-confidence recommendation with no commandment conflict. This canonical source draft awaits independent approval and live decomposition coverage. It does not authorize implementation or enforcement promotion.

## Problem and scope

The platform already has granular tools, standing grants, GPP bindings, workroom stages, approval envelopes and portfolio investment records. Their projections do not consistently cooperate. A coworker may receive too many schemas, omit a required writer, retry a settled refusal, or require a person to interpret technical records to advance ordinary work.

Refactor the existing projections and adapters. Keep OAuth transport authority, coworker grants, user capabilities, room membership and GPP consequential-action binding authoritative. No new permission engine, mega-tool, standing grant, global enforcement switch or paired-production write belongs to this work.

The first refusal-loop correction is BI-PIR-d2257424 and is delivered. Existing BI-69415B68 owns GPP mediation and permits; BI-6DA17863 owns notation/compiler binding attachment; BI-43C3E914 owns stage tool declarations; BI-C8EC05C9 owns approval-envelope convergence; BI-D37B2C13 owns behavior-preserving Build Studio shape compilation. Reconcile their actual delivered behavior before changing it. The existing [compiler Phase 3 plan](../plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md) already assigns binding attachment and emitted records to BI-6DA17863 coordinated with BI-69415B68; this design consumes that contract rather than opening a parallel permit implementation.

## Design grounding

- `work-management/room-turn-authority.ts` and its server loader own room narrowing and action boundaries.
- Work-shape stage declarations and GPP binding resolution own stage identity and required capabilities.
- `actions/coworker-tool-budget.ts` owns required/core/role ranking and count ceilings.
- `tak/context-economy-metrics.ts` already estimates the serialized provider tool payload. Reuse it rather than adding a second estimator; estimated tokens remain labeled estimates.
- `tak/autonomous-work-run.ts` currently slices required names to four and restores the full authorized catalog on budget exceptions. Replace silent loss and unbounded recovery with an explicit admission result in the existing execution outcome path.
- The four-name limit is also a declared compatibility constraint: `work-management/stage-tool-parity.test.ts` verifies stage tools plus the evidence writer fit `REQUIRED_TOOL_PIN_CAPACITY`. Do not claim current supported stages lose a fifth tool without an executed reproduction. Preserve existing declarations and bindings; any expansion must change their common contract deliberately. The proven source fallback to the full authorized catalog is a separate budget-boundary concern.
- `govern/authority/governed-rejection-disposition.ts` owns refusal, input, approval and inconclusive classification.
- `CoworkerActionEnvelope` and `CoworkerEnvelopeApproval` own human consent and its durable result. The handover renderer already separates consequence copy from technical details.
- `portfolio/investment-read-model.ts`, `investment-points.ts` and `platform-dev-policy.ts` own attribution, points, unknown sizing and funding-specific planning targets.

## Objectives

**OBJ-EXECUTION:** Coworkers can complete authorized stage work with a bounded, sufficient tool surface.

**OBJ-AUTHORITY:** Efficiency changes preserve current authority intersection, revocation, exact consequential binding and audit evidence.

**OBJ-HUMAN:** A person understands the work, consequence and validity of an approval without interpreting tool or grant identifiers.

**OBJ-INVESTMENT:** Cross-thread investment is visible once per canonical item with honest coverage, classification and outcome reporting.

**OBJ-RECOVERY:** Refusals, unavailable infrastructure and pending human decisions have distinct bounded recovery paths.

| Acceptance | Objective | Observable result |
| --- | --- | --- |
| AC-ATTACH | OBJ-EXECUTION | Every admitted stage attaches all authorized required tools within its count and schema budget; deferred tools remain discoverable. Missing, over-cap and unknown required sets return an explicit held outcome before inference. |
| AC-BOUND | OBJ-EXECUTION | A budget exception cannot replace the admitted surface with the full catalog. Unknown budget state is inconclusive and does not widen attachment or authority. |
| AC-AUTH | OBJ-AUTHORITY | Revoked grants, removed membership, expired bindings and changed consequential parameters are refused at execution even if a prior attachment or approval existed. |
| AC-REFUSAL | OBJ-RECOVERY | Same-turn settled refusal attempts are bounded; subsequent runs park unchanged blocked work and wake on an appropriate authority, evidence, stage or routing revision. Pending and inconclusive outcomes do not become refusal. |
| AC-CLOSE | OBJ-RECOVERY | A linked Workroom consumes the same bound delivery shape and valid completion basis as its item. Closing a correctly accepted small item does not introduce unrelated generic plan/baseline gates. Changed scope, invalid evidence and failed gates remain held. |
| AC-HUMAN | OBJ-HUMAN | Approval first view states the outcome, affected scope, consequence and expiry. Technical identities and receipt lineage are available under details. Authorization, execution and completion remain separate states. |
| AC-ACCESS | OBJ-HUMAN | Keyboard, screen-reader status, mobile layout and light/dark theme verification pass on the served target. |
| AC-COUNT | OBJ-INVESTMENT | Canonical item resolution prevents duplicate planning points across workrooms, commits, PRs and executor chats. Unique usage events count all real contributor calls once. Planned, active and delivered points remain separate from token usage. |
| AC-UNKNOWN | OBJ-INVESTMENT | Unsized or unclassified items remain visible. A zero denominator displays unavailable; points and estimates are never labeled actual labor. |
| AC-TARGET | OBJ-INVESTMENT | Target comes from recorded funding owner and work purpose. Founder shared-platform scope uses its 80/20 policy; organization work retains its own policy. Unknown scope displays no invented target. |
| AC-OUTCOME | OBJ-EXECUTION | Compare stage completion, unchanged refusals, provider-attached schema payload, elapsed time and human steps against a named baseline. Catalog-byte reduction alone is not a cost claim. |

## Projection and admission

Resolve the current workroom and stage through existing canonical loaders. Carry the stage/version, actor, subject and authority revision already present in GPP/TAK. Use its required tools to drive the existing budget selector; do not derive permissions from prompt text. Authority still intersects at each governed execution.

Current source is not yet a complete stage-permit implementation. `gpp/permit-mint.ts` leaves `stageKey`, `actorGaid` and `subjectScope` null in shadow claims. `gpp/stage-permit-revocation.ts` explicitly states that no stage permits are minted, so its rework revocation hook currently has nothing to revoke. Reconcile the binding-attach deliverable with the existing GPP owner before claiming contextual stage approval works. A completed gate must resolve its approved shape/stage, actor, subject and revision through those canonical bindings, with later rework/revocation invalidating the scope. Reuse this substrate and the shared execution check; do not substitute temporary standing-grant mutations. No enforcement promotion is authorized by an attachment or UI change.

Attachment is an optimization, not permission. Validate the complete required set before slicing. Count and schema budgets are separate constraints. Required names must exist and be authorized, and the stage must fit the selected model's measured selection ceiling. Reserve discovery capacity when deferred tools exist. A stage too large for a model receives a typed admission result; routing may select an already eligible model or return the existing blocked/inconclusive outcome. It never drops the writer to make the numbers fit.

Reuse actual serialized provider-format definitions for measurement. Preserve deterministic order to support caching. Keep raw UTF-8 schema bytes, estimated definition tokens and provider-reported token usage distinct. A failed serialization is unavailable evidence, not a zero-cost surface.

Use the existing disposition and TaskRun/workroom status projection for refusal parking. Identify the blocked stage, reason and relevant context revision, then suppress unchanged retries. Do not add an independent scheduler or status vocabulary. A grant update does not imply admission; revalidate all terms at wake and execution. Irrelevant changes must not restart the loop.

## Human approval experience

Reuse the existing decision projection and handover presentation pattern across approval kinds. First view answers: what will happen, what it affects, what needs this person's judgment, and when the scope ends. Place grant names, tool names, IDs, raw proposed parameters and receipt lineage in accessible details unless an exact field is necessary to understand the consequence.

Use the existing action endpoints and approval state machine. One approval card sends one decision; uncertain acknowledgement reads the recorded result and never replays a consequential action. Revocation or expiry must appear as a truthful closed/held outcome. A missing coworker grant routes to platform recovery or an eligible peer; a person is not asked to choose a grant name.

Suggested first view: a short outcome heading, two or three concrete consequence facts, scope/expiry, primary approval and secondary decline. Expandable details follow. Do not hide a consequential destination, amount or irreversible effect under details merely because it is technical.

## Investment roll-up

Canonical metric owner: BI-0ACB97B5 and its existing owner-scoped investment design. BI-737839B9 was duplicate intake and is not a second implementation owner. Extend the existing design after verifying its current immutable artifact and delivery state. Existing recorded founder direction counts ordinary bug repair with refactoring; retain classification provenance and allow the budget owner's explicit policy to govern exceptions.

The founder's cumulative token-use target and relative investment-point planning share are separate ledgers. Reuse `portfolio/ai-resource.ts`, the token/phase-run ledgers and canonical Workroom attribution to report recorded token mix and untraced/unknown usage. External client usage with no trusted recorded attribution remains unknown. Do not convert points to tokens or compare a point-weighted percentage to a token-use target as though it were the same measure.

For actual usage, deduplicate the same recorded inference/usage event by its authoritative identity, while retaining every real contributing call. Two chats that each spend tokens on one BI both count toward actual usage; a second receipt or umbrella attribution for the same call does not count it again. Canonical-BI deduplication applies to the planning-point ledger and does not erase real resource consumption.

Extend the existing portfolio read model with canonical initiative membership and work classification. Count a BI once, regardless of how many contributing chats, rooms or PRs it has. An umbrella and its independently delivered children must not both contribute the same points.

Use existing investment points with their provenance (`agreed`, `estimate`, `size-default`, `unsized`). Label the metric as investment-point-weighted share, not elapsed effort. Separately expose explicitly estimated/agreed coverage so the owner can assess reliance on size defaults. No conversion to hours, tokens or money is implied.

The numerator uses the existing budget owner's recorded classification policy. BI-0ACB97B5 records founder direction that ordinary bug repair counts with refactoring; retain that provenance, and record any exceptions. Do not invent a classification for unknown work or another owner's chores. Report narrow `workType=refactor` share separately when broader policy is unresolved. Scope membership, target policy and delivery/acceptance basis must be explicit. Display target, measured share, coverage, unknowns and outcome trends with attribution in drill-down.

No schema migration is assumed. First prove which existing relations and evidence can supply each fact. Any missing persistent field requires a data-impact review and a justified extension of the existing model.

## Observed installation baseline

A governed read-only query on 2026-10-13 UTC over the rolling prior 24 hours returned 891 ToolExecution rows with `success=false`: 314 carried `approval_required`, 11 carried one of `authority_denied`, `forbidden_grant` or `forbidden_capability`, 765 lacked a TaskRun link, and none carried input/output token metering on the tool row. These are response counts, not distinct people, approvals, retries or paid inference calls. An earlier adjacent sample returned 313 approval-required responses; the rolling live dataset changed between reads. Missing TaskRun links can be legitimate external calls and are not by themselves a defect. This snapshot does not establish the cause of the recorded outcomes or a savings estimate. A comparable post-change measurement must bind its period, install, served version, outcome semantics and attribution coverage.

## Scale and consistency

For tool admission, resolve one stage's required set against the existing catalog index, cache only immutable schema-cost facts by definition digest, and keep grant/context evaluation current. Do not rebuild every coworker's complete inventory on every scheduling tick. An oversized stage is explicitly held or decomposed, never silently truncated. Record the tested catalog/stage/model ceilings in each delivery receipt; an untested ceiling remains unknown rather than a claimed platform limit.

For investment overview, extend the existing attribution logic with server-side aggregate queries over the initiative and reporting period. The human overview returns aggregate rows and coverage counts, not every backlog record. Attribution details use cursor pagination with stable ordering and an explicit total/continuation. Test a fixture beyond a single page and concurrent status changes; define whether a traversal uses a stable snapshot or reports changed membership. No silent `take` limit or copied per-thread ledger is allowed. EP-B932453F owns this modernization's measured ceiling and any subsequent lift; the portfolio budget owner remains accountable for its canonical read model.

Per-item classification and funding/target facts keep one authoritative home. Snapshot fields in receipts are immutable evidence of an evaluated revision, not a writable replacement for current authority. State the current-versus-as-of semantics on every roll-up. Accepted work is counted only under the chosen recorded delivery/acceptance basis, and a changed classification or scope must produce a visibly revised projection.

## Research & Benchmarking

The compared representations are concrete: MCP defines named tools with input/output JSON schemas; OPA's partial evaluation separates known actor/budget inputs from unresolved data constraints; BMAD's ticket entry and plan frontmatter carry dependencies, status, immutable intent, baseline revision and blocked reason. These are interoperability and reasoning patterns. DPF retains PostgreSQL workrooms and its own author/reviewer principals rather than adopting file-based ticket state or a second policy service.

| Comparator | Pattern adopted | Pattern rejected or bounded |
| --- | --- | --- |
| [MCP tools specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx) | Deterministic authorized discovery and standard list-change signaling. | Do not assume per-connection mutation or host refresh behavior is compatible with every negotiated revision. Preserve the governed supported-version contract. |
| [OPA partial evaluation](https://www.openpolicyagent.org/docs/filtering/partial-evaluation) | Derive a projection from known policy/context while retaining unresolved conditions for execution. | No new OPA service, dependency or second grant engine. |
| [BMAD autonomous development](https://docs.bmad-method.org/build/autonomous-development-loops/) and [review](https://docs.bmad-method.org/build/review-a-change/) | Bounded units, explicit inputs, independent review and evidence-preserving halted outcomes. | No dependency on BMAD workflows or duplicated lifecycle/approval vocabulary. DPF workrooms retain durable authority. |
| [Microsoft Copilot Studio authentication](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-enduser-authentication) | Explicit actor authentication for tool use and separation of user versus supplied credentials. | A saved credential is not contextual action authorization; no operator-managed credential plumbing in normal DPF flow. |
| [Amazon Bedrock confirmation](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-userconfirmation.html) | Consequential function invocation can require an explicit human confirmation. | A blanket confirmation flag is insufficient for DPF stage/subject/version/revocation binding. Preserve the existing richer envelope and exact-call controls. |

These are design comparators, not proposed installations or procurement recommendations. Check the effective supported MCP revision before changing discovery semantics.

## Delivery and verification sequence

1. Preserve delivered BI-PIR-d2257424 through its existing small-delivery path: PR #6259 merged as 647162a6e5b75a79e2930cc50dff656c64aff5e8, and the governed completion gate accepted its source/build/test and failing-to-passing evidence. Live observation still awaits a containing release.
2. Reconcile delivered stage declarations, mediation and approval convergence with their owners; record actual remaining gaps.
3. Record decomposition coverage for the live independent deliverables: BI-8E7F0276 attachment admission/measurement, BI-412A2F72 cross-run refusal parking, BI-038AA4BC approval presentation, existing BI-B8D36C62 proportional room closeout, and existing BI-0ACB97B5 investment roll-up. BI-PIR-d2257424 is the delivered refusal-loop correction. Reconcile the legacy owner's design and workroom before any overlapping edits.
4. Independently review the canonical design and obtain its scope baseline; record plan coverage and dependencies before implementation.
5. For each slice, reproduce the current defect or validate existing behavior, refactor the shared owner, run targeted verification, obtain exact-change review, publish through the protected PR/merge queue, and verify the served target after canonical advance.
6. Promote named GPP enforcement bindings only under their existing owner and evidence contract. This design does not change global enforcement mode.

## Risks, compatibility and rollback

Required-tool admission may reveal stages that were previously running with an incomplete surface; report these as explicit held work rather than silently broadening grants. Preserve backward-compatible projections for unroomed and undeclared stages while their own authority checks remain in force.

Approval presentation must preserve exact consequential facts. Investment reporting must not reward arbitrary ticket splitting or count unaccepted/untraced work as delivered. Cross-run parking must not strand work after a legitimate change or wake on an unrelated revision.

Roll back a projection or renderer through a protected source PR. Existing authorization, audit and evidence records remain intact. In-flight envelopes retain their original immutable binding; no rewrite or synthesized approval is permitted. Runtime advances use the canonical self-upgrade path.

## Current delivery reconciliation, 2026-11-02

This draft was refreshed against source main 49d845230041e48237968659a5a72d0c41e86322 after preserving and rebasing its single unpublished design commit. Its old documentation gate and failed review are historical evidence, not current approval.

- BI-PIR-d2257424 is delivered through PR #6259 and remains closed.
- BI-0ACB97B5 is delivered and closed. The existing [investment allocation guide](../../user-guide/investment-allocation.md) and its owner-scoped implementation supply the cumulative allocation and honest usage coverage. Do not build another metric or infer funding from the administrator or installation.
- Approval presentation has overlapping delivered implementation in PRs #6659, #6751 and #6812. The current card leads with a readable target, description, consequence and recommendation, with technical evidence under disclosure. Reconcile BI-038AA4BC against that delivery and its tests before changing the renderer.
- BI-8E7F0276 remains an implementation gap: the general autonomous tool-budget path still truncates pinned names and falls back to the full authorized catalog when budgeting fails. Preserve the newer exact restricted-review and engagement surfaces while correcting that general path.
- BI-412A2F72 remains the scheduled-refusal recovery owner. Confirm current TaskRun and scheduler behavior before changing persistence or wake rules.
- BI-B8D36C62 remains the proportional Workroom completion owner. The current transition still calls the generic item projection without the room's bound shape. Coordinate receipt reuse with BI-9C018CEB; do not bypass the completion guard.

The GPP mint still leaves stage/actor/subject shadow fields unbound. Existing binding-attach ownership and promotion prerequisites remain authoritative. This design does not promote enforcement.

The remaining implementation appetite is one independently reviewable delivery per unresolved slice. Existing delivered work is reconciled once, not repeated to satisfy this initiative. Current canonical scope approval, decomposition coverage and child gates are required before implementation.

## Status

Canonical draft awaiting independent spec approval and live decomposition coverage. No new metric writer, UI rollout or live efficiency improvement is claimed. The first repair at da51395c715cbb6aa47c258d8229bbb6dcfa285e has canonical local-CI PASS cmv66dkn105x101o7ndislors (4,110 tests), independent semantic PASS cmv66mmea0cae01o7a1s14q1l and research receipt initiative-60f336b4-c1ec-4956-aedc-e1456dd2bd61. PR #6259 passed all 42 checks and merged as 647162a6e5b75a79e2930cc50dff656c64aff5e8; DPF's completion gate accepted source/build/test and failing-to-passing acceptance evidence and closed BI-PIR-d2257424. The current release does not contain it yet, so live observation remains pending. DPF executed the approved retirement of duplicate BI-737839B9; BI-0ACB97B5 remains the metric owner.
