---
status: draft
---

# Coworker Browser-Driving Capability - Design Spec

| Field | Value |
|-------|-------|
| Epic | `EP-BROWSER-DRIVE` - Coworker Browser-Driving Capability |
| Status | Draft, architect-reviewed 2026-06-05 |
| Created | 2026-06-05 |
| Author | Claude Code (Opus 4.8) for Mark Bodman; architect review by Codex |
| Scope | Browser-driving as a first-class AI Coworker capability: substrate abstraction, identity/session bridge, audit hook, grant extension, service-account profile provisioning, and proving-install roster. This scopes implementation; it does not implement it. |
| Anchors | `browser-use` MCP service, coworker authority binding, External Site Access, Automated Control Utility, Principal convergence, `ToolExecution`, `CoworkerActionEnvelope`, `GearInterface`, `IntegrationCredential`, report-kit UI primitives |
| Standing procedure | Originating thread recorded WWMD verdicts 1-4. This architect pass verified the current repo and live MCP backlog, then added verdict 5 for the discovered MCP authority gap. |

---

> **Current delivery note (2026-08-30):** `EP-BROWSER-DRIVE` and the roster in §16 are a historical snapshot and no longer resolve in the live backlog. Browser-specific mappings remain valid design evidence. The remaining platform-wide authority gap for unmapped dynamically discovered tools is governed by live BI `BI-8B7B2FE9` under `EP-413F2602` and by `2026-08-30-security-authentication-hardening-successors-design.md` §11.

## 1. Architect Review Update

This pass preserves the spec's core direction: browser-driving should be one governed capability with three separately graspable means, not a one-off browser bot and not a parallel permission system. The direction is sound.

The draft needed tightening in five places:

1. It treated discovered MCP browser tools as if they were already under coworker grant enforcement. They are not. `getAvailableTools()` currently grant-filters first-party `PLATFORM_TOOLS`, then appends discovered MCP server tools when `externalAccessEnabled` is true. Browser-driving must close this before any side-effecting browser action ships.
2. It used raw tool names such as `browse_act` in the grant map. The discovered tool names that enter the platform tool list are namespaced by `McpServer.serverId`, so the bundled sidecar is `mcp-browser-use__browse_act`, not only `browse_act`.
3. It implied the Automated Control Utility's `ControlSession` table exists. It is still spec-only; there is no live Prisma `ControlSession`/`ControlRun` model today.
4. It said `IntegrationCredential` has "no schema strain." Reuse is right, but the live model has `integrationId @unique` and no first-class `targetDomains` or provisioning-mode fields. The first implementation must either minimally extend it or deliberately encode those fields in `fieldsEnc` with known query limits.
5. It underweighted operator UX. Service-account setup, approval, evidence, and audit review must use the platform's dense operational primitives (`report-kit`, token colors, existing authority surfaces), not a bespoke browser-automation console.

This revision separates current repo truth from future contract and makes the grant/authority fix the first implementation blocker.

---

## 2. Current Repo Truth

Verified 2026-06-05 in `D:\DPF\.claude\worktrees\zen-vaughan-f8713f` plus live DPF MCP reads.

### 2.1 Live backlog state

Live MCP backlog contains:

- Epic `EP-BROWSER-DRIVE`: `open`, title `Coworker Browser-Driving Capability - auth-walled web reach as a kernel-gated capability`, item count 5, all still `triaging`/`Captured`.
- `BI-2AED4F15`: substrate BI.
- `BI-09781F5F`: Substack-publish proving install.
- `BI-95F22C95`: supplier portal proving install.
- `BI-91D64AD4`: ad-network dashboard read proving install.
- `BI-2F287A19`: cross-channel marketing distribution proving install.

`search_specs_and_plans` did not return this worktree-local spec yet. Treat this file as the working source until the branch lands and the docs index refreshes.

### 2.2 Browser-use service

The browser engine is real and bundled:

- `docker-compose.yml` defines `browser-use` on port `8500`.
- The sidecar mounts `browser_evidence:/evidence`.
- The sidecar sets `SESSION_TIMEOUT_SECONDS: "600"`.
- The portal mounts the same `browser_evidence` volume read-only and serves build screenshots through `/api/build/[buildId]/evidence/[fileName]`.
- There is no `browser_profiles` volume today.

The service implementation at `services/browser-use/server.py` exposes:

- `browse_open`
- `browse_act`
- `browse_extract`
- `browse_screenshot`
- `browse_run_tests`
- `browse_close`

The service currently creates headless Chromium `BrowserSession` instances with no persisted `user-data-dir`, no account profile binding, and in-memory session lifecycle only. Authentication/session composition is therefore not an accessory; it is the first missing architectural primitive.

### 2.3 MCP registry and tool naming

The seeded server is:

- `McpServer.serverId = "mcp-browser-use"`
- `transport = "http"`
- `config.url = "http://browser-use:8500/mcp"`

`apps/web/lib/tak/mcp-server-tools.ts` namespaces discovered tools as:

```text
<serverId>__<toolName>
```

For this service, the platform-visible names are therefore:

- `mcp-browser-use__browse_open`
- `mcp-browser-use__browse_act`
- `mcp-browser-use__browse_extract`
- `mcp-browser-use__browse_screenshot`
- `mcp-browser-use__browse_run_tests`
- `mcp-browser-use__browse_close`

The spec and implementation must not rely on raw `browse_*` names unless the call is explicitly inside the sidecar adapter after platform authorization has already succeeded.

### 2.4 Authority and grant enforcement gap

`apps/web/lib/tak/agent-grants.ts` already provides:

- `TOOL_TO_GRANTS`
- `GRANT_IMPLICATIONS`
- `expandGrants()`
- `isToolAllowedByGrants()`

It default-denies tools missing from `TOOL_TO_GRANTS`.

However, `apps/web/lib/mcp-tools.ts` currently:

1. filters first-party `PLATFORM_TOOLS` by agent grant;
2. then, when external access is enabled, appends discovered MCP tools from `getMcpServerTools()`.

The later mapped-tool filter closed the browser-specific visibility gap, but its compatibility path admits discovered tools that have no `TOOL_TO_GRANTS` mapping. That remaining platform-wide omission is not acceptable authority. BI-8B7B2FE9 owns explicit quarantine/approval and invocation-time recheck; this historical design does not create a second browser-only policy.

### 2.5 Existing data substrate

The following live Prisma models exist and should be reused:

- `Principal` / `PrincipalAlias`: free-string `kind` and `aliasType`; principal convergence principle applies to any new service-account identity.
- `McpServer` / `McpServerTool`: registry and discovered tool records.
- `IntegrationCredential`: `integrationId @unique`, `provider`, `status`, `fieldsEnc`, `tokenCacheEnc`, `lastTestedAt`, `lastErrorAt`, `lastErrorMsg`, `certExpiresAt`.
- `DelegationGrant`: `scopeJson`, `riskBand`, `validFrom`, `expiresAt`, `maxUses`, `useCount`, `workflowKey`, `objectRef`.
- `AuthorityBinding` / `AuthorityBindingGrant`: resource binding, `approvalMode`, grant modes including require-approval semantics.
- `ToolExecution`: includes `executionMode`, `capabilityId`, `apiTokenId`, `taskRunId`, `skillId`, `delegatingUserId`, `chatMessageId`, `envelopeId`.
- `CoworkerActionEnvelope`: destructive-action proposal envelope with `manifestActionId`, `argsJson`, `rationale`, status lifecycle, and relation to `ToolExecution`.
- `ToolExecutionReceipt`: existing evidence receipt model.
- `GearInterface`: reusable transmission/graduation substrate.

The following do not exist today:

- `BrowserSessionBinding`
- `browser_profiles` volume
- `ControlSession`, `ControlRun`, `ControlStep`, `ControlEvidence`, `ControlPolicy`
- `browser_read` / `browser_drive` grants

### 2.6 UI substrate

Reporting/data-display surfaces must use `apps/web/components/ui/report-kit/`:

- `StatusBadge`
- `DataTable`
- `StatCard`
- `FilterBar`
- `ExportButton` / `toCsv`
- `Chart` where appropriate
- `statusColors.ts`

Browser-driving setup and evidence review are operational admin surfaces. They should be dense, filterable, and audit-first, not a marketing page or decorative custom console.

---

## 3. Problem Statement

DPF coworkers can reach many systems through API-backed MCP tools and native integrations. But many high-value business actions still live behind auth-walled web UIs with no stable API:

- supplier portals;
- Substack, LinkedIn, X, Medium, and ad dashboards;
- permit and licensing sites;
- procurement and vendor dashboards;
- niche customer or partner portals.

The current browser-use sidecar proves DPF can drive a browser for QA and public page extraction. It does not yet prove a coworker can act through an authenticated browser session under the same authority, audit, approval, and evidence rules that govern every other serious coworker action.

The missing product capability is therefore not "add browser automation." The missing capability is:

> Let a coworker use an authenticated browser surface as a governed means of work, with explicit identity composition, bounded authority, per-action audit, human approval at destructive boundaries, and reusable evidence.

---

## 4. Design Goals

1. Reuse DPF's existing identity, authority, grant, proposal, audit, and evidence substrates.
2. Support multiple browser-driving means behind one `BrowserDriver` contract.
3. Bind every session to a specific `(engine, profile)` and an acting principal.
4. Default autonomous runs to scoped service-account browser profiles, not a human's live profile.
5. Keep operator-live browser driving attended-only.
6. Make side-effecting browser actions impossible without `browser_drive`, an active authority context, and approval where required.
7. Treat web page content as hostile data, not instructions.
8. Capture screenshot/action evidence densely enough for review, replay, and eventual deterministic graduation.
9. Build setup, approval, and evidence review with existing DPF operational UI standards.

## 5. Non-Goals

- No parallel browser-specific credential vault.
- No parallel browser-specific action log.
- No unrestricted autonomous use of the operator's live Chrome profile.
- No arbitrary broad web crawling.
- No bypass of the External Site Access target restrictions.
- No new external browser plugin or dependency without the Tool Evaluation Pipeline.
- No implementation in this spec.

---

## 6. Means Model

The capability defines three means. A means is an adapter behind the `BrowserDriver` interface.

| Means | What it is | Best fit | Identity | Trust posture |
|---|---|---|---|---|
| M1 deterministic | Version-pinned Playwright or recorded/replayed browser-use flow. | Recurring, high-error-cost workflows once proven. | Service account profile. | Highest: fixed action set, no LLM in the act loop. |
| M2 plugin | Adaptive browser driving via browser-use headless profiles, or attended operator-live browser bridge. | New or changing auth-walled sites. | Service account profile for autonomous; operator live profile only when attended. | Medium: LLM in act loop, narrow session policy required. |
| M3 delegated CLI-with-plugin | Parent coworker delegates a bounded browser task to a child CLI agent with a browser plugin. | Stretch cases requiring a specialist child session or operator-style intervention. | Inherited from delegation envelope; child session isolated. | Medium: bounded by parent envelope and child sandbox. |

The capability does not hard-pin one means. A per-task selector chooses by task risk, recurrence, site volatility, identity availability, and evidence requirements.

---

## 7. Decision Record

### Verdict 1 - Substrate shape

Recorded recommendation: `multi-means-wwmd-per-task`.

Use all three means behind one `BrowserDriver` substrate. Select per task. Do not pin a default means in seed or global config.

### Verdict 2 - Reuse vs parallel substrate

Recorded recommendation: `reuse-existing-substrate`.

Reuse `ToolExecution`, `CoworkerActionEnvelope`, `AgentToolGrant`/`TOOL_TO_GRANTS`, `AuthorityBinding`, `DelegationGrant`, `Principal`/`PrincipalAlias`, `IntegrationCredential`, `ToolExecutionReceipt`, and `GearInterface`. Add only the minimum browser-session binding and grant keys needed to make sessions auditable and resumable.

### Verdict 3 - Autonomous profile binding

Recorded recommendation: `dedicated-service-profile-default`.

Autonomous runs bind to a dedicated scoped service-account Chromium profile. Operator-live profile driving is attended-only.

### Verdict 4 - Service-account provisioning

Recorded recommendation: `hybrid-storagestate-default-credentials-where-needed`.

Prefer attended `storageState` capture. Store full credentials only for accounts that truly need unattended re-auth and can safely support it.

### Verdict 5 - Namespaced MCP tool authority

Review-time `principle_decide` recommendation: `existing-grant-map-namespaced-mcp-overlay`, composite 6.467, margin 2.303, high confidence, no commandment conflict.

Implementation must extend the existing grant-map path to cover namespaced MCP tools such as `mcp-browser-use__browse_act`. Do not add a browser-specific side gate as the primary permission model, and do not rely on the External Access pill alone.

---

## 8. Target Architecture

### 8.1 BrowserDriver contract

```ts
type BrowserMeans = "deterministic" | "plugin" | "delegated";
type BrowserProfileKind = "service-account" | "operator-live";

interface BrowserDriver {
  open(input: BrowserOpenInput): Promise<BrowserSessionHandle>;
  read(session: BrowserSessionHandle, query: string): Promise<BrowserReadResult>;
  act(session: BrowserSessionHandle, command: string): Promise<BrowserActResult>;
  screenshot(session: BrowserSessionHandle): Promise<BrowserScreenshotResult>;
  close(session: BrowserSessionHandle): Promise<BrowserCloseResult>;
}
```

The contract owns screenshot-then-replan recovery as a required behavior for M2. For M1, failed deterministic steps must produce enough evidence to decide whether to retry adaptively or mark the deterministic replay stale.

### 8.2 Authority gate: first implementation blocker

Before browser-driving becomes coworker-callable:

1. `TOOL_TO_GRANTS` must include namespaced browser-use tools:
   - `mcp-browser-use__browse_open`: `["browser_read"]`
   - `mcp-browser-use__browse_extract`: `["browser_read"]`
   - `mcp-browser-use__browse_screenshot`: `["browser_read"]`
   - `mcp-browser-use__browse_close`: `["browser_read"]`
   - `mcp-browser-use__browse_act`: `["browser_drive"]`
   - `mcp-browser-use__browse_run_tests`: keep QA-scoped, not general coworker driving. If exposed to coworkers, map to the narrowest read/QA grant, not `browser_drive` by default.
2. `GRANT_IMPLICATIONS` must add `browser_drive: ["browser_read"]`.
3. `getAvailableTools()` must grant-filter discovered MCP server tools before appending them for an agent.
4. `getMcpServerTools()` needs a bundled policy overlay for discovered MCP tool metadata so read tools are not all treated as identical side-effecting actions.
5. `EffectivePermissionsPanel` must stop drifting from the server map. Either update the mirror in the same PR or move to a shared/generated grant map so namespaced MCP tools appear in `/platform/ai/authority`.
6. Tests must prove an agent without `browser_read`/`browser_drive` cannot see or call the namespaced tools even when External Access is enabled.

External Access remains a human session posture. It is not a substitute for coworker grants.

### 8.3 Applied authority

Browser-driving uses existing `AuthorityBinding` and `AuthorityBindingGrant` semantics:

- A route/workspace binding applies the coworker.
- `AuthorityBindingGrant` can narrow `browser_drive` to `require-approval` or `deny` on that resource.
- Effective authority remains the intersection of human capability, intrinsic agent grant, delegation envelope, binding, and runtime controls.
- No browser-specific authorization equation is introduced.

### 8.4 Delegation envelope

Side-effecting browser sessions run under a `DelegationGrant`.

Recommended `scopeJson` shape:

```json
{
  "means": "plugin",
  "targetDomains": ["substack.com"],
  "allowedActionClasses": ["draft", "publish"],
  "profileKind": "operator-live",
  "attended": true,
  "maxActions": 20
}
```

`expiresAt`, `maxUses`, `riskBand`, `workflowKey`, and `objectRef` bound the run. Browser-driving must increment usage at action boundaries that matter, not only at session open.

### 8.5 Destructive-action envelope

Irreversible or outward-facing actions require `CoworkerActionEnvelope` before the final act:

- publish a post;
- submit an RFQ;
- send a message;
- place an order;
- submit a government or compliance form;
- change external account configuration.

The human approves the rendered artifact and target, not a vague instruction. Drafting and read-only extraction do not require an envelope by themselves.

### 8.6 Per-action audit and evidence

Every browser tool call must create or link to a `ToolExecution`.

Conventions:

- `executionMode = "immediate"` for read-only browser_read actions.
- `executionMode = "permission"` for attended operator-live driving while the browser posture is active.
- `executionMode = "proposal"` for the final envelope-gated side effect.
- `capabilityId` identifies the browser-driving capability.
- `delegatingUserId` records the human on whose behalf the action ran.
- `envelopeId` links approved destructive actions.

Screenshot evidence should reuse the existing `browser_evidence` pattern where possible, but browser-driving needs a session-scoped route, not only build-scoped `/api/build/<buildId>/evidence/<fileName>`. First slice can store session screenshots under a browser-session evidence directory and attach a `ToolExecutionReceipt`; it must not expose raw volume paths.

### 8.7 BrowserSessionBinding

Add a thin session binding table unless EP-CTRL's control tables land first. Because EP-CTRL is not implemented today, the browser-driving first slice should own this table and align naming for later convergence.

Required fields:

- `sessionId`
- `means`
- `driverRef`
- `engine`
- `profileRef`
- `profileKind`
- `attended`
- `actingPrincipalId`
- `delegatingUserId`
- `delegationGrantId`
- `credentialId`
- `targetDomains`
- `status`
- `startedAt`
- `closedAt`
- `evidenceDir`
- `selectorDecisionJson` or `meansDecisionJson`

Invariants:

- `profileKind = "operator-live"` is valid only when `attended = true`.
- `profileKind = "service-account"` requires `actingPrincipalId`.
- `targetDomains` is enforced per navigation and per act.
- Actions remain in `ToolExecution`; the session binding is not an action log.

### 8.8 Identity and credentials

Service-account browser profiles resolve through `Principal`/`PrincipalAlias`.

Preferred identity shape:

- `Principal.kind = "service"`
- `PrincipalAlias.aliasType = "service-account"` or a documented browser-specific service-account alias kind if the identity spec standardizes one first.
- The coworker is not modeled as a fake human.
- The human delegate remains visible through `delegatingUserId`.

Credential custody reuses `IntegrationCredential`, but with explicit fit limits:

- `provider = "browser-session"`.
- `fieldsEnc` stores encrypted `storageState` and provisioning metadata, or encrypted username/password/TOTP only when credentialed mode is explicitly selected.
- `tokenCacheEnc`, `lastTestedAt`, `lastErrorAt`, `lastErrorMsg`, and `certExpiresAt` carry health/freshness signals.
- Because `IntegrationCredential.integrationId` is unique, each `(service account, site)` needs either a deterministic integration id such as `browser-session:<principalId>:<siteKey>` or a minimal schema extension that makes the account/site relationship first-class.
- `targetDomains` and `provisioningMode` may be encoded in `fieldsEnc` for slice 1, but if the UI needs filtering/reporting by those fields, they should become first-class columns on the browser session/profile model instead of ad hoc JSON scanning.

No browser-specific vault table is introduced.

### 8.9 Profile persistence

Add a per-install Docker volume:

```yaml
browser-use:
  volumes:
    - browser_evidence:/evidence
    - browser_profiles:/profiles

volumes:
  browser_evidence:
  browser_profiles:
```

Rules:

- The portal never mounts `browser_profiles`.
- The sidecar is the only writer.
- Profiles live under `/profiles/<serviceAccountPrincipalId>/<siteKey>/`.
- The persisted profile is long-lived; individual browser sessions still respect `SESSION_TIMEOUT_SECONDS`.
- Backup/restore and uninstall semantics must be added to the deployment contract wrapper for all install targets. This volume contains impersonation-capable cookies and must be treated as secret material, not ordinary evidence.

### 8.10 Boundary with External Site Access

External Site Access is public, read-only, unauthenticated, and platform-mediated. It provides `search_public_web`, `fetch_public_website`, `analyze_public_website_branding`, and the `web_search` grant.

Browser-driving is authenticated and may be side-effecting. It inherits these External Site Access constraints:

- block localhost;
- block private IP ranges;
- block link-local and metadata endpoints;
- allow only explicit HTTP/HTTPS targets;
- require a visible human posture for external access in attended contexts.

Browser-driving adds:

- `browser_read`;
- `browser_drive`;
- target-domain allowlists per session;
- service-account profile binding;
- destructive-action envelopes.

### 8.11 Boundary with Automated Control Utility

EP-CTRL covers desktop/session automation for managed hosts and defines planned concepts such as `ManagedHost`, `ControlRun`, `ControlSession`, `ControlStep`, `ControlEvidence`, and `ControlPolicy`.

Those are not live Prisma models today. Browser-driving should therefore:

- use the same vocabulary where possible: session, step, evidence, policy;
- add `BrowserSessionBinding` now if needed;
- avoid naming/field choices that would block later convergence;
- revisit convergence once EP-CTRL lands.

Do not block browser-driving on EP-CTRL, but do not fork the language either.

### 8.12 Boundary with marketing execution

Marketing Execution Loop already owns native channel adapters, drafts, approvals, and outbound publication records for API-backed channels.

Browser-driving does not replace native adapters. It fills the auth-walled/no-API gap:

- native LinkedIn/Mailchimp/Postmark paths remain preferred when the API exists and is approved;
- browser-driving handles bounded channels/workflows without usable APIs;
- successful recurring browser workflows can graduate to M1 deterministic scripts or native adapter backlog items.

---

## 9. Service-Account Provisioning

### 9.1 Modes

| Mode | First auth | Re-auth | Secret stored | Use when |
|---|---|---|---|---|
| `storageState` | Operator performs one attended login into the service-account profile. Driver captures Playwright/browser state. | Operator repeats attended login when freshness probe fails. | Session blob only. | Default; MFA/CAPTCHA/high-sensitivity sites. |
| `credentialed` | Operator stores username/password and optional TOTP seed. | Driver logs in programmatically, then refreshes `storageState`. | Full credential/TOTP. | Only for accounts that need unattended operation through expiry and permit programmatic login. |

Playwright's authentication guidance treats stored browser state as sensitive impersonation material. Browser-driving must do the same: never commit it, never mount it into the portal, and never expose it through screenshots or logs.

### 9.2 Setup flow

1. Operator opens Service Account Browser Setup in the platform tools/integrations area.
2. Operator selects target site, service principal, provisioning mode, and target-domain allowlist.
3. Platform opens an attended M2 session on the service account's dedicated Chromium profile.
4. Operator completes login/MFA/CAPTCHA.
5. Driver captures `storageState`, persists profile data under `/profiles`, encrypts credential metadata into `IntegrationCredential`, and records a `BrowserSessionBinding`.
6. Platform probes an authenticated endpoint and stamps health.
7. Setup surface shows status, last tested time, expiry/freshness warnings, and re-auth action.

This is not asking the operator to run commands. It is the irreducible human-auth step.

### 9.3 Expiry and re-auth

- Before autonomous use, the driver probes a known authenticated endpoint.
- Redirect-to-auth means expired.
- `storageState` mode blocks the dependent workflow as `blocked-on-reauth` and notifies the operator.
- `credentialed` mode attempts login once under rate limits, refreshes state, and falls back to the attended path on CAPTCHA/MFA/novel challenge.
- Never loop through failed logins.
- Never silently execute a downstream destructive action after an auth failure.

---

## 10. Operator UX Requirements

### 10.1 Surfaces

The first implementation needs four operational surfaces:

1. Service Account Browser Setup: configure site/account/profile, run attended bootstrap, test freshness, re-auth.
2. Browser Session Ledger: list sessions, means, profile kind, target domains, status, evidence, actor/delegator.
3. Approval Card: show rendered artifact, target site/account, risk band, and exact final action.
4. Evidence Review: step timeline with screenshots, action summaries, errors, and receipt status.

### 10.2 UI rules

- Use report-kit `DataTable`, `FilterBar`, `StatusBadge`, `StatCard`, and `ExportButton` for setup and ledger surfaces.
- Use token-backed colors only. No hardcoded colors.
- Keep audit surfaces dense and scannable.
- Do not create a landing page.
- Do not invent a decorative browser console.
- Do not expose internal tool names as primary user copy. "Browser read", "Browser action", "Needs re-auth", and "Awaiting approval" are acceptable; `mcp-browser-use__browse_act` belongs in details/debug panes only.
- Reuse `/platform/ai/authority` and `/platform/audit/*` as evidence destinations where possible.

### 10.3 Error posture

Do not copy existing legacy unreachable messages that ask the operator to run Docker commands. If the browser-use sidecar is unavailable, the platform should:

- record a platform issue or evidence row;
- show the service status and recovery action in admin terms;
- avoid telling the user to run shell commands.

---

## 11. Security Model

- Page content is hostile input, not instructions.
- `targetDomains` is enforced on every navigation and action.
- Private/internal targets remain blocked unless a future, explicit private-connectivity spec allows them.
- `browser_profiles` contains impersonation material and is secret state.
- Operator-live profiles are attended-only.
- Service-account profiles are least-privilege and per-site where possible.
- Destructive actions require `CoworkerActionEnvelope`.
- New external browser plugins or SaaS drivers require the Tool Evaluation Pipeline.
- Screenshots can contain secrets; evidence routes need auth, path traversal checks, retention policy, and redaction strategy before broad rollout.
- Prompt injection and social-engineering resistance must be verified with hostile-page fixtures before M2 is allowed on high-risk sites.

---

## 12. Research and Benchmarking

### Open-source and framework references

- [browser-use](https://github.com/browser-use/browser-use): confirms the M2 shape: LLM-guided browser automation with persistent browser sessions, CLI support, custom tools, and authentication/profile examples. DPF adopts the self-hosted sidecar but rejects identity-free/session-free operation for coworkers.
- [Playwright authentication](https://playwright.dev/docs/auth): confirms `storageState` as a standard auth-state reuse primitive and warns that browser state can impersonate the account. DPF adopts this for service-account bootstrap and treats it as encrypted secret material.
- [Skyvern](https://github.com/Skyvern-AI/skyvern): confirms the pattern of Playwright plus AI actions, extraction, validation, stored credentials, and livestream/observability. DPF adopts the architecture pattern, not a parallel credential store.
- [LaVague](https://github.com/lavague-ai/LaVague): confirms multi-driver web-agent framing across Selenium, Playwright, and Chrome extension drivers. DPF adopts the driver abstraction lesson.

### Commercial / platform references

- [Microsoft Power Automate attended and unattended automation](https://learn.microsoft.com/en-us/power-automate/guidance/planning/attended-unattended): supports the attended/unattended split and warns against mixing attended and unattended automation on the same machine/session group. DPF maps this to operator-live attended-only versus service-account autonomous profiles.
- Zapier/Make-style automation: validates bounded workflow framing and per-connection credentials, but DPF keeps credentials customer-owned and encrypted in the local install.
- Anthropic computer-use / Claude-in-Chrome style operation: validates the operator-live attended path, but DPF treats it as a high-authority live session that must never become the autonomous default.

### Adopted patterns

- Multiple means behind one interface.
- Stored browser state as sensitive auth material.
- Attended and unattended separation.
- Evidence-first browser automation.
- Service-account identities rather than fake humans.

### Rejected patterns

- Single default browser driver.
- Operator live profile for autonomous work.
- Parallel browser-specific permission system.
- Parallel browser-specific credential vault.
- Opaque screenshots without `ToolExecution`/receipt linkage.

---

## 13. Proving Flow: Substack Publish

1. Operator briefs the Marketing coworker: "Publish this month's newsletter to our channels."
2. Coworker has `browser_drive`; Marketing workspace binding requires proposal for outward publish.
3. Means selector sees no deterministic Substack script and an attended operator-live profile is available. It selects M2 attended.
4. Browser session opens with `profileKind = "operator-live"`, `attended = true`, target domain allowlist, and `executionMode = "permission"` for draft actions.
5. Coworker fills the draft. Screenshot-then-replan handles field merge or page drift.
6. Publish is a destructive outward action. Coworker creates `CoworkerActionEnvelope` with rendered post preview, account/site, and target action.
7. Operator approves.
8. Final click executes with `executionMode = "proposal"` and `envelopeId`.
9. Session closes with evidence receipts.
10. If the workflow recurs, evidence can graduate into an M1 deterministic script or a native channel adapter backlog item.

---

## 14. Implementation Slices

### Slice 0 - Authority blocker

- Add `browser_read` and `browser_drive` to grant catalog/registry flow.
- Add namespaced MCP tool entries to `TOOL_TO_GRANTS`.
- Add `browser_drive -> browser_read` to `GRANT_IMPLICATIONS`.
- Grant-filter discovered MCP tools before returning them from `getAvailableTools()`.
- Add policy overlay for discovered MCP tool `sideEffect`, read/write posture, and execution mode hints.
- Update authority UI mirror/shared map.
- Tests prove external access alone does not expose browser tools.

### Slice 1 - Session and credential substrate

- Add `BrowserSessionBinding`.
- Add service-account identity resolver.
- Add `browser-session` credential discriminator and deterministic integration id strategy.
- Add encryption/freshness helpers.
- Add `browser_profiles` volume and deployment/backup notes.

### Slice 2 - Browser-use profile support

- Extend `services/browser-use/server.py` to open a specific profile/user-data-dir under `/profiles`.
- Add target-domain enforcement.
- Add session evidence directory support beyond build evidence.
- Preserve the current `browse_run_tests` QA behavior.

### Slice 3 - Setup and ledger UX

- Build Service Account Browser Setup.
- Build Browser Session Ledger and evidence review using report-kit.
- Surface re-auth state and blocked workflows.
- Do not expose raw tool names in default operator copy.

### Slice 4 - Substack proving install

- Implement M2 attended flow for Substack draft/publish.
- Prove approval card boundary at Publish.
- Capture end-to-end evidence on a real auth-walled path.

### Slice 5 - Service-account and graduation proofs

- Supplier portal read/procurement proof with service-account profile.
- Dashboard read-only proof with `browser_read`.
- M2-to-M1 graduation path for a recurring supplier workflow.
- M3 delegated proof only after the M2/M1 path is stable.

---

## 15. Verification Requirements

Source-local tests:

- grant mapping for namespaced MCP tools;
- `getAvailableTools()` filters discovered MCP tools by agent grants;
- `GRANT_IMPLICATIONS` expansion for `browser_drive`;
- `BrowserSessionBinding` invariants;
- credential encryption/freshness helpers;
- target-domain enforcement;
- UI tests for setup/ledger states with report-kit primitives.

Runtime-bound verification must run against the canonical local install or a shared local-CI convergence sandbox lease:

- browser-use sidecar health and profile mount;
- service-account attended setup;
- expired-session detection;
- real auth-walled draft path;
- envelope-gated final side effect;
- evidence route access and auth checks;
- no operator-facing instruction asks the user to run shell/Docker commands.

Functional verification is mandatory. A screenshot pile is not enough; the proof must drive a real happy path through login/session composition, action, approval, and evidence.

---

## 16. Backlog Roster

Historical live MCP state on 2026-06-05 (not current delivery coverage):

| BI | Title | Status | Means exercised | Notes |
|---|---|---|---|---|
| `BI-2AED4F15` | Browser-driving capability substrate | `triaging` / Captured | all | Must start with Slice 0 authority blocker. |
| `BI-09781F5F` | Substack-publish browser-driving proving install | `triaging` / Captured | M2 | Motivating attended operator-live case. |
| `BI-95F22C95` | Supplier-portal parts price + lead-time check | `triaging` / Captured | M2 -> M1 | Service-account credential and graduation proof. |
| `BI-91D64AD4` | Ad-network dashboard read | `triaging` / Captured | M2 read-only | Proves `browser_read` without envelope. |
| `BI-2F287A19` | LinkedIn/X cross-channel marketing distribution | `triaging` / Captured | M2/M3 | Stretch case; do after substrate and first proofs. |

These identifiers document the 2026-06-05 planning state only. Current work must resolve against the live backlog; the surviving external-tool authority gap is BI-8B7B2FE9.

---

## 17. Open Questions

1. EP-CTRL convergence: once `ControlSession` exists, should `BrowserSessionBinding` become a specialization or stay a sibling with shared vocabulary?
2. Operator-live transport: should attended M2 use the operator's Claude-in-Chrome bridge, a DPF browser extension, or a portal-hosted bridge? Recommendation for v1: service-account headless first; operator-live attended Substack proof only where the bridge is already available.
3. Credential field shape: encode `targetDomains`/`provisioningMode` in encrypted JSON for slice 1, or add first-class columns now? Recommendation: first-class on `BrowserSessionBinding` and profile/session metadata; encrypted credential payload stores secrets only.
4. Means-selector cache: repeat tasks with a proven M1 script should not pay a full selector decision every run.
5. Default personas: which coworkers receive `browser_read` by default, and which require explicit operator grant for `browser_drive`? Recommendation: no default `browser_drive` until the first proving install passes.
6. Evidence retention/redaction: screenshots from third-party sites may include secrets or PII. Define retention before broad rollout.

---

## 18. Recommendation

Build browser-driving as one governed `BrowserDriver` substrate with three means: deterministic, plugin, and delegated. The first PR must close the namespaced MCP authority gap, then add the thin session/profile bridge and service-account provisioning. Autonomous work uses scoped service-account Chromium profiles; operator-live browser driving is attended-only. All side effects flow through existing delegation, authority binding, `CoworkerActionEnvelope`, `ToolExecution`, and evidence receipts. No parallel vault, no parallel action log, no ambient operator profile automation.
