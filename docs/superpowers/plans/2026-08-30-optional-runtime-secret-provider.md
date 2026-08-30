# Optional runtime-secret provider implementation plan

**Backlog:** BI-E7553A1C  
**Design:** `docs/superpowers/specs/2026-08-30-optional-runtime-secret-provider-design.md`  
**Workroom:** WC-9BD0CE91  
**Branch:** `feat/security-auth-1password`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Delivery boundary

This plan is atomic. The assessment/evaluation/design explain the same startup boundary the code and operator documentation implement. Shipping only the adapter would create an undocumented security-critical path; shipping only the contract would repeat the existing unimplemented-provider promise; shipping the Docker wiring without the resolver would prevent existing installs from starting. The phases below are test-first sequencing inside one deployable change, not independent product outcomes.

## Impact contract

Workroom scope claim on 2026-08-30 returned a resolved change-impact contract:

- no route, schema, migration, ratchet, or targeted-test impact was inferred;
- runtime code requires `pnpm run pregate:preflight` and an exact-tree `pnpm run pregate`;
- new docs require `pnpm docs:index`;
- CI remains authoritative.

## Phase 1—red contract tests

**Deliverable:** failing tests encode the provider, config, fetch, field, failure, redaction, and command-execution contract.

**Files:** `scripts/runtime-secret-bootstrap.test.mjs`.

**Requirements:** OBJ-RSP-001, OBJ-RSP-002, OBJ-RSP-004.  
**Contracts:** provider contract §4.1, allow-list §4.2, Connect contract §4.3–4.4.  
**Flows:** FLOW-RSP-ENV, FLOW-RSP-1P, FLOW-RSP-REFUSE.  
**Verification:** AC-RSP-001, AC-RSP-002, AC-RSP-003, AC-RSP-005.

Run the focused Node test and record the expected module-not-found/assertion failure before implementation.

## Phase 2—green provider-neutral resolver

**Deliverable:** a dependency-free Node module validates startup configuration, resolves environment or 1Password Connect values through injected seams, emits only typed/value-free errors, and spawns the supplied command with an in-memory environment.

**Files:** `scripts/runtime-secret-bootstrap.mjs`, focused test.

**Dependencies:** Phase 1.  
**Requirements:** OBJ-RSP-001, OBJ-RSP-002, OBJ-RSP-004.  
**Contracts:** §§4.1–4.5.  
**Flows:** all three flows.  
**Verification:** focused tests green, including negative matrix and a child-process execution seam.

## Phase 3—runtime and deployment wiring

**Deliverable:** the production image invokes the bootstrap before `portal-migrate-boot.sh`; compose forwards only the provider-edge configuration and no longer rejects intentionally externally supplied root values before the adapter can resolve them.

**Files:** `Dockerfile`, `docker-compose.yml`, deployment contract.

**Dependencies:** Phase 2.  
**Requirements:** OBJ-RSP-001, OBJ-RSP-003, OBJ-RSP-004.  
**Contracts:** §§4 and 6.  
**Flows:** FLOW-RSP-ENV and FLOW-RSP-REFUSE.  
**Verification:** Dockerfile/compose contract assertions, existing image-manifest checks, production build, AC-RSP-001, AC-RSP-004, AC-RSP-005.

## Phase 4—operator and security documentation

**Deliverable:** current assessment, tool evaluation, deployment doctrine, and operator runbook explain what 1Password replaces, what it does not, least privilege, startup/outage behavior, recovery, and rollback.

**Files:** security assessment/evaluation, design, deployment contract, `docs/install/security-authentication.md`.

**Dependencies:** Phases 2–3 so docs describe real names/behavior.  
**Requirements:** OBJ-RSP-003, OBJ-RSP-005.  
**Contracts:** §§6–9.  
**Flows:** FLOW-RSP-1P and FLOW-RSP-REFUSE.  
**Verification:** docs index/link guard, secret scan, AC-RSP-006.

## Phase 5—governed completion

Run focused tests, affected source-local checks, `pnpm docs:index`, production web build, `pnpm run pregate:preflight`, exact-tree `pnpm run pregate`, and independent semantic review. Commit DCO-signed, push, run `pnpm pr:ready`, open a ready non-draft PR, and update BI-E7553A1C only after evidence is accepted.

**Verification:** AC-RSP-007 and all workroom impact obligations.

## Backlog coverage

- **Decision:** atomic.
- **Parent / implementation BI:** BI-E7553A1C.
- **Deliverable mapping:** `runtime-secret-provider` → BI-E7553A1C.
- **Dependencies:** none outside the current platform substrate.
- **Rationale:** assessment, design, resolver, boot wiring, and operator contract form one security boundary and cannot be released safely in isolation.
- **Governed receipt:** pending independent spec approval and immutable plan commit; insert the returned receipt before implementation.

## Risks and rollback

| Risk | Control | Rollback |
|---|---|---|
| Existing installs fail because compose no longer rejects missing root values itself. | Default environment provider validates before migration and tests prove no network call/unchanged values. | Restore previous CMD/compose requirements; existing `.env` values remain compatible. |
| Secret appears in an error or test snapshot. | Errors carry stable category/name only; negative tests use canary values and assert absence. | Stop release, rotate the test/live value if exposure is real, repair redaction, rerun secret scan. |
| Connect outage blocks restart. | Startup-only fetch, bounded timeout, explicit refusal, documented environment rollback using the same values. | Restore same logical values through protected environment injection and select `environment`. |
| Token grants too much access. | Dedicated vault requirement, one-item fetch, no listing/writes, file token preference. | Revoke token, create dedicated vault/token, restart. |
| Operator rotates an encryption/signing root as though provider migration were rotation. | Runbook separates custody migration from value rotation and warns about session/ciphertext effects. | Restore the prior values; execute future key-lifecycle runbook rather than improvising. |

## Success evidence

Success means the environment path remains byte-semantically compatible, the Connect path resolves exactly the selected fields once before migration, every failure prevents command execution without revealing values, the production image contains and invokes the resolver, documentation is indexed, and the exact committed tree passes the governed gates.
