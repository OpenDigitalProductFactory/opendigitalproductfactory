---
status: draft
---

# Typed Workroom traversal implementation plan

BI-3CE72645; WC-15C18FED. Delivery shape: delivery-medium@1.0.0.
Design: [typed traversal](../specs/2026-09-07-typed-workroom-pagination-design.md).
All deliverables below belong to this existing BI. No additional work hierarchy
is needed. This draft is not an implementation-readiness or plan-review receipt.

The single deliverable, `typed-workroom-traversal`, implements contract
`CT-MCP-PAGE` through flow `list_workrooms -> typed continuation -> get_workroom`.
It covers baseline objectives `OBJ-PAGE-COMPLETE`, `OBJ-PAGE-TYPED`,
`OBJ-PAGE-SAFE` and `OBJ-PAGE-SHARED`. Verification binds `AC-PAGE-1`,
`AC-PAGE-2`, `AC-PAGE-3`, `AC-PAGE-4`, `AC-PAGE-5` and `AC-PAGE-6` from the
design. Snapshot construction, projection and transport must ship together:
shipping only one leaves incomplete enumeration or unusable continuation.

## 1. Resolve the bounded observation contract

- Complete the independent architecture review of the exact published design
  revision bound to WC-15C18FED, including the measured-sizing amendment below.
  The former 793a074 revision is superseded; do not reuse its review identity.
  Address concrete findings and obtain
  applicable design/baseline evidence through the returned reviewer route.
- Confirm deployment behavior: canonical Compose exposes one portal; Dockerfile
  runner executes `node apps/web/server.js`. Prove the actual continuation path
  shares observation state in this supported runtime. Multiple workers must
  produce an explicit unsupported/restart outcome, never cross-authority data.
- Trace the actual `ToolExecutionContext` and `UserContext` grant path. Pass the
  trusted identity into both current and legacy list handlers. Reuse the existing
  capability/grant intersection and bind the normalized effective authority.
- Use serialized adversarial fixtures to select a default requested page size,
  minimum supported cap and per-row bound. Validate the proposed cache budgets
  against the actual Workroom population. Finalize these values before code.
  The design now records 432 observed rooms and a 163,342-byte compact fixture;
  five representative rows fit the native 4,000-character cap while ten do not.
  This narrows sizing work but does not replace actual transport or Unicode tests.

Evidence: design review, authority/deployment source references, fixed fixture
sizes, live population count and revised design if needed. Covers AC-PAGE-4/5.

## 2. Refactor selection and projection with failing behavior tests

- Trace existing consumers of `loadCapsuleLivenessInventory` and the handler.
  Separate bounded database selection from shared liveness/recovery projection
  and summary aggregation. Keep one definition of each rule.
- Add a regression with more than 100 rooms and a stale match beyond the old
  cutoff. Add tied ordering and concurrent mutation fixtures demonstrating why
  ordinary mutable keyset pagination cannot satisfy fixed membership.
- Introduce the approved bounded observation store and cursor adapter. Acquire
  one short read-only Repeatable Read observation, apply filters, calculate the
  authoritative population and end the transaction before returning a page.
- Test TTL, duplicate page replay, eviction, total and per-principal capacity,
  construction failure, invalid signature and authority changes.

Evidence: RED output before implementation, GREEN focused suites, real PostgreSQL
observation test under the shared nonproduction lease. Covers AC-PAGE-1/2/4/5.

## 3. Preserve typed pages through the actual transport

- Extend the existing tool schema with optional continuation; retain its name,
  grants, legacy alias and compatible result keys. State counts' scopes.
- Project compact rows with explicit shortened-field markers and a stable detail
  route. Size the entire serialized page, retain whole rows, and emit a minimal
  typed ID record for an oversized individual row.
- Integrate the page contract with native and external model-facing budgeting.
  Preserve matching text and structured forms. Do not bypass context masking,
  raise the global cap or depend on host disk persistence.
- Test the actual pack handler and transport composition, not only the page
  helper: special characters, long fields, empty final page, cursor survival and
  caps too small for the minimum valid envelope.

Evidence: boundary regressions and relevant native/external consumer suites.
Covers AC-PAGE-2/3/6. Refactoring allocation is the shared projection and budget
integration in phases 2/3, approximately one fifth of implementation effort.

## 4. Protected delivery and served traversal

- Run changed and graph-linked suites, workspace typecheck, applicable guards,
  exact-tree local gate and exact-artifact review. Record an unavailable gate as
  unrun/inconclusive; use only an applicable checked-in operator override.
- Open one ready DCO-signed PR and pass protected PR and merge-group checks.
- Publish via the canonical Docker workflow and install through normal
  `/ops/self-upgrade`. Require actual served image identity before acceptance.
- Traverse the observed population through supported Codex, Claude Code and
  generic MCP consumers. Record each client's version, negotiated protocol,
  source SHA and tier, exact IDs/counts, sizes and expiry behavior. Read any
  alleged persisted content back before claiming preservation.
- Record runtime verification and close the BI only when the acceptance bullets
  pass. Retain a concrete incomplete result for unavailable client verification.

Evidence: protected merge, canonical image digest, completed normal upgrade,
runtime receipt and real traversal results. Covers AC-PAGE-1 through AC-PAGE-6.

## Recovery boundaries

Keep failed snapshots and expired cursors read-only and finite. Rebuild a new
observation with the same explicit filters; do not silently concatenate it with
an older observation. If multi-worker behavior invalidates the chosen storage
design, return to that one architectural decision with measured evidence rather
than adding persistence ad hoc. Changes to authority, lifecycle or unrelated
listing tools are outside this slice.
