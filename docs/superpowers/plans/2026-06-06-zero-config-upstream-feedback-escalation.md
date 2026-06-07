# Zero-Config Upstream Feedback Escalation — Implementation Plan

**Backlog item:** `BI-6D45BA27`  ·  **Epic:** `EP-9FC5D2FD`  ·  **Spec:** [2026-06-06-zero-config-upstream-feedback-escalation-design.md](../specs/2026-06-06-zero-config-upstream-feedback-escalation-design.md)

**Goal:** Let a consumer install (no frontier model, no source-code development, no GitHub token) escalate a captured `PlatformIssueReport` to the upstream project team as a GitHub Issue, via an install-authenticated **intake relay**, behind a locally-recorded **opt-in** consent that the AI coworker surfaces — reusing the existing `issue-bridge.ts` and never adding a second GitHub writer.

**Architecture:** Install is the authenticated principal to a configurable relay (reseller seam). A transport abstraction selects relay-vs-direct-bridge. A `fileUpstreamFeedback()` server action gates on consent + contribution mode + rate limit, delegates to the transport, persists the upstream link, and writes a `HiveContributionLedger` audit row.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, Vitest, DPF MCP, Docker-served portal verification.

**Execution note:** Operator-directed in-thread build — Build Studio is not fully working yet. Run full `pnpm test` in `apps/web` before any push (pre-commit only runs typecheck).

---

## Phase A — Portal substrate (this thread; no hosting dependency)

### A1 — Data model + migration ✅
- [x] Added to `model PlatformDevConfig`: `upstreamFeedbackOptIn Boolean @default(false)`, `upstreamFeedbackOptInAt DateTime?`, `upstreamFeedbackOptInById String?` (+ `User?` relation `PlatformDevUpstreamFeedbackOptInBy`), `upstreamRelayUrl String?`.
- [x] Migration `20260606000000_add_upstream_feedback_optin` (ALTER TABLE + FK). Not hand-applied to a live volume; applies at deploy/CI. Prisma client regenerated (7.8.0).
- [x] No seed change needed (default `false`).

### A2 — Transport abstraction (pure, unit-first) ✅
- [x] `apps/web/lib/integrate/feedback-transport.ts`: `FeedbackTransport` interface, `RedactedIssuePayload`, `DirectBridgeTransport` (delegates to `escalateToUpstreamIssue`), `RelayTransport` (injected HTTP client → POST payload + `X-DPF-Install-Id` header → parse `{issueNumber,url}`), pure `selectTransport(config, deps)`, `buildRedactedFeedbackPayload`.
- [x] Reuse via new exported `buildEscalationPayload` (+ `loadSource`, `NormalizedSource`, `buildLabels`) in `issue-bridge.ts`; the direct path was refactored to use the same builder (one source of truth). `redactHostnames` reused.
- [x] `feedback-transport.test.ts` — 22 tests green (selection matrix; relay success/null-issue/missing-url/non-ok/network-error; redaction; install header; direct-bridge mapping).

### A3 — `fileUpstreamFeedback()` server action ✅
- [x] New `apps/web/lib/actions/feedback-escalation.ts`: `fileUpstreamFeedback`, `getUpstreamFeedbackConsent`, `setUpstreamFeedbackOptIn`. Auth, consent gate (opt-in && !paused && !fork_only), idempotency on `upstreamIssueNumber`, per-install rate-limit (5/min, 30/hr from the ledger), `selectTransport().file()`, null-guarded persist of `upstreamIssueNumber/Url/SyncedAt`, `HiveContributionLedger` row (`contributionType:"feedback"`, pseudonym, payloadHash, `status:"submitted"`). Consent toggle gated on `manage_platform`.
- [x] `feedback-escalation.test.ts` — 11 tests green (opt-out/paused/fork_only block; not-found; already-filed; rate-limit; filed persists+ledgers; transport failure/skip; consent set/clear).

### A4 — Consent capture + coworker affordance ✅
- [x] `setUpstreamFeedbackOptIn(enabled)` + `getUpstreamFeedbackConsent()` in `feedback-escalation.ts` (consent toggle gated on `manage_platform`).
- [x] "Report to the project team" affordance in `FeedbackForm` (shared fallback surface, shown after a report is filed), with first-use consent prompt → `fileUpstreamFeedback`. Theme tokens only.
- [x] Coworker can provide it: new MCP tool `escalate_feedback_upstream` (definition + handler in `mcp-tools.ts`, grant `backlog_write` in `agent-grants.ts`) wrapping the shared auth-free core `escalateReportUpstream`. Reuses the existing feedback event contract; no parallel surface.
- [x] `FeedbackForm.test.tsx` — 5 tests (affordance appears; consent prompt → file + issue link; direct file when opted-in; fork_only hidden; failure reason surfaced). Full surface: 51 tests green; full typecheck clean.

### A5 — Verification (functional, not structural) ✅
- [x] `pnpm test` green across the escalation surface (51); typecheck clean.
- [x] Functional happy path verified via real-DB integration test + in-process stub relay (operator chose this over live-portal to avoid posting real issues to the public repo, since this install carries a live hive token). Drove the real `escalateReportUpstream` against real Postgres (dev DB :5433): observed `filed`, persisted `upstreamIssueNumber/Url/SyncedAt`, ledger row, redacted relay payload, install-auth header, and idempotency. Evidence: [2026-06-06-zero-config-feedback-escalation-verification.md](../evidence/2026-06-06-zero-config-feedback-escalation-verification.md).
- [x] Confirmed opt-out / paused / fork_only block (unit). Test auto-skips without `RUN_DB_INTEGRATION=1` (CI stays DB-free); all rows cleaned + config restored.

**Phase A complete.** Phase B (hosted relay service) makes the live consumer install reach `filed` end-to-end through real config; Phase C adds reseller target + reverse channel.

## Phase B — Hosted intake relay service (separate deployable)
- [ ] Stand up the relay (holds GitHub credential; install-identity auth; rate-limit; spam/dedup; server-side re-redaction; returns `{issueNumber,url}`).
- [ ] Point `upstreamRelayUrl` default at it for consumer installs.
- [ ] End-to-end live verification against the real upstream repo.

## Phase C — Reseller + reverse channel
- [ ] Harden `upstreamRelayUrl` as a reseller-configurable target (curate/forward).
- [ ] Reverse-channel acknowledgement back to the reporting user (ties into `BI-FBDC0861`).

---

## Guardrails
- Reuse `issue-bridge.ts`; never add a second GitHub writer (spec §5 / 2026-05-24 §5).
- No frontier model in the path at any point.
- No DB wipe for code fixes; migration only.
- Opt-in default `false`; consent recorded before anything leaves the install.
- Update docs + tests with code; run full vitest before push.
