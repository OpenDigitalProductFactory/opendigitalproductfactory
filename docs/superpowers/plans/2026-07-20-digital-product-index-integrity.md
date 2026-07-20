# DigitalProduct unique-index integrity repair

**Backlog item:** BI-BCF8A8D5
**Epic:** EP-4A12A7CB
**Work capsule:** WC-932D5C96
**Branch:** `codex/digital-product-integrity`

## Outcome

Every install must have one canonical `DigitalProduct.productId` row and a unique index whose physical contents agree with a forced heap scan. Existing duplicate rows and their ID-based history are retained as explicitly retired quarantine records; natural-key coworker references remain attached to the canonical product key.

## Evidence and substrate

- A forced sequential scan on the canonical install found five duplicate `productId` groups while `DigitalProduct_productId_key` reported unique, valid, ready, and live.
- The ten affected rows are field-equivalent and have no ID-based or natural-key dependents on this install. The migration must nevertheless preserve arbitrary fleet history.
- Twenty-one foreign keys reference `DigitalProduct.id`; these remain attached to a quarantined row. `CoworkerService` and `CoworkerOffer` instead reference `productId` with `ON UPDATE CASCADE`, so their constraints must be detached before quarantine renames and restored afterward.
- The defect's physical cause remains unproven. The repair must not encode a speculative cause.

## Architecture decision

Decision interaction `DI-758B3879D418` recommends deterministic quarantine with high confidence (composite 12.017, margin 0.276, no commandment conflict). It narrowly outranked a new lineage field and materially outranked destructive merge/delete. The chosen path follows the existing fleet-safety preference for quarantine over destruction without introducing a new schema concept solely for this repair.

## TDD and migration plan

1. Add a database migration fixture that begins with duplicate logical products, natural-key coworker references, ID-based history on a loser, and an untrustworthy canonical-named index.
2. Drop the two natural-key foreign keys before renaming so `ON UPDATE CASCADE` cannot move canonical references to a quarantined row.
3. Select the oldest `(createdAt, id)` row as the deterministic survivor. Rename each loser to a collision-checked `__dpf_quarantined__<id>__<original>` key and mark it `retired` / `quarantined`, preserving every other field and ID-based reference.
4. Prove by forced heap scan that no duplicate `productId` remains, then drop and recreate `DigitalProduct_productId_key` as a unique index.
5. Restore and validate the two natural-key foreign keys. Re-running the migration must be idempotent.
6. Update the MDM alignment specification, add the data-impact manifest, run migration safety/data-impact checks, targeted tests, DB typecheck, exact-SHA pregate, and governed live-install heap/index verification.

## Backlog coverage

- Decision: atomic
- Parent: `BI-BCF8A8D5`
- Fleet-safe quarantine, trustworthy unique-index rebuild, migration fixture, and live heap/index proof -> `BI-BCF8A8D5`
- Dependencies: none
- Receipt: `cmrt8pp2600yj01mu5ytndary`
- Rationale: The fleet-safe quarantine remediation, trustworthy unique-index rebuild, migration fixture, and live heap/index proof are one indivisible data-integrity correction; shipping any part without the others would leave either data or enforcement untrusted.

The live MCP surface does not yet expose `record_plan_backlog_coverage`, so this receipt was written through the governed `record_execution_evidence` path with the equivalent atomic decision and mapping after live verification of the parent BI.

## Risks and rollback

- The migration takes DDL locks while it rebuilds the index and foreign keys; normal self-upgrade quiescence owns that maintenance window.
- A pre-existing natural-key orphan would contradict the currently enforced foreign keys. Constraint restoration is `NOT VALID` followed by explicit validation so failure is attributable and no partially trusted constraint is published.
- The migration is forward-only. Rollback is the governed pre-upgrade recovery point; it must not be implemented by editing this committed migration after merge.

## Completion evidence

- [ ] Migration fixture passes and proves idempotence, reference preservation, quarantine semantics, and physical index integrity.
- [ ] Migration safety, data-impact, DB typecheck, and exact-SHA merged-code pregate pass.
- [ ] PR health is terminal/passing with zero unresolved threads and the merge queue lands the repair.
- [ ] Governed self-upgrade applies the migration; forced heap and catalog scans prove zero duplicate groups and one unique/valid/ready canonical index.
- [ ] The contributor sanitized clone and `:3001/api/health` complete after this repair and BI-CD96EDD2.
