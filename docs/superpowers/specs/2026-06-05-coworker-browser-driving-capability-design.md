# Coworker Browser-Driving Capability — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | EP-BROWSER-DRIVE — Coworker Browser-Driving Capability |
| **Status** | Draft |
| **Created** | 2026-06-05 |
| **Author** | Claude Code (Opus 4.8) for Mark Bodman |
| **Scope** | Browser-driving as a first-class AI Coworker capability — substrate abstraction, identity/session bridge, audit hook, capability-grant extension. **Scopes** the implementation; does not implement it. |
| **Anchors** | `browser-use` MCP service (`docs/superpowers/specs/2026-04-06-browser-use-integration-design.md`), Coworker authority binding (`2026-04-24-coworker-authority-binding-admin-design.md`), Automated Control Utility (`2026-04-23-automated-control-utility-design.md`), External Site Access (`2026-03-14-external-site-access-design.md`), WWMD kernel (`principle_decide`), MCP tool registry (`McpServer`/`McpServerTool`), audit substrate (`ToolExecution` / `CoworkerActionEnvelope` / `GearInterface`) |
| **Standing procedure** | Per the WWMD-as-procedure rule (2026-06-04), every architect-default decision below was scored through `principle_decide`. Verdicts recorded inline in §3 and §11. Operator may override. |

---

## 1. Problem Statement

DPF's AI Coworkers reach external systems through API-backed MCP tools (Stripe, QuickBooks, GitHub) plus the internal capability registry. But many real-world supplier interactions and marketing-distribution actions have **no stable API** — they live behind auth-walled web UIs: supplier portals, Substack, LinkedIn, X, Medium, ad-network dashboards, permit sites, vendor procurement portals.

A Coworker asked to *"publish this month's customer newsletter to the three channels we have on file"* or *"check the price and lead time for these five parts at our two suppliers"* cannot do it today with the same kernel-gated, audit-recorded, WWMD-scored discipline every other capability ships with.

### 1.1 This is not "add browser automation" — that already exists

Per `dpf-verify-substrate-first`, the substrate was swept before this spec was written. **A browser-automation engine already ships:** the `browser-use` MCP service (landed 2026-04-20, `2026-04-06-browser-use-integration-design.md`) — headless Chromium + an LLM intent layer + Playwright, registered as `McpServer { slug: "browser-use", transport: "http", url: "http://browser-use:8500/mcp" }`, exposing `browse_open / browse_act / browse_extract / browse_screenshot / browse_run_tests / browse_close`.

Three gaps separate that engine from the capability this spec defines:

1. **No identity composition.** `browser-use` runs headless Chromium in a container with *no logged-in session*. It can browse public pages and the internal sandbox; it cannot act as the operator on Substack, because it holds none of the operator's auth. The live thread that motivated this work (transcript `D:/DPF/.claude/notes/wwmd-substack-2026-06-05/`) populated a Substack draft end-to-end *only because* the Claude-in-Chrome browser MCP ran against the operator's already-logged-in browser session. **Authentication is the load-bearing primitive**, and the existing engine has none.
2. **Not under Coworker authority.** `browse_run_tests` is dispatched by an Inngest function (`build/review.verify`) for Build Studio QA — autonomously, not through a Coworker's grants, AuthorityBinding, DelegationGrant, or proposal/envelope gate. There is no `browser_drive` grant key in `TOOL_TO_GRANTS`; a Coworker cannot today be *authorized* to drive a browser the way it is authorized to write the ledger.
3. **One means, not a graspable set.** The engine is a single headless general-purpose driver. The use cases below span a trust/speed/generality spectrum that no single means serves well.

### 1.2 What the motivating thread proved (design anchors)

The Substack thread demonstrated three things this design must honor:

1. **Authentication is load-bearing.** Without the operator's session the draft URL was a redirect-to-auth wall. The capability must *compose with* an identity (operator's, or a delegated machine identity for service accounts) — it must never invent its own.
2. **Browser drivers cost real time per action.** Each type/click/screenshot round-trip is slow versus an API call. Hundreds-of-fields tasks are not the use case; **bounded, high-value workflows** are.
3. **Recovery is a requirement, not an exception.** The first attempt merged the title and subtitle fields; the agent screenshot → clear → retry loop fixed it. The capability must make screenshot-then-replan a first-class loop.

### 1.3 Use cases that drive the design

- **Marketing distribution** — post articles to Substack, LinkedIn, X, Medium; run a campaign across channels from one Coworker brief. (Anchors to `EP-MARKETING-EXEC`, now done — this is the missing *execution* surface for auth-walled channels.)
- **Supplier interaction** — log into supplier portals, check parts availability and lead time, place RFQ, retrieve invoices. Bounded workflows with **high error cost**.
- **Form-filling on public-but-auth-walled sites** — permits, regulatory filings.
- **Reading dashboards** — ad networks, analytics, where no API exists.

---

## 2. The three means (separately-graspable)

The capability does **not** pick one driver. It defines three *means*, each a distinct trust/speed/generality trade-off, and lets a per-task WWMD call pick (see §3, §6). A *means* is an adapter conforming to the `BrowserDriver` interface (§5.1).

| Means | What it is | Speed | Generality | Identity it composes with | Trust posture |
|-------|-----------|-------|-----------|---------------------------|---------------|
| **M1 · Deterministic (Playwright)** | A version-pinned, per-site script (or a recorded-then-replayed `browser-use` session, the "Deterministic replay mode" already named in the 2026-04-06 spec §7). | Fastest | Lowest — needs per-site code | Service machine identity + stored credential | Highest — fixed action set, no LLM in the act loop |
| **M2 · Plugin (general-purpose)** | LLM-driven adaptive driving via the existing `browser-use` MCP service (headless) **or** Claude-in-Chrome against a live logged-in session. Self-healing, screenshot→replan recovery. | Slowest | Highest — any site, no pre-script | Operator's live browser session (Claude-in-Chrome) **or** service identity + stored credential (headless `browser-use`) | Medium — LLM in the act loop; wide action space |
| **M3 · Delegated CLI-with-plugin** | The Coworker delegates "drive this browser to do X" to a child agent (Codex/Claude CLI with a browser plugin) — the same shape as the operator delegating to the motivating thread. | Slow | High | Inherited from the parent delegation envelope; child runs in an isolated session | Medium — bounded by the delegation envelope and child sandbox |

**M2 already half-exists** (the `browser-use` service). M1 is the 2026-04-06 spec's named "deterministic replay" future enhancement. M3 composes the existing CLI-dispatch provider substrate (`project_cli_dispatch_ux`, `project_codex_cli_integration`) with a browser plugin. None require a parallel substrate — see §3 verdict 2.

---

## 3. WWMD verdicts (architect defaults)

Two load-bearing decisions were scored through `principle_decide` (`callingPopulation: external_coding_agent`, `callingSurface: browser-driving-capability-spec`, full kernel / universal ring — these are design-time kernel-architecture calls). Both resolved **high confidence, no commandment conflict**.

### Verdict 1 — Substrate shape

> **Recommendation: `multi-means-wwmd-per-task`** — composite 6.357, margin 2.542, confidence **high**.

The capability defines all three means as separately-graspable behind one `BrowserDriver` substrate; a **per-task WWMD call picks the means at runtime** by the trust/speed/generality trade-off. It does **not** hard-pick a single default.

Rejected: `default-playwright` (3.77), `default-browser-plugin` (3.78), `default-cli-with-plugin` (3.82) — all three single-default options clustered low. Strongest contributors to the winner: *All Changes Land via PR*, *Build Gate*, *DCO* (structured), with *Architecture Over Shortcuts* and *Never Fabricate* materially higher for the multi-means option than any single-default. The kernel reads "commit to one driver" as the shortcut and "graspable means + scored selection" as the architecturally sound path.

This mirrors `no-provider-pinning` for LLMs: just as routing picks the LLM by capability tier per task, browser-driving picks the *means* by trust/speed/generality per task. **No hard pin** in seeds or config.

### Verdict 2 — Reuse vs. parallel substrate

> **Recommendation: `reuse-existing-substrate`** — composite 6.701, margin 3.174, confidence **high**.

Reuse and extend the existing audit/identity/grant substrate (`ToolExecution`, `CoworkerActionEnvelope`, `AgentToolGrant` + `TOOL_TO_GRANTS`, `AuthorityBinding`, `DelegationGrant`, `Principal`/`PrincipalAlias kind=service`, `IntegrationCredential`); add only a **thin browser-session binding record** and a **new grant key**. **No** parallel `BrowserSession`/`BrowserCredentialVault`/`BrowserActionLog` tables, no separate authority path.

Rejected: `parallel-browser-substrate` (3.53). Relevant retrieved core principles: *Audit Existing Schema Before Adding Large Features*, *Principal Convergence*, *Responsible Capacity Utilization*. The kernel reads the parallel substrate as the shortcut. This is `dpf-verify-substrate-first` made quantitative.

### Verdict 3 — Autonomous profile binding

> **Recommendation: `dedicated-service-profile-default`** — composite 6.403, margin 3.408, confidence **high**.

Autonomous / unattended coworker runs bind to a **dedicated scoped service-account profile** (a separate Chromium `user-data-dir` whose cookie jar holds only that service account's provisioned logins, acting as `Principal kind=service`). **Live-operator-profile driving is reserved for human-attended (HITL) runs only.**

Rejected: `live-operator-profile-default` (2.99). The kernel scores driving the operator's own live profile autonomously as a wide-blast-radius shortcut — *Destructive actions require explicit go* and *Architecture Over Shortcuts* both pull hard against it, because that profile carries the operator's **full ambient authority on every site it is logged into**, far beyond the task's intent, and shares one cookie jar + input device with a live human. The motivation for this decision is §4.10. This is the browser analog of least-privilege: a session should act with exactly the identity the task needs, not the broadest one available.

**Everything in §4–§7 and §4.10 below is bound by these three verdicts.**

---

## 4. How it composes with existing substrate

Per Verdict 2, the capability is mostly *wiring*, not new tables. Mapping:

### 4.1 Capability grant — `AgentToolGrant` + `TOOL_TO_GRANTS`

- Add one grant key: **`browser_drive`** (and a read-only sibling **`browser_read`** for dashboard-reading / extraction with no side effects).
- Map the browser means' MCP tools in `TOOL_TO_GRANTS` (`apps/web/lib/tak/agent-grants.ts`):
  - `browse_open`, `browse_screenshot`, `browse_extract`, `browse_close` → `["browser_read"]`
  - `browse_act` (anything that types/clicks/submits) → `["browser_drive"]`
  - M3 delegation tool (`browser_delegate_task`) → `["browser_drive"]`
- Add a `GRANT_IMPLICATIONS` edge: `browser_drive → ["browser_read"]` (driving implies reading), matching the existing one-way, non-transitive `expandGrants()` pattern.
- Default-deny is preserved: until a Coworker holds `browser_read`/`browser_drive`, every browser tool call is denied by the existing `getAvailableTools()` intersection. No coworker gets these grants by seed default except where a persona's job demands it (marketing, procurement).

### 4.2 Applied authority — `AuthorityBinding` + `AuthorityBindingGrant`

- Browser-driving is **resource-scoped**. A binding on a route/workspace (e.g. the Marketing workspace) names the applied coworker and an `approvalMode`. `AuthorityBindingGrant` can **narrow** `browser_drive` to `require-approval` on a given resource without touching the intrinsic grant — exactly the monotonic-narrowing rule from `2026-04-24-coworker-authority-binding-admin-design.md` §"Effective authority rule".
- The effective-authority intersection already evaluates: `humanPolicy ∩ intrinsicAgent ∩ delegationEnvelope ∩ binding ∩ runtimeTAKControls`. Browser-driving slots in with **no new term** — `browser_drive` is just another `actionKey`.

### 4.3 Per-act envelope — `DelegationGrant`

- An authenticated browser session that will take side effects (post, submit RFQ, publish) runs under a `DelegationGrant` — it already carries `scopeJson`, `riskBand`, `validFrom`, `expiresAt`, `maxUses`, `workflowKey`. A browser-driving session maps cleanly: `scopeJson` = {means, target domain(s), allowed action classes}, `maxUses` = action budget, `expiresAt` = session TTL. This is the durable record of "the operator delegated *this* browser task, under *these* limits, until *then*."

### 4.4 Destructive-action gate — `CoworkerActionEnvelope`

- Any **outward-facing, hard-to-reverse** browser action (publish a post, submit an RFQ, send a message, place an order) is a destructive action under `destructive-actions-require-explicit-go` (commandment tier). It proposes a `CoworkerActionEnvelope` (`status: proposed → approved → executed`), carrying `manifestActionId`, `argsJson` (the rendered post / form payload), `rationale`, `delegatingUserId`, `threadId`. The human approves the *rendered artifact* (what will be posted) before bytes leave.
- **Reading** a dashboard or **drafting** (the Substack thread only populated a draft — it did not hit Publish) does **not** require an envelope. The boundary is the irreversible outward action, consistent with the Pseudo-User Contract §6.4/§8 that `CoworkerActionEnvelope` already implements.

### 4.5 Per-action audit — `ToolExecution`

- Every browser tool call already writes a `ToolExecution` row (`toolName`, `agentId`, `userId`, `parameters`, `result`, `success`, `executionMode`, `routeContext`, `durationMs`, `delegatingUserId`, `chatMessageId`, `envelopeId`, `capabilityId`). Browser-driving inherits this for free. Two conventions:
  - `executionMode`: `immediate` for `browser_read`; `proposal` for `browser_drive` side effects (envelope-gated); `permission` when the means is M2-Claude-in-Chrome against the operator's live session (the operator must have the "external/browser on" posture active, mirroring the External Site Access "External On" pill).
  - `capabilityId` is set to the browser-driving capability so the authority surface (`/platform/ai/authority`) and `GearInterface` can roll it up.
- **Evidence**: the screenshot-per-step evidence path already built for `browse_run_tests` (`/evidence/<dir>/<i>.png` on the `browser_evidence` volume, served auth-gated via `/api/build/<id>/evidence/...`) is reused. A driven session's screenshots are its `evidence_density` — the same dynamic-analysis evidence the platform already trusts (`feedback_dynamic_analysis_is_evidence`).

### 4.6 Capability transmission — `GearInterface`

- When a browser-driving session graduates a capability (e.g. a proven Substack-publish workflow that can be promoted to a deterministic M1 replay, or contributed to the hive), it emits a `GearInterface` record (`shaftSourceType: "tool-execution"`, `capabilityName: "browser-drive.<workflow>"`, outcome `transmission`/`graduation`). This is how a one-off M2 adaptive run becomes a reusable M1 script — the ring-transmission substrate already models exactly this.

### 4.7 Identity / session bridge — the one genuinely new (thin) piece

This is the only place new storage is justified, and it is deliberately minimal (Verdict 2):

- **Service machine identity** for M1/headless-M2: a `Principal { kind: "service" }` with a `PrincipalAlias` (the convergence target already enumerates `ServiceAccount`; `Principal.kind = service` already exists). The browser session acts *as* this principal, and the human who delegated is captured in `ToolExecution.delegatingUserId` — preserving "act-for" attribution without modeling the coworker as a fake human (the authority-binding spec's explicit non-goal).
- **Credential composition**, by means:
  - **M2 · Claude-in-Chrome** → composes with the **operator's live browser session**. No credential is stored by DPF at all — the session *is* the operator's. This is the lowest-storage, highest-trust-context path and the one the motivating thread used. The "browser on" posture is an explicit, revocable, session-scoped operator opt-in (reuse the External Site Access pill pattern).
  - **M1 / headless-M2 / M3** → a service account needs stored credentials. **Reuse `IntegrationCredential`** (already the OAuth/provider credential home) extended with a `browser-session` credential kind (cookie jar / storage-state blob / username-password under the existing encryption-at-rest path). **No new `BrowserCredentialVault`.**
- **Session binding record** (the one new table): `BrowserSessionBinding` — a thin join recording an active or completed driven session: `{ sessionId, means (M1|M2|M3), driverRef, engine (chromium|safari|firefox), profileRef, profileKind (operator-live|service-account), attended (bool), actingPrincipalId, delegatingUserId, delegationGrantId?, credentialId?, targetDomains[], status (active|closed|failed), startedAt, closedAt, evidenceDir }`. The `engine` + `profileRef` pair is **load-bearing** (§4.10): authentication is a property of a profile's cookie jar, not "the browser," so a session must bind to a specific `(engine, profile)`, never to "the browser" generically. `profileKind` + `attended` encode Verdict 3 — `operator-live` profiles are only valid when `attended = true`. It exists so a session is **auditable and resumable** (the 2026-04-06 spec flagged "no table tracks session lifecycle" as the gap), and does **not** duplicate the action log — actions live in `ToolExecution`, keyed by `sessionId`. Consider modeling it as a specialization of the Automated Control Utility's proposed `ControlSession` (§4.8) rather than a sibling, if EP-CTRL lands first.

### 4.8 Boundary with EP-CTRL-5E21A4 (Automated Control Utility)

EP-CTRL (`2026-04-23-automated-control-utility-design.md`) covers **Windows desktop/session automation** (structured UI automation + vision fallback) for managed sandbox/install hosts — `ManagedHost / ControlRun / ControlSession / ControlStep / ControlEvidence / ControlPolicy`. Browser-driving is the **browser-surface sibling**: same session/step/evidence/policy *shape*, different surface (a web page, not a desktop). The two should **share the session/evidence/policy vocabulary** (so `BrowserSessionBinding` is a `ControlSession` variant, browser steps are `ControlStep`s, screenshots are `ControlEvidence`) rather than fork it. If EP-CTRL has not landed when browser-driving implements, browser-driving defines the thin record itself and notes the convergence as tech debt. **Flagged as Open Question Q1.**

### 4.9 Boundary with External Site Access (`2026-03-14`)

External Site Access (`search_public_web` / `fetch_public_website` / `analyze_public_website_branding`, `web_search` grant) is **read-only, unauthenticated, platform-as-intermediary** — the platform fetches and normalizes; the coworker never drives. Browser-driving is its **authenticated, side-effecting successor** — the very "Phase 3+" that spec deferred. The SSRF protections (block localhost/private IPs/non-HTTP) and the per-session "External On" pill from that spec are **inherited**, not re-invented. `browser_read` is the bridge grant between the two.

### 4.10 Session & profile binding (how a driver actually reaches an authenticated session)

This is the architecturally load-bearing mechanism, and the place a natural assumption is wrong. "DPF runs in a browser, so it can act as the sessions logged into that browser" is **false at the page layer.** The portal is a web page at `localhost:3000`, sandboxed by the **same-origin policy**: its JavaScript has zero access to other tabs/windows, to cross-origin DOM, or to the cookies/sessions of `substack.com` or any other origin. If that weren't true, every site you visit could silently drive your logged-in bank. **The portal page can never be the thing that drives an external authenticated site.**

Driving happens through a **privileged out-of-page channel** at a layer above the page sandbox. Three mechanism classes exist, mapping onto the three means:

| Bridge mechanism | Privilege model | Session it uses | Means |
|---|---|---|---|
| **Browser extension** (Claude-in-Chrome) | Runs in the browser's privileged extension context (user-granted host/tabs/scripting permissions), not the page sandbox. Models multiple attached browsers (`list_connected_browsers`, `select_browser`, `tabs_*`). | Whatever the **attached profile** is logged into | M2 (attended) |
| **CDP / remote-debug** (Playwright, headless `browser-use`) | External process attaches to a browser launched on a known `user-data-dir` / debug port | The cookie jar in **that profile's `user-data-dir`** | M1, M2-headless, M3 |
| **OS-level** (computer-use) | Synthetic input + screenshots at the desktop layer | Whatever is on screen — but browsers are **"read" tier** (observe only, cannot click/type) | recovery/observation only |

This is precisely why the motivating Substack thread worked: it was **Claude-in-Chrome (a privileged extension) attached to the operator's Chrome profile**, driving a tab in that profile that already held the Substack login — not the portal scripting across tabs. "Other browser windows" are reached by the *driver selecting which connected browser/profile to act on*, never by the page.

**The load-bearing primitive is the profile, not the browser.** Authentication is a property of a browser **profile** (a cookie jar / `user-data-dir`), so:

- A session binds to a specific **`(engine, profile)`** pair (the new `BrowserSessionBinding.engine` + `profileRef` fields, §4.7), explicitly — never to "the browser."
- **Cross-browser is genuinely heterogeneous.** Chromium (Chrome/Edge) supports CDP + extensions — the only first-class drivable surface. Safari has no CDP (`safaridriver`/AppleScript only, macOS-only). Firefox uses its own protocol. **Architectural constraint: standardize the driven surface on a Chromium profile; treat Safari/Firefox as computer-use-observation-only fallbacks.** The means abstraction carries an `engine` target and must not assume the operator's everyday browser is drivable.

**Attended vs. unattended is a first-class design axis (Verdict 3):**

- **Attended — M2 on the operator's live profile (`profileKind: operator-live`, `attended: true`).** Highest trust context; DPF stores no credential because the session *is* the operator's. But the coworker now shares one cookie jar + input device with a live human (input collisions) and inherits the operator's **full ambient authority on every logged-in site** — far wider than the task. Acceptable only human-in-the-loop.
- **Unattended — dedicated service-account profile (`profileKind: service-account`, `attended: false`).** A separate Chromium `user-data-dir` whose cookie jar holds only the service account's provisioned logins (`Principal kind=service`, §4.7). No human shares it; scope is bounded to exactly the provisioned sites; credentials are scoped + expiring via `DelegationGrant`. **This is the default for any autonomous run** — the browser analog of least-privilege. You never point an autonomous coworker at the human's live profile.

---

## 5. Substrate interfaces

### 5.1 `BrowserDriver` interface (the abstraction the Coworker reaches for)

One TypeScript interface (`apps/web/lib/browser-drive/driver.ts`) that all three means implement. The Coworker — and the per-task WWMD selector — depend only on this, never on a concrete means.

```ts
interface BrowserDriver {
  readonly means: "M1-deterministic" | "M2-plugin" | "M3-delegated";
  open(input: OpenInput): Promise<SessionHandle>;     // → BrowserSessionBinding row
  act(session: SessionHandle, task: NLTask): Promise<ActResult>;   // type/click/navigate; LLM-adaptive for M2
  read(session: SessionHandle, query: NLQuery): Promise<Extracted>; // browser_read; no side effects
  screenshot(session: SessionHandle): Promise<EvidenceRef>;        // recovery primitive
  close(session: SessionHandle): Promise<SessionEvidenceBundle>;
}
```

- `act` is the **recovery loop owner**: on an ambiguous/failed action it screenshots, re-reads page state, and replans (the title/subtitle merge fix). This is a capability requirement (§1.2.3), enforced as an interface contract, not left to each means.
- M1's `act` is constrained to a fixed recorded action set (no LLM in the loop); M2's `act` is the adaptive LLM driver; M3's `act` forwards the NL task to the delegated child agent.

### 5.2 Per-task means selector (the runtime WWMD call)

When a Coworker invokes the browser-driving capability for a task, the selector runs a scoped `principle_decide` (`callingSurface: "browser-drive-means-select"`) scoring the three means with **task-derived features**, e.g.:

- `blast_radius` ← does the task take outward side effects? (publish/submit pull M1↑ for determinism, M2↓)
- `speed_to_value` / `capacity_utilization` ← is a per-site script already recorded? (M1↑) or a novel site? (M2↑)
- `data_privacy` ← does the task need the operator's live session? (M2-Chrome) or a service account? (M1/headless)
- `reusability` ← is this a recurring channel worth a deterministic script? (M1↑)

The selector returns the means + the per-principle ledger; the ledger is surfaced to the operator (the `dpf-decision-via-kernel` contribution-ledger pattern) and recorded on the `BrowserSessionBinding`. A novel auth-walled site with no script defaults toward **M2**; a recurring high-error-cost supplier portal graduates toward **M1** as it proves out (via the §4.6 `GearInterface` transmission). This *is* the no-provider-pinning principle applied to browser means.

---

## 6. End-to-end flow (Substack-publish, the proving case)

1. Operator briefs the Marketing coworker: *"publish this month's newsletter to our three channels."* Coworker holds `browser_drive` (granted on the Marketing persona); the Marketing-workspace `AuthorityBinding` sets `approvalMode: proposal-required`.
2. For the Substack channel, the **means selector** scores M1/M2/M3. No recorded Substack script exists; the operator is logged into Substack in their browser → selector picks **M2 · Claude-in-Chrome**, ledger surfaced.
3. Coworker opens a session → `BrowserSessionBinding` row (`means: M2-plugin`, `actingPrincipal`: operator's session context, `delegatingUserId`: operator). `executionMode: permission` (operator's "browser on" posture must be active).
4. Coworker `act`s: navigate to new-draft, fill title, fill subtitle, paste body. On the title/subtitle merge, the `act` recovery loop screenshots → clears → retries. Each step → `ToolExecution` + screenshot evidence under the session's `evidenceDir`.
5. **Draft is populated. Publish is a destructive outward action** → Coworker proposes a `CoworkerActionEnvelope` with `argsJson` = the rendered post preview + the publish target. The operator approves the artifact. Only then does `act("click Publish")` run, as `executionMode: proposal` linked to the envelope.
6. `close` returns the evidence bundle. The proven workflow can later be recorded as an **M1 deterministic** Substack-publish script and emitted as a `GearInterface` `graduation` for reuse / hive contribution.

Every step is grant-gated, binding-scoped, envelope-gated at the irreversible boundary, and `ToolExecution`-audited — the same discipline every other capability ships with. **Nothing here is browser-specific machinery; it is the existing machinery pointed at a browser means.**

---

## 7. Research & Benchmarking

Per AGENTS.md §10. Compared against open-source leaders and commercial products (data models / auth models, not feature lists).

### Open-source / framework leaders

- **browser-use** (MIT, https://github.com/browser-use/browser-use) — already adopted as M2's headless engine (2026-04-06 spec). Data model: in-memory `Agent` + `Browser` session, action history list, no persistent identity. **Adopted**: LLM-intent driving, screenshot→replan recovery, the deterministic-replay-export idea (→ M1). **Rejected as-is**: its sessionless, identity-free model — DPF binds every session to a `Principal` + `DelegationGrant`.
- **Playwright** (Apache-2.0) — the deterministic engine under M1 and under browser-use. Its `storageState` (cookie/localStorage blob) is exactly the **credential composition** primitive M1/headless-M2 need — DPF stores it as an `IntegrationCredential` of kind `browser-session`, encrypted at rest. **Adopted**: `storageState` as the auth-composition format. **Anti-pattern identified**: Playwright's per-site selector scripts rot on UI change — which is *why* M1 is gated behind "recurring + high-error-cost", not the default.
- **Skyvern / LaVague (auth-walled web automation, open-source)** — both layer an LLM over Playwright for form-filling on sites you don't control. Their models confirm the M2 shape. **Anti-pattern**: both store site credentials in a bespoke vault with weak auth scoping — DPF explicitly rejects a parallel vault (Verdict 2) in favor of `IntegrationCredential` + `DelegationGrant` scoping.

### Commercial products

- **Microsoft Power Automate (Desktop) + Entra workload identities** — RPA flows run *as a workload identity*, not a fake user; conditional-access policies still bind them. **Adopted** (already adopted by the authority-binding spec): coworker-as-workload-principal, same authority plane as humans, distinct lifecycle. Browser-driving's service `Principal kind=service` is the DPF analog.
- **Zapier / Make "no-API" web steps** — bounded, recorded, replayable web actions with per-connection stored auth. **Adopted**: bounded-workflow framing (not hundreds-of-fields), per-connection credential. **Rejected**: their opaque "we hold your password" model — DPF prefers operator-session composition (M2-Chrome) where possible and scoped, expiring `DelegationGrant`s where not.
- **Anthropic Computer Use / Claude-in-Chrome** — the M2-Chrome and M3 substrate itself. **Adopted**: operator-session composition as the highest-trust-context path; delegated child-agent driving as M3. **Constraint inherited**: per-action cost is real → bounded workflows, WWMD gating cheap means first.

### Gaps this design fills

No surveyed system unifies (a) multiple driving means behind one selectable substrate, (b) per-action governance via a shared kernel + audit trail, and (c) identity composition that reuses an enterprise authority plane rather than a bespoke credential vault. That tri-fold is the DPF differentiator and the reason this is a capability spec, not a tool adoption.

---

## 8. Security considerations

- **SSRF / target allow-listing** inherited from External Site Access — block localhost/private IPs/non-HTTP; `targetDomains[]` on the `BrowserSessionBinding` bounds where a session may navigate, enforced per `act`.
- **Credential blast radius** — operator-session means (M2-Chrome) stores nothing. Service-account means store `storageState`/credentials as encrypted `IntegrationCredential`s scoped to specific domains and bounded by `DelegationGrant.maxUses`/`expiresAt`. A leaked session binding cannot widen scope (monotonic-narrowing rule).
- **Destructive-action gate** — irreversible outward actions are envelope-gated; the human approves the rendered artifact, not a vague intent. No silent publish/submit.
- **External MCP / tool eval** — any *new* external browser plugin or npm dependency (e.g. a new M3 CLI plugin) passes the Tool Evaluation Pipeline (EP-GOVERN-002) before adoption. The existing `browser-use` service is already in-tree.
- **Prompt-injection on driven pages** — a driven page is hostile input; the `act` LLM (M2) must treat page text as data, not instructions. M2 driving runs with a constrained tool surface and never escalates its own grants from page content (mirrors the mechanism-question grounding discipline).

---

## 9. What this spec deliberately does NOT do

- Does **not** implement any means — it scopes them as follow-on BIs (§10).
- Does **not** create parallel browser substrate (Verdict 2).
- Does **not** pin a default means (Verdict 1).
- Does **not** define how Claude-in-Chrome is wired into the in-portal coworker runtime at the transport level — that is M2-Chrome's implementation BI.
- Does **not** settle the EP-CTRL convergence (Open Question Q1).

---

## 10. Backlog roster (filed from this thread)

One **substrate BI** (the abstraction + identity bridge + audit wiring + grant extension) and a roster of **proving-install BIs** (each a concrete bounded workflow that exercises and hardens the substrate). All under **EP-BROWSER-DRIVE**. Filed via `create_backlog_item`; IDs recorded in §12 after filing.

| BI | Title | Means exercised | Why this proving case |
|----|-------|-----------------|----------------------|
| **Substrate · BI-2AED4F15** | Browser-driving capability substrate: `BrowserDriver` interface, identity/session bridge, audit hook, `browser_drive`/`browser_read` grants | all | The reusable foundation §4–§5 |
| **P1 · BI-09781F5F** | Substack-publish browser-driving proving install (M2-Chrome) | M2 | The motivating thread; operator-session composition + envelope-gated publish |
| **P2 · BI-95F22C95** | Supplier-portal parts price + lead-time check proving install | M2 → M1 | High-error-cost bounded workflow; service-account credential; M1 graduation path |
| **P3 · BI-91D64AD4** | Ad-network dashboard read proving install (`browser_read`) | M2 read-only | No-API dashboard reading; read grant boundary; no envelope |
| **P4 · BI-2F287A19** | LinkedIn/X cross-channel marketing distribution proving install | M2/M3 | Multi-channel campaign; M3 delegated-child driving |

(P4 is the stretch case validating M3 delegation; P1–P3 validate M1/M2 and the read/drive/envelope boundaries.)

---

## 11. Open questions

1. **Q1 — EP-CTRL convergence.** Should `BrowserSessionBinding` be a specialization of the Automated Control Utility's `ControlSession`, or a sibling? Recommendation: specialize *if* EP-CTRL lands first; otherwise define thin and converge later as tracked debt. (Needs an architect call once EP-CTRL implementation status is known.)
2. **Q2 — M2 transport (parts b/c resolved by Appendix A; part a open).** Verdict 3 settled the policy and **Appendix A** now settles provisioning (b) and storage location (c). The remaining open part: **(a)** how does an *in-portal* coworker reach the operator's live profile for *attended* runs — the operator's own Claude-in-Chrome extension, or a portal-hosted bridge? Recommendation for v1: headless `browser-use` on service-account profiles for autonomous (fully specced); defer attended operator-live driving to a fast-follow.
3. **Q3 — Credential kind on `IntegrationCredential` (resolved by Appendix A).** Confirmed: `storageState` fits `IntegrationCredential.fieldsEnc` (encrypted JSON blob via `credential-crypto.ts`, keyed by `CREDENTIAL_ENCRYPTION_KEY`) with `provider = "browser-session"` as the discriminator; `tokenCacheEnc` / `lastTestedAt` / `lastErrorAt` carry session-freshness signals. No schema strain; no new credential table. See Appendix A §A.3.
4. **Q4 — WWMD selector latency.** A per-task `principle_decide` adds a round-trip before each browser task. Acceptable for bounded high-value workflows; confirm it is cached/short-circuited for repeat tasks on the same target (e.g. a recorded M1 script skips selection).
5. **Q5 — Default grant assignment.** Which seeded personas get `browser_read` vs `browser_drive` by default (marketing, procurement), and which require explicit operator grant? Per `bundled-services-active-by-default` vs the high blast radius of `browser_drive`.

---

## 12. Decision record + filed work

- **WWMD Verdict 1** (substrate shape): `multi-means-wwmd-per-task`, composite 6.357, margin 2.542, high confidence, no commandment conflict. `governingProfile: mark-dpf-platform`.
- **WWMD Verdict 2** (reuse vs parallel): `reuse-existing-substrate`, composite 6.701, margin 3.174, high confidence, no commandment conflict.
- **WWMD Verdict 3** (autonomous profile binding): `dedicated-service-profile-default`, composite 6.403, margin 3.408, high confidence, no commandment conflict. Autonomous runs bind a scoped service-account profile; operator-live profiles are attended-only. (Added 2026-06-05 after the operator raised the cross-tab / cross-browser session-reach question.)
- **WWMD Verdict 4** (service-account first-auth / re-auth): `hybrid-storagestate-default-credentials-where-needed`, composite 6.250, margin 0.581, high confidence, no commandment conflict. Prefer attended `storageState` capture; store full credentials only for accounts that need unattended re-auth. (`attended-storagestate-only` was a close runner-up at 5.669 — it edges ahead on `data_privacy`/`blast_radius` and is the conservative fallback for high-sensitivity accounts.) Detailed in Appendix A.
- **Epic**: EP-BROWSER-DRIVE (created 2026-06-05, this spec linked as `specPath`).
- **Filed BIs**: BI-2AED4F15 (substrate), BI-09781F5F (P1 Substack/M2), BI-95F22C95 (P2 supplier/M2→M1), BI-91D64AD4 (P3 dashboard read), BI-2F287A19 (P4 cross-channel/M3) — all linked to EP-BROWSER-DRIVE, `proposedOutcome: build`, awaiting Scrum Master triage (linking is organizational only; not yet triaged or promoted).

---

## 13. Recommendation

Build browser-driving as **one `BrowserDriver` substrate with three separately-graspable means** (deterministic / plugin / delegated), selected **per-task by a scoped WWMD call**, each session bound to a specific **`(engine, profile)`** — autonomous runs to a scoped **service-account profile** (`Principal kind=service`), operator-live profiles **attended-only** (Verdict 3) — driven through a privileged out-of-page channel (extension or CDP), never the sandboxed portal page, and **reusing the existing grant / authority / delegation / envelope / `ToolExecution` / `GearInterface` substrate** — adding only a new grant key, the `TOOL_TO_GRANTS` wiring, an `IntegrationCredential` browser-session kind, and a thin `BrowserSessionBinding` record. Service-account profiles are provisioned by **hybrid `storageState`-first capture** (Verdict 4, Appendix A), persisted on a per-install `browser_profiles` volume. Prove it with the Substack-publish install first (M2-Chrome), then graduate the recurring high-error-cost supplier workflow toward a deterministic M1 script. This gives Coworkers real reach into the auth-walled web with the same kernel-gated, audited, WWMD-scored discipline as every other capability — and no parallel machinery.

---

## 14. Appendix A — Service-account profile provisioning (Q2b/c + Q3 resolution)

Resolves how an autonomous service-account profile (Verdict 3) is first authenticated and re-authenticated. Decision: **Verdict 4 — `hybrid-storagestate-default-credentials-where-needed`** (margin 0.581; `attended-storagestate-only` close behind at 5.669 and the conservative fallback for high-sensitivity accounts). All facts below are grounded against the live tree (`docker-compose.yml`, `schema.prisma`, `credential-crypto.ts`).

### A.1 Per-site provisioning modes

Each `(service-account, target-site)` pair records one **provisioning mode** on the credential. Default to the least-secret-storage mode that meets the account's autonomy need:

| Mode | First-auth | Re-auth on expiry | When to use | Secret stored |
|------|-----------|-------------------|-------------|---------------|
| **`storageState` (default)** | Operator does a **one-time attended login** in an M2 session; the driver captures Playwright `storageState` (cookies + localStorage) at session end. | Operator is **notified** (agent-as-conduit) to repeat the one-time login when freshness signals go stale. | Most accounts; anything MFA/CAPTCHA-guarded; high-sensitivity. | Session blob only — **never the password**. |
| **`credentialed` (opt-in)** | Operator stores username/password (+ optional TOTP seed) once. | Driver logs in **programmatically** each time the session expires — fully unattended. | Accounts that *must* run unattended through expiry and permit programmatic login. | Full credentials + TOTP seed. |

The mode is a per-credential field, not a global switch — the hybrid is realized as a column, so a marketing Substack account can be `storageState` while a supplier API-less portal that expires nightly is `credentialed`, in the same install.

### A.2 Provisioning flow (the attended bootstrap)

1. Operator opens a **Service Account Browser Setup** admin surface, picks the target site and the service `Principal`.
2. The platform launches an **attended M2 session** on the service account's dedicated Chromium `user-data-dir` (not the operator's profile). The operator logs in (handling MFA/CAPTCHA themselves — the one thing automation cannot reliably do).
3. On confirmation, the driver exports `storageState` → encrypted into `IntegrationCredential.fieldsEnc`, and the populated `user-data-dir` persists on the `browser_profiles` volume (§A.4).
4. The credential's `status` flips to `configured`; `lastTestedAt` is stamped. A `targetDomains[]` allowlist is recorded so the profile can only be driven against the site it was provisioned for.

This is the **only** step that asks the operator to act — and it is exactly the irreducible "a human must log in once" step, consistent with `never-ask-user-to-run-commands` (the agent does everything *around* the unavoidable human auth, never shell/SQL busywork).

### A.3 Storage (Q3 resolved)

No new credential table (Verdict 2 holds):

- **`IntegrationCredential`** with `provider = "browser-session"`. `fieldsEnc` holds the encrypted `storageState` JSON (or, in `credentialed` mode, the encrypted username/password/TOTP-seed), via the existing `credential-crypto.ts` `encryptJson` path keyed by `CREDENTIAL_ENCRYPTION_KEY` (the same key the `adp` service already consumes).
- **Freshness signals** reuse existing columns: `tokenCacheEnc` for a cached probe result, `lastTestedAt` / `lastErrorAt` / `lastErrorMsg` for the staleness/health surface, `certExpiresAt` (or a `fieldsEnc` field) for a known session-cookie expiry where the site exposes one.
- `BrowserSessionBinding.credentialId` FKs to this row; `BrowserSessionBinding.profileRef` names the `user-data-dir`.

### A.4 Where profiles live (Q2c resolved)

A new per-install named Docker volume **`browser_profiles`**, mounted into `browser-use` exactly as the proven `browser_evidence` volume is:

```yaml
# docker-compose.yml — browser-use service (sibling of browser_evidence)
volumes:
  - browser_evidence:/evidence
  - browser_profiles:/profiles      # service-account user-data-dirs, one subdir per (account, site)
```

Each `user-data-dir` is `/profiles/<serviceAccountId>/<siteKey>/`. The volume is **never** mounted into the portal (unlike `browser_evidence`, which the portal mounts read-only to serve screenshots) — profile cookie jars are driver-only. Note `browser-use`'s existing `SESSION_TIMEOUT_SECONDS: 600`: a *driving session* is ephemeral (10 min), but the *persisted profile* on the volume outlives it — that separation is what makes "log in once, drive many times" work.

### A.5 Expiry detection + re-auth loop

- Before an autonomous run, the driver opens the profile and probes a known authenticated endpoint. **Redirect-to-auth ⇒ session expired** (this is the exact failure the motivating thread hit when no session was present).
- `storageState` mode → emit a **re-provision notification** through the agent event bus (agent-as-conduit), pause the dependent workflow as `blocked-on-reauth`, and resume when the operator re-bootstraps. Never silently fail a downstream destructive action on a dead session.
- `credentialed` mode → the driver runs the programmatic login, refreshes `storageState`, stamps `lastTestedAt`. If login fails (CAPTCHA/novel MFA), it **falls back to the `storageState` notification path** rather than looping — degrade to attended, never brute-force.

### A.6 Security notes specific to provisioning

- A `browser-session` credential is **scoped to `targetDomains[]`** and bounded by the governing `DelegationGrant` (`maxUses`/`expiresAt`); a stolen `storageState` blob cannot widen scope (monotonic-narrowing rule, §4.2).
- `credentialed` mode is **opt-in per account** precisely because it stores the password — the higher-blast-radius choice the operator must consciously elect, surfaced as such in the setup UI (this is why Verdict 4 beat `stored-credentials-only`, which would have made it the default).
- Profiles never co-mingle: one `user-data-dir` per `(service account, site)` means a compromise of one site's cookie jar does not expose another.
