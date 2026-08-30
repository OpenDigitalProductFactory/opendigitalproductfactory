---
status: draft
---

# Backlog design-before-build coupling

**Backlog:** BI-078A5E68  
**Epic:** EP-413F2602  
**Workroom:** WC-03910795

## 1. Problem

DPF correctly requires a live BacklogItem before a plan, but it does not preserve the next half of that contract. `create_backlog_item` can create `open/build` work directly, `triage_backlog_item` can move raw demand to `open/build`, and the filing skill explicitly permits same-flow build triage while treating a spec link as optional. Canonical-design readiness is evaluated later, at plan or implementation entry.

That ordering creates executable backlog without durable intent. The 2026-08-30 security/authentication assessment exposed the gap when six successor BIs were filed `open/build` before their shared design was authored. The design was recovered in PR #4878, but the workflow still allows the same drift.

The correct order is not “design before a BI exists”: the design needs a real BI id to cite, and raw demand must remain capturable during outages or early discovery. The correct order is:

```text
verify overlap
  -> create BI in triaging
  -> author + PR canonical design when the readiness profile requires it
  -> verify the merged design path covers the BI
  -> triage to open/build
  -> approve design / baseline objectives
  -> write and cover the implementation plan
  -> implement
```

## 2. Objectives

**OBJ-BDC-001:** Preserve raw intake by allowing every valid demand item to receive a durable BI identity in `triaging` before design work begins.

**OBJ-BDC-002:** Prevent feature, cross-domain, and archetype demand from entering `open/build` until one explicit canonical design path under `docs/superpowers/specs/` exists, is available to the authoritative corpus, and references the live BI.

**OBJ-BDC-003:** Make the normal filing workflow create or locate that design immediately, PR it, verify discovery, and only then perform build triage.

**OBJ-BDC-004:** Preserve proportional governance for fix and doc-only work and for non-build outcomes while failing closed when the readiness profile or design corpus cannot be determined.

**OBJ-BDC-005:** Keep the design reference provider-verifiable, auditable, actionable, and single-source without adding a parallel design table or duplicating initiative-readiness policy.

## 3. Research and benchmarking

- [Backstage TechDocs](https://backstage.io/docs/features/techdocs/creating-and-publishing/) keeps documentation with code and completes the workflow by committing, opening a pull request, and merging. Its catalog uses explicit annotations to bind an entity to its documentation source. DPF adopts the explicit, repository-verifiable artifact reference and PR preservation pattern; it rejects making a derived catalog cache the source of truth.
- [OpenProject work packages](https://www.openproject.org/docs/user-guide/work-packages/) separate stable work identity/type from lifecycle status, while its workflows constrain which role may make which status transition. DPF adopts the distinction between raw identity creation and a governed executable-state transition.
- [Plane](https://docs.plane.so/) places work items, project planning, pages, and wikis in one connected workspace. DPF adopts discoverability between work and knowledge, but rejects an informal page link as sufficient evidence: the transition must validate an immutable repository path and BI reference.

DPF already has the stronger pieces: PostgreSQL BacklogItem identity, repository spec/plan discovery, authoritative readiness profiles, initiative design review, objective baselines, plan coverage, and Workroom evidence. This design connects those pieces rather than creating another artifact model.

## 4. Decisions

### 4.1 Raw intake remains design-free

`create_backlog_item` continues to default to `triaging`. A title, classification, problem/scope/acceptance body, provenance, and proposed outcome are sufficient to capture raw demand. A canonical design cannot be required at this boundary because its own content must cite the server-issued BI id.

### 4.2 Direct build creation is closed

The combined shortcut `status=open|in-progress` plus `triageOutcome=build` is refused. Build demand must enter through `triaging` and leave through `triage_backlog_item`, which provides the auditable design-aware transition.

Non-build outcomes retain their current direct or triage behavior. This change does not turn runbooks, coworker tasks, deferrals, duplicates, or discarded demand into product-design initiatives.

### 4.3 The build transition carries an explicit design path

For readiness profiles `feature`, `cross-domain`, and `archetype`, `triage_backlog_item(outcome=build)` requires `designPath`. The value must:

1. be a normalized repository-relative path under `docs/superpowers/specs/`;
2. resolve inside the authoritative spec corpus without traversal or alternate-root ambiguity;
3. point to a Markdown spec whose status is not `superseded`;
4. contain the exact live BI id as a parsed backlog reference;
5. be persisted in the transition activity payload with the validated path and source-root identity.

The caller selects the design deliberately. Search results may contain assessments, successor maps, or historical mentions, so “first file mentioning this BI” is not a canonicality rule. An explicit path plus validation is.

### 4.4 Proportional profiles stay proportional

- `doc-only`: no product design is required for build triage; current documentation readiness applies.
- `fix`: research remains the plan-stage requirement; a full feature design is not added by this change.
- `feature`, `cross-domain`, `archetype`: validated canonical design is required for build triage.
- unknown/unclassified readiness profile: refuse build triage with a classification action. Do not silently project unknown work to `doc-only`.

BI-2645F53F separately owns the missing readiness-profile mapping for chore, tool, skill, and refactor work. This design does not choose those mappings; it prevents an unknown profile from becoming an accidental governance bypass.

### 4.5 Corpus absence is not design absence

The validator returns three distinct outcomes:

- `covered`: the path and BI reference validate;
- `not-covered`: the corpus is available but the path is invalid, missing, superseded, or does not reference the BI;
- `unavailable`: the authoritative corpus is absent or unreadable.

`not-covered` and `unavailable` both refuse build triage, but the message differs. An unavailable consumer/runtime-host corpus tells the caller to perform triage from a source-capable host after the design merges; it never claims no design exists.

### 4.6 Initiative readiness remains authoritative after triage

Design coverage at triage proves durable intent exists. It does not approve that intent. Feature and stronger profiles still require independent spec approval, objective baseline, plan, plan review, and plan coverage before implementation. The new check moves the minimum artifact boundary earlier without weakening later evidence gates.

## 5. Component design

### 5.1 Canonical validator

Add a shared resolver beside `spec-plan-search.ts`:

```ts
validateBacklogDesignCoverage({ itemId, designPath })
  -> { status: "covered", artifact }
   | { status: "not-covered", code, nextAction }
   | { status: "unavailable", code, nextAction }
```

It reuses the existing repository-root and corpus-status logic. Path normalization and file parsing live there once; MCP handlers and future UI transitions consume the result.

### 5.2 Ingest boundary

`validateIngestInput` refuses only the direct `triageOutcome=build` shortcut when status is not `triaging`. The error says to create the BI in triaging, merge its canonical design, then call `triage_backlog_item` with `designPath`.

This pure validation stays free of repository I/O. The design-aware operation is the asynchronous triage handler, after the BI id exists.

### 5.3 Triage boundary

Before updating a build outcome, the handler:

1. loads the item and derives its authoritative readiness profile using the existing profile projector;
2. refuses an unknown profile;
3. for feature-or-stronger profiles, validates `designPath` through the canonical resolver;
4. performs the status update and records a `status_change` activity transactionally, including rationale, effort, readiness profile, and validated design artifact;
5. returns a stable actionable error without changing the item when validation fails.

### 5.4 Skill and runbook behavior

`dpf-file-backlog-item` changes from “optionally triage in the same flow” to:

- capture every item in `triaging` by default;
- if proposed build work derives feature-or-stronger readiness, author or locate the canonical design immediately;
- commit, push, and PR the design using the normal governed delivery procedure;
- after the design is merged/discoverable, call build triage with its exact path;
- then hand off to `dpf-writing-plans`.

`dpf-writing-plans` refuses to begin a feature-or-stronger plan when the BI lacks a discoverable canonical design and independent spec approval. The backlog/planning runbook states the same single order.

## 6. Failure and recovery

| Failure | Result | Recovery |
|---|---|---|
| Direct create as `open/build` | Refuse before persistence | Recreate request as `triaging`; use returned BI id in the design. |
| Missing `designPath` | Leave BI triaging | Author/merge a canonical spec, then retry with its path. |
| Path traversal or outside specs | Refuse as invalid path | Supply the repository-relative canonical spec path. |
| Corpus unavailable | Refuse without claiming absence | Retry from the source-capable host after corpus availability is restored. |
| Spec missing BI id | Refuse as not covered | Add the live BI reference through a PR, merge, and retry. |
| Superseded spec | Refuse and name replacement need | Use the active successor design path. |
| Unknown readiness profile | Refuse as classification required | Complete profile mapping/classification; do not default to doc-only. |
| Design rejected later | BI may remain open but cannot enter implementation | Repair/re-review the design; readiness remains input-required/denied. |

No repair updates PostgreSQL directly or weakens readiness. The failed transition is a no-op.

## 7. Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-BDC-001 | OBJ-BDC-001 | A valid feature request can be created in `triaging` without a pre-existing design and receives a stable BI id. |
| AC-BDC-002 | OBJ-BDC-002 | Direct creation as `open/build` is refused with the create-design-then-triage next action. |
| AC-BDC-003 | OBJ-BDC-002, OBJ-BDC-005 | Feature-or-stronger build triage succeeds only when the explicit normalized active spec path exists in the authoritative corpus and references the exact BI. |
| AC-BDC-004 | OBJ-BDC-004 | Missing, invalid, superseded, non-covering, unavailable-corpus, and unknown-profile cases leave the BI in `triaging` and return distinct actionable errors. |
| AC-BDC-005 | OBJ-BDC-004 | Fix, doc-only, and non-build outcomes retain their proportional existing contracts. |
| AC-BDC-006 | OBJ-BDC-005 | The successful transition records profile and validated design artifact in audit activity without adding a design table or duplicating readiness policy. |
| AC-BDC-007 | OBJ-BDC-003 | Filing/planning skills and the backlog runbook encode one order: BI identity -> canonical design PR -> design discovery -> build triage -> approval/baseline -> plan. |
| AC-BDC-008 | OBJ-BDC-001, OBJ-BDC-002 | Focused tests, typecheck, production build, pregate, semantic review, and PR health pass. |

## 8. Migration and compatibility

No schema migration is required. Existing `open/build` items are not bulk-demoted because their work may be active and a blind lifecycle rewrite would destroy context. A separate reconciliation can report feature-or-stronger open items without design coverage and route them to design or retriage.

The MCP input adds optional `designPath`; it becomes required only for build outcomes whose profile requires design. Existing clients receive an actionable refusal rather than a protocol error. Non-build calls remain compatible.

## 9. Non-goals

- requiring a design before raw demand receives a BI id;
- choosing profile mappings owned by BI-2645F53F;
- auto-generating low-quality design prose from a BI body;
- treating design presence as design approval;
- moving canonical designs into PostgreSQL;
- bulk-changing existing backlog statuses;
- requiring feature-level design for bugs, docs, runbooks, coworker tasks, deferrals, duplicates, or discarded work.
