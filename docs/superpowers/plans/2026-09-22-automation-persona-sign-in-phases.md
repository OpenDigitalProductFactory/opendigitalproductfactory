---
status: active
---

# Automation Persona Sign-In — Phased Implementation Plan

**Design:** [`docs/superpowers/specs/2026-09-03-automation-persona-sign-in-design.md`](../specs/2026-09-03-automation-persona-sign-in-design.md)
**Epic:** EP-ZERO-CONFIG-FEDERATION

> **Status: executed.** This plan is written after delivery, and says so. Phase 1 shipped in PR #5024 and phase 2 followed once a live browser exposed a defect the tests did not. It exists because the delivered work needs live backlog coverage — each independently shippable phase mapped to a filed item — and the design's contract (§3) was written as prose rather than as a coverage table. Nothing here is a forecast; the verification column records what was actually observed on the live install.

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

## Backlog coverage

- Decision: decomposed
- Parent: `BI-9369DEB5`
- Receipt: `blocked-by: the phase-2 item BI-D146D071 is still open and its fix is queued behind the local-integration-ci gate, so no coverage receipt can bind both phases yet`
- Dependencies: phase-1-mint-and-exchange -> none; phase-2-outcome-an-operator-sees -> phase-1-mint-and-exchange

| Deliverable | Mapping |
| --- | --- |
| Mint, exchange, and bound the capability | phase-1-mint-and-exchange -> `BI-9369DEB5` |
| The outcome an operator actually sees | phase-2-outcome-an-operator-sees -> `BI-D146D071` |

## Coverage

| Phase | Deliverable | Backlog item | Objectives served | Acceptance verified |
| --- | --- | --- | --- | --- |
| 1 | Persona, one-time token, exchange route, MCP tool | BI-9369DEB5 | OBJ-AGENT-VERIFIES-UNATTENDED, OBJ-NO-CREDENTIAL-IN-A-PROMPT, OBJ-REFUSED-WHERE-IT-DOES-NOT-BELONG | AC-PERSONA-LANDS-SIGNED-IN, AC-SINGLE-USE, AC-EXPIRY-AND-TAMPER, AC-PRODUCTION-REFUSES |
| 2 | Repeat fetch shows the destination, not raw JSON | BI-D146D071 | OBJ-AGENT-VERIFIES-UNATTENDED | AC-SINGLE-USE |

Every acceptance criterion in the design's section 5 manifest is covered above.
