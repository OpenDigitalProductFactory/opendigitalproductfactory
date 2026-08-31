---
status: draft
---

# Implementation Plan — Browser-Driving Capability Substrate

> **Current delivery note (2026-08-30):** this plan preserves the historical browser-specific design and identifiers. `EP-BROWSER-DRIVE` and its listed BIs no longer resolve in the live backlog. The mapped browser-tool work has landed; the remaining permissive behavior for unmapped discovered tools is superseded by live BI `BI-8B7B2FE9` and `2026-08-30-external-mcp-tool-default-deny.md`. Do not implement the fallback described below.

| Field | Value |
|-------|-------|
| **BI** | `BI-2AED4F15` — Browser-driving capability substrate |
| **Epic** | `EP-BROWSER-DRIVE` |
| **Spec** | [`docs/superpowers/specs/2026-06-05-coworker-browser-driving-capability-design.md`](../specs/2026-06-05-coworker-browser-driving-capability-design.md) (architect-reviewed 2026-06-05) |
| **Created** | 2026-06-05 |
| **Scope** | The reusable substrate only — authority gate, identity/session/credential bridge, profile support, `BrowserDriver` contract, means selector, audit wiring, provisioning bootstrap. **Excludes** proving installs `BI-09781F5F` / `BI-95F22C95` / `BI-91D64AD4` / `BI-2F287A19`. |
| **Definition of done** | A coworker holding `browser_drive` can drive an authenticated browser happy-path end-to-end (login/session composition → action → approval at the destructive boundary → evidence), with every step grant-gated and `ToolExecution`-audited, verified functionally on the canonical install or a shared local-CI sandbox lease (spec §15). |

## Grounding (verified 2026-06-05 against the live worktree)

- **Authority gap (the blocker), confirmed at line level:** `apps/web/lib/mcp-tools.ts` `getAvailableTools()` (line 4609) filters `PLATFORM_TOOLS` through `isToolAllowedByGrants()` (line 4627, only when `agentGrants.length > 0`), but at lines 4631–4636, when `externalAccessEnabled`, it calls `getMcpServerTools()` and returns `[...platformTools, ...mcpTools]` — **discovered MCP tools are never grant-filtered, and the append is outside the agent-grant block entirely.** Any agent with External Access on sees every discovered browser tool.
- **Grant machinery exists:** `apps/web/lib/tak/agent-grants.ts` — `GRANT_IMPLICATIONS` (line 23), `expandGrants()` (38), `isToolAllowedByGrants()` (467, default-denies tools absent from `TOOL_TO_GRANTS`), `getToolGrantMapping()` (496), `getAgentToolGrants`/`getAgentToolGrantsAsync` (424+).
- **Tool names are namespaced** `<serverId>__<toolName>` by `apps/web/lib/tak/mcp-server-tools.ts`; the bundled sidecar is `mcp-browser-use` → `mcp-browser-use__browse_act` etc.
- **Sidecar:** `services/browser-use/server.py` opens headless Chromium with no persisted `user-data-dir`; `docker-compose.yml` `browser-use` mounts `browser_evidence:/evidence`, `SESSION_TIMEOUT_SECONDS: 600`; **no `browser_profiles` volume today.**
- **Credential home:** `IntegrationCredential` (`schema.prisma`) — `integrationId @unique`, `provider`, `status`, `fieldsEnc`, `tokenCacheEnc`, `lastTestedAt`, `lastErrorAt`, `lastErrorMsg`, `certExpiresAt`; encryption via `credential-crypto.ts` keyed by `CREDENTIAL_ENCRYPTION_KEY`.
- **Q1 resolved:** no live `ControlSession`/`ControlRun` Prisma models → `BrowserSessionBinding` owns its own table (naming aligned for later EP-CTRL convergence).
- Maps to spec §14 Slices 0–3 (Slices 4–5 are the proving-install BIs).

---

## Phase 0 — Authority gate (spec Slice 0, Verdict 5). **Ships independently. Hard blocker for every later phase.**

**Deliverable:** discovered MCP tools are grant-filtered exactly like first-party tools; new `browser_read` / `browser_drive` grants exist and default-deny. No browser *driving* yet — this phase only makes the existing `mcp-browser-use__*` tools un-callable without the right grant.

**Files:**
- `apps/web/lib/tak/agent-grants.ts` — add `TOOL_TO_GRANTS` entries: `mcp-browser-use__browse_open|browse_extract|browse_screenshot|browse_close → ["browser_read"]`; `mcp-browser-use__browse_act → ["browser_drive"]`. Keep `mcp-browser-use__browse_run_tests` QA-scoped (narrowest read grant, **not** `browser_drive`). Add `GRANT_IMPLICATIONS["browser_drive"] = ["browser_read"]`. Register `browser_read`/`browser_drive` in the grant catalog used by the Issue-token / grant-assignment flow.
- `apps/web/lib/mcp-tools.ts` — at lines 4631–4636, filter `mcpTools` through `isToolAllowedByGrants(tool.name, agentGrants)` before returning. Default-deny: an agent with **no** browser grant must receive zero `mcp-browser-use__*` tools even with External Access on. Resolve the current quirk that grant-filtering only runs when `agentGrants.length > 0` so MCP tools aren't a bypass for ungranted agents.
- `apps/web/lib/tak/mcp-server-tools.ts` — add a bundled policy overlay carrying per-discovered-tool `sideEffect` / read-vs-write posture + execution-mode hint, so read tools aren't all treated as side-effecting.
- `EffectivePermissionsPanel` (`apps/web/app/(shell)/platform/audit/authority/…`) — stop the mirror drifting: update it in this PR or switch it to `getToolGrantMapping()` so namespaced MCP tools render at `/platform/ai/authority`.

**Verification (functional, not just structural):**
- Unit: `agent-grants.test.ts` — namespaced grant mapping resolves; `expandGrants(["browser_drive"])` ⊇ `browser_read`; tools absent from the map default-deny.
- Unit: `mcp-tools.test.ts` — `getAvailableTools({externalAccessEnabled:true, agentId})` for an agent **without** browser grants returns **no** `mcp-browser-use__*`; with `browser_read` returns only the read tools; with `browser_drive` returns read + act.
- Runtime: at `/platform/ai/authority`, the namespaced browser tools appear under their grants for a granted coworker and are absent for an ungranted one.

**Historical risk / supersession:** filtering discovered tools could hide MCP tools other coworkers already rely on via External Access. The former compatibility choice kept unmapped tools available. That choice is now superseded: BI-8B7B2FE9 requires all unmapped tools to quarantine/default-deny and rechecks policy at invocation. Never roll back to ambient availability; disable external execution while policy is repaired. Blast radius remains the coworker tool-availability and execution paths.

---

## Phase 1 — Identity, credential & session substrate (spec Slice 1)

**Deliverable:** the persistent records a driven session needs — service-account identity, credential custody, the session binding table, and the profiles volume. No driving yet.

**Files:**
- `packages/db/prisma/schema.prisma` + migration (`pnpm --filter @dpf/db exec prisma migrate dev --name browser_session_binding`) — add `BrowserSessionBinding` with fields per spec §8.7: `sessionId, means, driverRef, engine, profileRef, profileKind, attended, actingPrincipalId, delegatingUserId, delegationGrantId?, credentialId?, targetDomains[], status, startedAt, closedAt, evidenceDir, meansDecisionJson`. DB-level/app-level invariants: `profileKind="operator-live" ⇒ attended=true`; `profileKind="service-account" ⇒ actingPrincipalId` present.
- `apps/web/lib/browser-drive/identity.ts` (new) — resolve a service-account `Principal{kind:"service"}` + `PrincipalAlias{aliasType:"service-account"}`; never model the coworker as a human; `delegatingUserId` carries the human.
- `apps/web/lib/browser-drive/credentials.ts` (new) — `browser-session` credential custody over `IntegrationCredential` with **deterministic** `integrationId = "browser-session:<principalId>:<siteKey>"` (the `@unique` constraint forces this); `storageState` (or, only in `credentialed` mode, username/password/TOTP) encrypted into `fieldsEnc` via `credential-crypto.ts`; freshness via `tokenCacheEnc`/`lastTestedAt`/`lastErrorAt`. Per spec Q3: keep `targetDomains`/`provisioningMode` as first-class columns on `BrowserSessionBinding`/profile metadata, **not** ad-hoc JSON in `fieldsEnc` (secrets only in `fieldsEnc`).
- `docker-compose.yml` — add `browser_profiles:/profiles` to the `browser-use` service and a top-level `browser_profiles:` volume. **Portal never mounts it.** Profiles at `/profiles/<serviceAccountPrincipalId>/<siteKey>/`.
- `docs/install/platform-support-watchlist.md` + deployment-contract doc — record `browser_profiles` as **secret impersonation material**: backup/restore + uninstall semantics across install targets (spec §8.9).

**Verification:**
- Migration applies cleanly on the canonical Postgres (spec §15 / AGENTS.md §5.4).
- Unit: `BrowserSessionBinding` invariant guards reject `operator-live`+`attended:false` and `service-account` without `actingPrincipalId`.
- Unit: credential round-trip — `encryptJson`→store→read→decrypt yields the original `storageState`; deterministic `integrationId` collision-free per `(principal, site)`.
- Runtime: `docker compose config` shows `browser_profiles` on the sidecar and **absent** from the portal service.

**Risk / rollback:** migration touches a shared schema — additive only (new model + new volume), no edits to existing models, so rollback = `migrate resolve` + drop the new table/volume. Profiles volume holds secrets: if backup/restore semantics aren't defined, an install migration could leak or orphan cookies — gate Phase 1 done on the watchlist row existing.

---

## Phase 2 — Sidecar profile support (spec Slice 2)

**Deliverable:** the `browser-use` sidecar can open a *specific persisted profile* and is bounded to a target-domain allowlist; QA `browse_run_tests` behavior is preserved.

**Files:**
- `services/browser-use/server.py` — accept a `profile_path` (`/profiles/<principalId>/<siteKey>/`) and open Chromium with that persistent `user-data-dir`; accept `target_domains` and **enforce per-navigation and per-act** (reject off-allowlist nav). Add a session-scoped evidence dir beyond build-scoped `/api/build/...`. Keep `browse_run_tests` unchanged for the Build Studio QA path.
- `services/browser-use/Dockerfile` / requirements — only if a pinned dependency bump is needed (no new external dep without the Tool Evaluation Pipeline).

**Verification:**
- Runtime (sidecar): open a profile, navigate on-allowlist (succeeds) and off-allowlist (rejected); a second session on the same profile sees persisted state from the first.
- Runtime: existing `build/review.verify` QA path still green (no regression to `browse_run_tests`).
- Health: sidecar healthcheck passes with the new `browser_profiles` mount.

**Risk / rollback:** changes the always-on QA sidecar — a regression here breaks Build Studio review verification. Mitigate: profile/target-domain params are **opt-in** (absent ⇒ current headless behavior). Rollback = revert `server.py`; the volume mount is inert without code using it.

---

## Phase 3 — `BrowserDriver` contract, means selector & audit wiring

**Deliverable:** the TS substrate a coworker reaches for — one interface, the per-task WWMD means selector, and full `ToolExecution`/envelope wiring. M1/M3 adapters are stubbed; M2 (plugin via the Phase 2 sidecar) is the live path.

**Files:**
- `apps/web/lib/browser-drive/driver.ts` (new) — `BrowserDriver` interface per spec §8.1 (`open/read/act/screenshot/close`); `act` owns the screenshot→replan recovery contract for M2.
- `apps/web/lib/browser-drive/means-m2-plugin.ts` (new) — implements `BrowserDriver` over the namespaced `mcp-browser-use__*` tools (post-authorization), writing a `BrowserSessionBinding` on `open` and `ToolExecution` per call (`executionMode`: `immediate` for read, `permission` for attended operator-live, `proposal` for envelope-gated side effects; set `capabilityId`, `delegatingUserId`, `envelopeId`). Stubs: `means-m1-deterministic.ts`, `means-m3-delegated.ts` (interface-conformant, throw `not-implemented`).
- `apps/web/lib/browser-drive/select-means.ts` (new) — scoped `principle_decide` (`callingSurface:"browser-drive-means-select"`) scoring the 3 means on task-derived features; persist the ledger to `BrowserSessionBinding.meansDecisionJson`. Cache/short-circuit a proven M1 script (spec Q4) — for now, skip selection when a recorded script exists.
- `apps/web/lib/browser-drive/envelope.ts` (new) — at the irreversible outward boundary (publish/submit/order), create a `CoworkerActionEnvelope` (rendered artifact + target in `argsJson`) and block the final `act` until approved; reuse the existing envelope lifecycle + `proposals.ts` approval path.
- Delegation: side-effecting sessions run under a `DelegationGrant` (`scopeJson` per spec §8.4); increment `useCount` at action boundaries that matter, not only on `open`.

**Verification:**
- Unit: selector returns a means + ledger; ledger persists on the binding; recorded-M1 short-circuit skips `principle_decide`.
- Unit: a side-effecting `act` with no approved envelope is refused; with an approved `CoworkerActionEnvelope` it proceeds and links `envelopeId` on the `ToolExecution`.
- Unit: each driver call writes a `ToolExecution` with the correct `executionMode`/`capabilityId`/`delegatingUserId`.
- Runtime: drive a read-only happy path (M2) against a fixture authenticated page; confirm `BrowserSessionBinding` + `ToolExecution` rows + session evidence dir.

**Risk / rollback:** the means selector adds a `principle_decide` round-trip per task (spec Q4) — mitigate with the recorded-script short-circuit and accept latency for bounded high-value workflows. Rollback = feature-flag the capability off (no coworker holds `browser_drive` until Phase 5 passes).

---

## Phase 4 — Provisioning bootstrap + minimal operator UX (spec Slice 3, minimal)

**Deliverable:** the attended one-time login that captures `storageState`, the expiry/re-auth loop, and a dense report-kit ledger. Full evidence-review UI can trail as a fast-follow.

**Files:**
- `apps/web/app/(shell)/platform/…/service-account-browser-setup/` (new) — attended bootstrap flow (spec §9.2): pick site/principal/mode/allowlist → open attended M2 session on the dedicated profile → operator completes login/MFA → capture `storageState` → encrypt to `IntegrationCredential` → write `BrowserSessionBinding` → probe authenticated endpoint → stamp health. **This is the only step that asks the operator to act** (the irreducible human-auth step) — never a shell/Docker instruction (spec §10.3).
- `apps/web/lib/browser-drive/reauth.ts` (new) — pre-run probe; redirect-to-auth ⇒ expired; `storageState` mode blocks the dependent workflow `blocked-on-reauth` + notifies via the agent event bus; `credentialed` mode attempts one rate-limited programmatic login then falls back to attended. Never loop; never run a downstream destructive action after auth failure (spec §9.3).
- Browser Session Ledger surface — report-kit `DataTable`/`FilterBar`/`StatusBadge`/`StatCard`/`ExportButton`, token-backed colors only; no raw tool names in primary copy ("Browser read"/"Browser action"/"Needs re-auth"/"Awaiting approval"); deep-link to `/platform/ai/authority` + `/platform/audit/*` (spec §10).

**Verification:**
- Runtime: complete an attended bootstrap on a real auth-walled site; confirm encrypted credential + populated profile under `/profiles` + healthy binding.
- Runtime: force expiry → workflow goes `blocked-on-reauth` and the operator is notified; no silent downstream side effect.
- UI: report-kit primitives render setup/ledger/blocked states; theme-token compliance (AGENTS.md §12); no hardcoded colors.

**Risk / rollback:** the setup surface handles secrets (cookies/passwords) — screenshots/logs must never capture them (spec §11). Gate done on a redaction check. Rollback = hide the setup route; substrate still functions via API for tests.

---

## Phase 5 — Functional verification (spec §15) — definition of done

**Deliverable:** the mandatory end-to-end proof on the canonical install or a shared local-CI sandbox lease (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`).

**Steps:** drive a real auth-walled happy path through **login/session composition → action → approval at the destructive boundary → evidence**, plus: sidecar health + profile mount; service-account attended setup; expired-session detection; envelope-gated final side effect; evidence-route auth/path-traversal checks; confirm no operator-facing copy asks for shell/Docker. Record canonical-runtime evidence via `record_execution_evidence` naming the substrate (AGENTS.md §6).

**Verification:** the proof itself is the verification — a screenshot pile is explicitly insufficient (spec §15; `structural-verification-is-not-functional`). This phase is exercised concretely by the first proving install (`BI-09781F5F`, Substack); the substrate is "done" when that path runs green against the substrate without substrate changes.

---

## Cross-cutting risks

- **Authority bypass is the headline risk.** Phase 0 must merge and be tested before any `browser_drive`-callable code ships; no coworker is seeded `browser_drive` until Phase 5 passes (spec Q5).
- **Secret material.** `browser_profiles` + `browser-session` credentials are impersonation-grade. Backup/restore/uninstall (Phase 1), redaction (Phase 4), evidence-route auth (Phase 5) are not optional.
- **Sidecar regression.** The QA path (`browse_run_tests`) is always-on; Phases 2–3 keep it untouched by making new behavior opt-in.
- **EP-CTRL convergence (Q1).** `BrowserSessionBinding` is a deliberate sibling; revisit specialization when `ControlSession` lands. Naming chosen to not block it.

## Phase ordering

`Phase 0 (blocker) → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5`. Phase 0 ships independently and should be its own PR. Phases 1–2 (substrate + sidecar) can land together. Phase 3 depends on 1+2. Phase 4 depends on 3. Phase 5 gates DONE and is shared with `BI-09781F5F`.
