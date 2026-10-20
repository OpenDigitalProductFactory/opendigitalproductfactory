# Commons exchange extraction

Owner: @markdbodman. Backlog: BI-0D316824. Workroom: WC-13E26FCD.
Base: 4fa796b64425b6129f172a01b89d8c8887c065fc, incorporating current main ee1e80b0a46b893beea11b928cfe621849730ad4 and the frozen three-component checkpoint 4faccd852a49bba58e40ad7146f3d9c585874cf0.

## Authority and coverage

This is the HX-01 slice of the existing reusable-component extraction map and sequence. The operator explicitly allowed local implementation and independent Codex review with native review and plan-coverage gates unrun. This document is local and unpublished. Coordination records alone may change on the production connector. No release, database migration, production invocation, credential or grant change is included. Native coverage is unrun, not passed. One canonical ledger, configured forge adapter and human review owner remain in DPF.

## Source grounding

Read the existing Hive architecture and egress spec, finding-contribution rules/store, result projection/intake/store, contribution delivery/pack, review actions and HiveContributionLedger schema. The source already separates submitted, accepted and transport-delivered axes in its view. It has no durable exact-target review receipt or uncertain-effect reservation field. Incoming `review` payload is untrusted material and cannot confer permission. A failed PR nevertheless marks findings and a pack contributed: this is a measured defect to cover with a failing test before repair.

## Implementation sequence

1. Characterize finding decisions, projection, sorted JSON hashing and delivery retry behavior with existing six suites (50 tests passed before edits). Resolve all seven graph-linked impact entries; delivery has no linked tests, so add focused mocked-store regressions and run pack plus result-store suites. Keep legacy SHA-256 bytes, receipt prefixes and source-local key rejection.
2. Move finding rules, result-only projection and bounded intake into `@dpf/validators/commons`, with a Node digest adapter and a browser-safe injected digest entry. Replace real DPF imports and remove displaced implementations; retain old import bridges only for verified remaining callers, with owner, BI and removal condition. Reuse the bounded JSON leaf extracted by operating-composition rather than creating a second validator.
3. Add a small versioned exact-content exchange intent contract. A private candidate includes scoped source provenance, a payload fingerprint, destination and revision; independent human review must bind all of them. Current authority, revocation, expiry, cancellation, duplicate/conflicting receipts and uncertain effects hold emission. The component returns intents, never writes or sends. A narrow trusted host port owns the durable transition and transport; a synthetic consumer demonstrates this boundary. This is a qualification fixture, not production enforcement or a replacement approval database.
4. Repair false contributed statuses only after their regressions fail against the baseline. An actual PR receipt is required. Keep current permissions, DCO, source selection, build reconciliation and transaction owner. Do not broaden the existing ship tool's authority or invent Workroom command paths.
5. Run affected suites and package/application typechecks, style and module guards. Build an isolated NodeNext consumer from its exact source closure without booting DPF. Record provenance, licenses, dependency disposition, migration/rollback, absorption alternatives, and independent source review. Integrate with the other completed local slices before reporting completion.

## Supported and unavailable behavior

Supported: current finding plans/outcomes; result-only projection and intake; opaque receipt validation, deterministic legacy hashes, existing ledger duplicate/conflict handling, explicit exact-content review/egress intents in a portable reference host, and truthful transport completion in DPF. Private/mixed disposition requires an affirmative trusted host classification; field-name filtering alone does not establish privacy.

Unavailable: production exact-content/destination approval persistence, durable effect reservations and exactly-once transport, full governed adoption, complete Commons curation or standards conformance, and replacing the FeatureBuild-only ship source. These require the owning Workroom/approval/store adapters and remain held in the portable contract when absent. No inbound review assertion becomes authority. No company corpus is copied.

## Verification and rollback

Gate-context is resolved for the claimed files; design grounding applies to the pack; its module must shrink or retain its baseline size. Run style drift guard and derived-artifact checks as applicable. Source-local proof is separate from unrun served runtime, native plan/review, shared build, upstream acceptance and DPF2 acceptance. No database/runtime change is required for rollback: revert the local source slice and its caller imports together. Existing stored fingerprints and opaque source receipts remain compatible.
