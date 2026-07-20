# Sanitized clone PostgreSQL array typing

**Backlog item:** `BI-A170C1EB`  
**Epic:** `EP-5410E8EA`  
**Work capsule:** `WC-54D95CC3`  
**Branch:** `codex/sanitized-clone-array-types`

## Outcome

Confidential-table rows copied through the sanitized clone retain each PostgreSQL array column's catalog element type. `integer[]`, `text[]`, and custom-enum arrays no longer collapse to `text[]`, while JSON/JSONB arrays keep their existing JSON serialization.

## Evidence and substrate

- The governed Contributor preview passed both repaired EA tables, then failed closed on `NonProductionEnvironmentLease.ports` with SQLSTATE `42804`: the destination expects `integer[]`, but the generic inserter emitted `text[]`.
- `getColumnTypes` already retrieves each column's `data_type` and `udt_name`; no new schema or metadata path is needed.
- PostgreSQL exposes array UDT names as `_<element-type>`. A quoted catalog-derived element identifier supports built-ins and case-sensitive custom types without interpreting the identifier as SQL syntax.

## Implementation

1. Add failing tests for text, integer, and custom-enum arrays while retaining the JSON-array regression.
2. Derive the cast from the catalog UDT, reject malformed array UDT names, quote the element identifier, and preserve the existing array-literal escaping.
3. Run the focused suite, DB typecheck, exact-SHA merged-code pregate, then rerun the full governed Contributor preview clone.

## Backlog coverage

- Decision: atomic
- Parent: `BI-A170C1EB`
- Catalog-derived casts, regression tests, exact gate, and full preview proof -> `BI-A170C1EB`
- Dependency: blocks `BI-7430E579`
- Receipt: `cmrtdowat006q01o20ae0d1ek`
- Rationale: the code and end-to-end driver/catalog proof are one correctness repair; unit-only completion would leave the real clone path unproven.

The live MCP surface does not expose `record_plan_backlog_coverage`, so the receipt was recorded through governed `record_execution_evidence` with the same decision, mapping, dependency, and rationale.

## Documentation impact

No user-guide, setup, public-site, architecture, or operations text changes. This is an internal type-preservation defect in an existing governed clone workflow; the operator-visible contract remains unchanged.

## Completion evidence

- [x] Red tests reproduce the text-array cast for integer and custom element types.
- [x] Focused tests and DB typecheck pass after the catalog-derived cast.
- [ ] Exact-SHA merged-code pregate passes.
- [ ] Full Contributor preview clone completes and `:3001/api/health` is healthy.
