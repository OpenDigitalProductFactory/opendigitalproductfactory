# Zero-Config Upstream Feedback Escalation Design

| Field | Value |
| ----- | ----- |
| Status | Draft (operator-directed in-thread build; Build Studio unavailable) |
| Date | 2026-06-06 |
| Backlog item | `BI-6D45BA27` (Zero-config upstream feedback escalation for consumer installs) |
| Epic | `EP-9FC5D2FD` (feedback support-mode work). May promote to a dedicated `EP-FEEDBACK-CAPACITY-ROUTING` if scope formalizes platform-wide per the 2026-05-24 spec recommendation. |
| Author | Claude (Software Engineer) + Mark Bodman (CEO) |
| Builds on | [Capacity-aware feedback escalation (2026-05-24)](2026-05-24-capacity-aware-feedback-escalation-design.md); [Pseudonymous identity & backlog→issue bridge (2026-04-18)](2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md); [Quality feedback (2026-03-14)](2026-03-14-quality-feedback-design.md) |
| Related substrate | `apps/web/lib/integrate/issue-bridge.ts`; `apps/web/lib/integrate/identity-privacy.ts`; `apps/web/lib/quality/platform-issue-reports.ts`; `apps/web/lib/actions/feedback-support.ts`; `apps/web/lib/feedback/feedback-event.ts`; `apps/web/components/feedback/`; `apps/web/app/api/quality/report/route.ts`; `PlatformDevConfig`; `HiveContributionLedger` |

---

## 1. Problem Statement

A DPF install with **no frontier model (local model only) and no source-code development** has a working *local* defect/feedback capture path (`PlatformIssueReport` via `POST /api/quality/report`, the `report_quality_issue` MCP tool, and the crash boundary; triaged to backlog items by a cron that prefers local models with a deterministic fallback). But the **path to the project team over git is effectively dormant** for these installs.

The GitHub Issues bridge already exists and is tested — `escalateToUpstreamIssue({ kind: "issue-report", id })` ([issue-bridge.ts](../../../apps/web/lib/integrate/issue-bridge.ts)) handles pseudonymity, hostname redaction, idempotency, and persistence of `upstreamIssueNumber/Url/SyncedAt`. The gap is purely in **connection and credential**:

1. The bridge returns `skipped` unless an admin has set `contributionMode != fork_only`, a non-null `upstreamRemoteUrl`, **and** an available GitHub token (`resolveHiveToken()`).
2. There is **no user-facing trigger** for `kind:"issue-report"` — the Phase 1 feedback plan explicitly deferred upstream bridge work.
3. A consumer install has **no GitHub credential** and should not be asked to obtain one.

## 2. Decision: authenticate the *install*, not the end user

For in-product feedback from a consumer application, the recommended pattern (Sentry, Canny, Linear feedback) is **not** to grant each install GitHub write access, and **not** to make the non-technical end user authenticate to GitHub. Instead:

> The **install** is the authenticated principal. It sends a redacted report to a **configurable intake relay**; the relay holds the GitHub credential and files the issue server-side under the install's stable pseudonym. GitHub is the backend store, not the auth boundary.

Rationale:

- This is an **issue/feedback** flow, not a code PR. PRs need DCO + identity + review (`contribute_to_hive`); a feedback item needs a trustworthy channel only.
- The install already carries a **stable pseudonymous identity** (`dpf-agent-<shortId>`, derived from `PlatformDevConfig.clientId`/`gitAgentEmail`). That identity is the natural authentication principal to the relay.
- A **shared GitHub token shipped to every install** is rejected: it is a shared secret on every customer machine (leak → repo spam, rotation affects everyone) and cannot model a reseller middleman.
- A relay endpoint enables **server-side rate-limiting, spam filtering, dedup, and re-redaction**, and lets the backend store change without touching installs.
- **Reseller accommodation:** because the relay target is configurable, a reseller can stand up its own intake (triage/curate) and forward upstream, or installs point straight at OpenDigitalProductFactory. This is the "DPF is a conduit, not a broker" principle.

Installs that *do* hold a GitHub token (contributor/admin/dev installs) keep the **direct bridge** path. A small transport abstraction selects direct-vs-relay; `issue-bridge.ts` issue-building logic is reused in both.

## 3. Privacy posture (operator decision, 2026-06-06)

- **Opt-in.** Upstream feedback is OFF until explicitly enabled. Nothing leaves the install without a recorded yes.
- **Consent recorded locally** on `PlatformDevConfig` (boolean + timestamp + actor).
- **The AI coworker provides/surfaces** both the consent prompt and the "Report to the project team" action — the user does not hunt through admin settings.
- `fork_only` and the existing `hiveContributionsPaused` master switch still hard-block.

## 4. Architecture

```
User clicks "Report to the project team" (coworker-surfaced)
        │
        ▼
fileUpstreamFeedback(reportId)            ← server action (auth, consent gate, rate-limit, ledger)
        │   reuses issue-bridge payload builders (title/body/labels/redaction)
        ▼
selectTransport(config)
   ├── DirectBridgeTransport   → escalateToUpstreamIssue() → GitHub API   (token present)
   └── RelayTransport          → POST {redacted payload + install auth} → intake relay → GitHub  (no token)
        │
        ▼
persist upstreamIssueNumber/Url/SyncedAt on PlatformIssueReport
record HiveContributionLedger row (contributionType:"feedback")
```

### 4.1 Data model additions (`PlatformDevConfig`)

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `upstreamFeedbackOptIn` | `Boolean @default(false)` | Opt-in consent for upstream feedback escalation. |
| `upstreamFeedbackOptInAt` | `DateTime?` | When consent was recorded. |
| `upstreamFeedbackOptInById` | `String?` (User) | Who recorded consent. |
| `upstreamRelayUrl` | `String?` | Configurable intake relay target. Null → fall back to direct bridge if a token exists, else the report stays local. Reseller seam. |

No new model is introduced; `HiveContributionLedger` is reused for the audit trail (`contributionType:"feedback"`).

### 4.2 Transport abstraction

A new module `apps/web/lib/integrate/feedback-transport.ts`:

```ts
type FeedbackTransportResult =
  | { status: "filed"; issueNumber: number | null; url: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

interface FeedbackTransport {
  file(payload: RedactedIssuePayload): Promise<FeedbackTransportResult>;
}
```

- `DirectBridgeTransport` delegates to `escalateToUpstreamIssue({ kind: "issue-report", id })` (token path; unchanged behavior).
- `RelayTransport` POSTs the redacted payload + install identity header to `upstreamRelayUrl`; parses `{ issueNumber, url }`.
- `selectTransport(config)` picks relay when `upstreamRelayUrl` is set, else direct when a token resolves, else returns a `skipped` no-op transport. Pure and unit-testable; the relay HTTP client is injected for tests.

### 4.3 `fileUpstreamFeedback()` server action

Mirrors the proven `feedback-support.ts` shape: auth, consent gate (`upstreamFeedbackOptIn` + not `hiveContributionsPaused` + not `fork_only`), per-user rate-limit, idempotency on `upstreamIssueNumber`, ledger write. **It is a wrapper around the transport/bridge — never a second GitHub writer** (per 2026-05-24 spec §5).

## 5. Phasing

- **Phase A (this thread, no hosting dependency):** schema fields + migration; `feedback-transport.ts` (with direct + relay client, relay injected/stubbed); `fileUpstreamFeedback()` server action; coworker-surfaced "Report to the project team" affordance + local opt-in consent capture; unit tests; live-install happy-path verification with the relay stubbed.
- **Phase B:** the hosted **intake relay service** (separate deployable — holds GitHub credential, rate-limit, spam, dedup, re-redaction). Only piece needing hosting.
- **Phase C:** reseller-configurable target hardening + reverse-channel acknowledgement (ties into `BI-FBDC0861`).

## 6. Acceptance criteria

- Fresh consumer install (no GitHub token, no source-dev config) with opt-in enabled: user clicks "Report to the project team" and a GitHub Issue is created via the relay (verified end-to-end on a live install — structural ≠ functional).
- Issue authored under the install pseudonym; no hostname/PII leaks.
- `upstreamIssueNumber/Url/SyncedAt` persisted; idempotent on repeat clicks; `HiveContributionLedger` row written.
- Opt-out / `fork_only` / `hiveContributionsPaused` all hard-block; no regression to `issue-bridge.ts` or its tests.
- No frontier model required anywhere in the path.
- Docs + tests updated alongside code.

## 7. Out of scope

- Making GitHub Issues the canonical store for all local issue reports.
- A parallel GitHub Issue writer or issue-tracker abstraction (reuse the bridge).
- `contribute_to_hive` / code-PR path.
- Reverse-channel resolution notifications (Phase C / `BI-FBDC0861`).
- Full reseller curation workflow (only the configurable-target seam is in scope now).
