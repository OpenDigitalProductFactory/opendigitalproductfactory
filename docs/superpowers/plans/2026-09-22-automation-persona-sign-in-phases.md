---
status: active
---

# Automation Persona Sign-In — Phased Implementation Plan

**Design:** [`docs/superpowers/specs/2026-09-03-automation-persona-sign-in-design.md`](../specs/2026-09-03-automation-persona-sign-in-design.md)
**Epic:** EP-ZERO-CONFIG-FEDERATION

> **Status: phases 1 and 2 delivered; phase 3 planned.** Phase 1 shipped in PR #5024; phase 2 shipped in PR #5640 and BI-D146D071 is done (live read 2026-09-28). Phase 3 implements the independently approved isolated-user extension in design section 6. Its tests below are requirements, not reported passes.

**Goal:** An installation operated by agents alone lets those agents open its session-gated pages in a real browser, with no person present, no password typed and no credential in a prompt.

**Architecture:** The platform seeds an automation persona and mints a one-time, short-lived signed link for itself. Exchanging that link issues the same JWT session cookie Auth.js issues after a credentials sign-in, so `auth()` reads it like any other session. The capability is bounded by environment class: a production installation refuses it unless an operator grant is recorded.

---

## Phase 1 — Mint, exchange, and bound the capability

**Backlog item:** BI-9369DEB5 · **Merged:** PR #5024 · **Independently shippable:** yes

The persona, the token and the exchange must exist together: a persona with no token cannot be reached, a token with no exchange cannot become a session, and an exchange with no environment bound does not belong on a production installation.

- [x] `apps/web/lib/govern/automation-sign-in.ts` — persona seeding, one-time signed token with a ten-minute life, single-use consumption, environment-class permission and the identity-spine re-check at exchange time
- [x] `apps/web/app/api/automation/sign-in/route.ts` — the exchange, `@exposure public` because it is reached before any session exists, issuing the Auth.js cookie and redirecting to the minted path
- [x] `issue_ux_verification_sign_in` MCP tool, so the agent driving the browser can mint the link it is about to open

**Traced refs.** Contracts: `apps/web/app/api/automation/sign-in/route.ts`. Flow: `apps/web/lib/govern/automation-sign-in.ts`. Acceptance: AC-PERSONA-LANDS-SIGNED-IN, AC-SINGLE-USE, AC-EXPIRY-AND-TAMPER, AC-PRODUCTION-REFUSES. Objectives: OBJ-AGENT-VERIFIES-UNATTENDED, OBJ-NO-CREDENTIAL-IN-A-PROMPT, OBJ-REFUSED-WHERE-IT-DOES-NOT-BELONG.

**Verification:** driven on the development install at 192.168.0.200 — the link was minted by the tool, opened in the browser the agent drives, and landed on the Connections page signed in as the persona. That is what made the live proof of the federation membership flow possible at all.

## Phase 2 — The outcome an operator actually sees

**Backlog item:** BI-D146D071 · **Independently shippable:** yes

A real browser fetched the one-time link twice. The first request spent the token and signed the persona in; the second was refused, and the raw `{"code":"UNAUTHORIZED"}` body is what the operator saw — while signed in, one click from the destination. Single use was working; only the rendering of the outcome was wrong.

- [x] `consumeAutomationSignIn` returns, alongside a `token-already-used` refusal, the subject and destination it parsed from that well-formed token
- [x] The route replays the redirect when the caller already holds the session that token created, and refuses otherwise
- [x] A route suite covers the double fetch, a reuse with no session, a reuse with another session, the environment-class refusal, and the ordinary first exchange

**Traced refs.** Contracts: `apps/web/app/api/automation/sign-in/route.ts`. Flow: `apps/web/lib/govern/automation-sign-in.ts`. Acceptance: AC-SINGLE-USE. Objectives: OBJ-AGENT-VERIFIES-UNATTENDED.

**Verification:** the double-fetch case fails against `main` and passes with the fix; both affected suites run clean (15 tests).

---

## Phase 3 — Isolated ordinary users for permission verification

**Backlog item:** BI-9369DEB5. **Independently shippable:** yes, as one complete extension. Depends on phases 1 and 2. Internal steps below are not separately deployable features: issuing fixtures without expiry, isolation, audit and retirement would expose unfinished authority.

Approved design artifact: commit `2f2395b6ef4f12c7ef9997014e2e3416de13c050`, blob `cdbe4dc7568a29634aa4a0c049d3e6baaa324cb7`. Spec approval `initiative-961bd649-a71b-4b1a-961f-514665bd4245`; architecture review `initiative-e52b32ca-06fc-43ca-8165-c06169ff4b08`; baseline `baseline-76d0fbf0-68e9-4bc6-8d41-6e9f6facf6b1`. Reuse WWMD `DI-0549069249CA`.

### 3a. Ownership schema and failing behavior tests

- Extend User in `packages/db/prisma/schema/core-identity.prisma` with nullable verification ownership, typed AutomationPersonaProfile, bounded slot and absolute expiry. Add the inverse RuntimeVerification relation in `packages/db/prisma/schema/build-delivery.prisma`, restrict deletion, unique run/profile/slot and indexed expiry. Ordinary users remain null; do not infer provenance from email or backfill existing users.
- Follow the enum generator and forward-only migration recipe. Include a data-impact manifest with populated-database application, no backfill and rollback disposition. Add no model, package or service.
- Write failing tests for two runs, same-slot races, unknown profiles, missing role rows, wrong human/room/lease, disabled users and renewal after role removal. Existing seams: automation-sign-in, current-user-context, identity/authentication and nonprod/environment-lease tests. Resolve graph-linked tests for all four impact-contract paths before Red; unavailable or stale graph advice expands coverage.

### 3b. Extend the existing issuer and exchange

- Extend `apps/web/lib/mcp/packs/ux-verification-pack.ts` with a strict discriminated fixture request on `issue_ux_verification_sign_in`. Run creation derives current human/coworker from ToolContext, validates manage_platform/manage_users/manage_user_lifecycle and exact Workroom/shared-lease admission, and creates the RuntimeVerification. Subsequent issuance uses only that server-issued run, closed profile and slot; no supplied email, User ID, superuser flag or authority target.
- Reuse existing role rows HR-000/200/500/600 and combined HR-200+500; every new fixture has isSuperuser=false. Creation is bounded to two slots per profile and ten per run. Transactionally persist ownership, initial groups and audit; principal/employee linkage failure must prevent signing and expose a recoverable failure.
- Refactor shared persona construction, next-path handling and session preparation under regression tests rather than copy the authentication path. Allocate about 20% of implementation effort to this consolidation. Keep modules below 800 lines; extract cohesive helpers before the 1000-line hard cap.
- Extend `apps/web/lib/govern/automation-sign-in.ts` and the existing exchange route. Check development/test, current requester authority, active run, exact live lease, immutable provenance and principal signability at mint and exchange. Fixture production refusal remains unconditional even if shared automation has an operator grant.
- Replace read-then-upsert single-use consumption with an atomic database claim in the existing persistence substrate, retaining compatibility with outstanding legacy links. Concurrency tests must prove at most one cookie is issued. Bound session expiry to the earliest of fixture absolute expiry, lease expiry and two hours; link expiry remains at most ten minutes.

### 3c. Current authority, retirement and audit

- Add fixture expiry denial to the shared current-user and principal-signability seams. Verify OAuth access, refresh and queued/resumed privileged work consume that current state; if a path bypasses the seam, extend the canonical resolver and its tests rather than introduce fixture-only permission logic.
- Renewal never resets groups, active status or expiry. Retain a previously issued session in tests to demonstrate immediate denial after disablement, role loss or expiry.
- Add idempotent run retirement through the existing governed verification flow and an expiry backstop in the existing scheduler. Confirm owned tasks are terminal before cleanup; a failed cancellation remains a visible incomplete cleanup. Revoke only fixture-owned consent/families, disable only run users and close only run-owned rooms. Page indexed expiry by stable ID, at most 100 users per batch; preserve audit and resume progress.
- Audit mint, exchange, refusal and cleanup with requesting human/coworker, fixture, run and room. Fail closed if the issuance audit cannot persist. Never log JWTs, cookies, codes, PKCE verifiers, bearer/refresh tokens or sign-in URLs. Errors explain the failed condition and recovery, for example starting a new run after obtaining a lease; no new operator form or internal identity instructions.

### 3d. Delivery and live acceptance

- Refresh the stale source base and reconcile the governed Workroom before runtime edits; claim every additional route, migration, test and scheduler path. Re-evaluate changeImpactContract after final scope is known.
- Run affected issuer/route/current-user/authentication/lease/OAuth/task tests, including populated-DB migration and concurrent redemption on the canonical shared verification environment. Run both applicable typechecks, `pnpm run pregate:preflight`, exact-tree `pnpm run pregate`, and `node scripts/check-style-drift.mjs`. Missing advice is not a test exemption.
- Update build-gate runbook and the OAuth acceptance plan, regenerate doc index, architecture counts and capability-completeness outputs when their owning generators report a change. Record Design Grounding and Data-Impact evidence; protected PR and merge queue own the production build. Run `pnpm pr:health` and resolve review findings.
- After canonical release/self-upgrade and exact-SHA preflight, drive the original shared persona and two isolated browser contexts. Prove all seven AC-FIXTURE criteria, ordinary-user compatibility, no cross-run state changes, truthful cleanup and secret-free audit. Test permission loss through the same portal/MCP operations; no direct database authorization edits.
- BI-1E56D891 then executes parent BI-B986A18B V6/V7/V9, quiet-client queued authority after access expiry, and valid same-task expiry recovery. Fixture delivery alone does not pass those OAuth tests. Do not rewind the historical review whose approval already completed.

**Traced refs.** Contracts: `apps/web/lib/mcp/packs/ux-verification-pack.ts`, `apps/web/app/api/automation/sign-in/route.ts`, `packages/db/prisma/schema/core-identity.prisma`. Flows: `apps/web/lib/govern/automation-sign-in.ts`, `apps/web/lib/govern/current-user-context.ts`, `apps/web/lib/identity/authentication.ts`. Objectives: OBJ-FIXTURE-ISOLATION, OBJ-FIXTURE-AUTHORITY, OBJ-FIXTURE-AUDIT, OBJ-AGENT-VERIFIES-UNATTENDED. Verification: AC-FIXTURE-CONCURRENT, AC-FIXTURE-CURRENT, AC-FIXTURE-BOUNDARY, AC-FIXTURE-EXPIRY, AC-FIXTURE-CLEANUP, AC-FIXTURE-AUDIT, AC-FIXTURE-COMPAT.

## Risks and rollback

Shared identity/session changes can affect every signed-in user; null-provenance compatibility tests and denial-only fixture checks bound that risk. Races can duplicate accounts or sessions; database uniqueness and atomic redemption must be verified against PostgreSQL. Partial cancellation must not conceal live tasks. Lease expiry during work can legitimately refuse further actions; report the failure and start a new run instead of extending expired authority.

Rollback disables new fixture issuance while retaining expiry enforcement, revocation and audit. Keep additive schema fields and records; never reactivate fixtures or remove denial controls as a rollback step. Existing shared-persona calls retain their documented behavior.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-9369DEB5`
- Receipt: `cmukmjjrr0w6h01s0zlb0vvdl`, recorded against plan commit `fab742053b31e0cd85ca30de640e2e6cd1006bdd`; both live BI mappings validated. Independent plan review remains required before implementation.
- Dependencies: phase-1-mint-and-exchange -> none; phase-2-outcome-an-operator-sees -> phase-1-mint-and-exchange

| Deliverable | Mapping |
| --- | --- |
| Mint, exchange, and bound the capability | phase-1-mint-and-exchange -> `BI-9369DEB5` |
| The outcome an operator actually sees | phase-2-outcome-an-operator-sees -> `BI-D146D071` |
| Isolated permission verification | phase-3-isolated-users -> `BI-9369DEB5`; depends on phases 1 and 2 |

## Coverage

| Phase | Deliverable | Backlog item | Objectives served | Acceptance verified |
| --- | --- | --- | --- | --- |
| 1 | Persona, one-time token, exchange route, MCP tool | BI-9369DEB5 | OBJ-AGENT-VERIFIES-UNATTENDED, OBJ-NO-CREDENTIAL-IN-A-PROMPT, OBJ-REFUSED-WHERE-IT-DOES-NOT-BELONG | AC-PERSONA-LANDS-SIGNED-IN, AC-SINGLE-USE, AC-EXPIRY-AND-TAMPER, AC-PRODUCTION-REFUSES |
| 2 | Repeat fetch shows the destination, not raw JSON | BI-D146D071 | OBJ-AGENT-VERIFIES-UNATTENDED | AC-SINGLE-USE |

Phase 3 covers the seven additional AC-FIXTURE criteria in design section 6; its verification is pending.
