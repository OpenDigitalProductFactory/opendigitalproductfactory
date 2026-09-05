---
status: active
---

# Objective-mapping evidence contract implementation plan

**Backlog item:** `BI-0F8E39D5`
**Workroom:** `WC-8FB4E4D0`
**Design:** `docs/superpowers/specs/2026-09-04-objective-mapping-evidence-contract-design.md`

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
before any success claim, and `dpf-pr-with-dco` for handoff.

## Delivery boundary

This is one atomic compatibility repair. Packet construction, immutable binding,
writer-schema narrowing, transactional evidence validation, and malformed-row
correction must ship together. A partial release would leave either an
unconstrained writer or a valid writer with no governed recovery route.

No phase below is independently shippable. The repair changes no database
schema, public route, UI surface, tool name, role, or approval boundary.

## Phase 1 — exact RED fixtures

Add regressions for the live `BI-2B619BC9` shape across:

- `apps/web/lib/tak/initiative-readiness-tool-grants.test.ts`
- `apps/web/lib/mcp-task-review-contract.test.ts`
- `apps/web/lib/backlog/initiative-readiness/terminal-recovery.test.ts`
- `apps/web/lib/backlog/initiative-readiness/objective-mapping-repository.test.ts`
- `apps/web/lib/backlog/initiative-readiness/objective-reconciliation.test.ts`
- `apps/web/lib/mcp/packs/initiative-readiness-pack.test.ts`

The pre-fix tree must prove these failures:

1. the server-issued objective-mapping packet omits eligible activity IDs;
2. the writer schema accepts arbitrary source paths as evidence references;
3. persistence does not independently resolve and validate referenced evidence;
4. a malformed newest mapping becomes a terminal projection failure instead of
   an append-only correction requirement.

Retain the failing run as Workroom evidence. Do not turn existing malformed data
into a passing fixture.

## Phase 2 — bounded server packet and schema

Centralize canonical passing-evidence classification in objective
reconciliation. Load at most 500 same-item `evidence` activities at or after the
current objective baseline, reject duplicate or unbounded inventories, and sort
the eligible IDs deterministically.

Carry the finite set as `eligibleEvidenceActivityIds` in the immutable
initiative-review binding. For `objective-mapping` only:

- require a non-empty, unique, bounded list;
- show those exact IDs in the reviewer prompt;
- constrain every nested `evidenceRefs` value to the same schema enum;
- expose no objective-mapping route when no eligible evidence exists.

Historical non-mapping bindings remain parseable. Historical objective-mapping
bindings without finite evidence authority remain fail closed.

Verification: the exact four live evidence IDs are present in both packet and
schema, while empty, duplicate, foreign, or over-limit sets produce typed
refusals.

## Phase 3 — transactional writer authority

In the existing serializable writer transaction:

1. lock and resolve the target BI and current baseline;
2. require complete one-to-one coverage of every current objective and
   acceptance statement;
3. require each submitted reference to be in the server-bound eligible set;
4. reload every bound ID by exact activity ID, same BI, `kind='evidence'`, and
   post-baseline timestamp;
5. accept only canonical gate-eligible passing evidence kinds;
6. append nothing if any row is missing, foreign, stale, failing, neutral, or
   otherwise invalid.

Persist the normalized eligible set alongside a successful proposal so later
audits can reconstruct the writer authority without trusting model prose.

Verification: exact same-BI passing rows append once; source paths, missing IDs,
another BI's rows, pre-baseline rows, failed evidence, and incomplete statement
coverage append nothing.

## Phase 4 — append-only correction projection

Keep baseline-chain ambiguity and corruption as hard projection failures. For
the newest mapping row only, classify malformed mapping contents or invalid
evidence references as missing objective reconciliation rather than baseline
corruption. The row remains immutable audit history and no older mapping is used
as a substitute.

A later governed proposal with the current baseline and finite eligible set can
therefore become the newest row and reconcile normally. The correction never
updates or deletes the malformed row.

Verification: malformed-newest plus older-valid remains non-passing; appending a
new valid mapping restores reconciliation; conflicting baselines remain hard
failures.

## Phase 5 — blast radius and protected delivery

Run the focused suites plus every graph-linked TaskRun binding, submit,
execution, background, capacity, approval-resume, external-adapter, terminal
transition, and MCP handler suite. Run web typecheck, documentation index/link
validation, module-size/style/diff checks, and `pregate:preflight`.

Request the exact-tree semantic and local gates. If a shared heavy lane is
occupied, retain the operator-authorized `INCONCLUSIVE` result and compensating
deterministic evidence without inferring PASS. DCO and every protected PR and
merge-group check remain mandatory.

Publish one protected PR. After canonical release and served-SHA verification,
request a new server-issued correction packet for `BI-2B619BC9`. Live acceptance
requires its finite eligible activity IDs, a genuine writer receipt referencing
only those IDs, a newer valid mapping activity, and successful objective
reconciliation without direct database mutation.

## Risks and rollback

- Risk: a forged packet grants arbitrary evidence. Control: immutable binding,
  schema enum, and independent transactional reload of the complete bound set.
- Risk: evidence volume is silently truncated. Control: fetch cap plus one and
  return a typed refusal when the set exceeds 500.
- Risk: a malformed latest row causes fallback to stale evidence. Control: use
  newest-row semantics and return missing until a newer governed write exists.
- Risk: unrelated evidence kinds begin satisfying readiness. Control: reuse the
  canonical execution-evidence metadata and require gate-eligible pass polarity.
- Rollback: revert this source-only change. No migration is required; historical
  mappings and evidence activities remain immutable.

## Backlog coverage

- Decision: atomic
- Parent: `BI-0F8E39D5`
- Dependencies: none
- Receipt: pending the server-issued immutable plan coverage record
- Rationale: packet authority, writer validation, and correction projection form
  one fail-closed contract and have no independently useful delivery boundary.

### Four-way traceability

- Requirement refs: `OBJ-OMEC-PACKET`, `OBJ-OMEC-WRITER`,
  `OBJ-OMEC-CORRECTION`, `OBJ-OMEC-FAIL-CLOSED`.
- Contract refs: immutable objective-mapping binding, canonical execution
  evidence classification, and serializable mapping repository.
- Flow refs: terminal recovery → finite packet → narrowed writer → transactional
  append → newest-row reconciliation.
- Verification refs: `AC-OMEC-001`, `AC-OMEC-002`, `AC-OMEC-003`,
  `AC-OMEC-004`, `AC-OMEC-005`, and `AC-OMEC-006`.

## Bootstrap evidence boundary

The sole exact-key research TaskRun
`TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-3349AC083779` remained
infrastructure-stuck with no writer receipt. The operator authorized protected
bootstrap delivery of this repair after recording that result as
`INCONCLUSIVE`; no research PASS, baseline, or prose inference is claimed.
