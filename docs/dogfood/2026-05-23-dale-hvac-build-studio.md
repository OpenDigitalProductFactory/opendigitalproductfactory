# 2026-05-23 — Dale (HVAC owner) dogfood of Build Studio

**Persona.** Dale, 52, owns a 4-truck HVAC repair shop. 25 years in the trade.
Types with two fingers. Has never opened a terminal. Calls every tool an "app."
Wants ONE thing today: build "Truck Stock Tracker" so his guys stop driving
back to the warehouse for parts.

**Method.** Drive the live portal at `http://localhost:3000` via Claude-in-Chrome.
Every click is a click Dale would actually make. Every confusion gets logged.
Don't fix mid-flow — capture, label, triage at the end (or file BI if larger).

**Context correction (mid-session).** The portal was already set up with a
non-HVAC archetype (looks like the DPF-platform-itself archetype). That
relaxes the "fresh-install onboarding" deficiencies D2, D3, D4, D6 — they
remain real for a cold install but aren't in scope for this dogfood run.
The persona stays useful as "non-technical user dropped into Build Studio on
this configured portal" — D5 onward all still apply.

**Severity scale.**
- **S0 quit** — Dale closes the laptop and calls the salesperson back.
- **S1 stuck** — Dale stares at the screen, doesn't know what to do next.
- **S2 wrong** — Dale clicks something, gets a bad outcome, doesn't know why.
- **S3 friction** — Dale gets through it but mutters something.

---

## Deficiencies log

### D1 — Front-door tile labels don't include "I'm here to build" — S2 wrong
`/welcome` shows "Customer Portal" vs "Employee & Admin." Dale, the shop
owner who wants to *build* something, has no obvious door. He's not a
"customer" yet (no purchase), and "Employee & Admin" sounds like HR plumbing.
He'd guess wrong, land in Customer Portal, dead-end, click back. 30 seconds
and a moment of "is this for me?" doubt before he gets going.
- Repro: open `http://localhost:3000` on a fresh session.
- Triage: small label rework or a third tile ("Owner / Builder"). **Fix-now candidate.**

### D2 — `/login` (Employee/Admin side) has no signup or first-time hint — S1 stuck
Customer side has "New customer? Create an account" on `/welcome`. Employee
side just dumps Dale on `/login` with email+password fields. No "first time
setup?" link, no "your installer-generated admin credentials are in `.env`"
banner. On a fresh install Dale has no way to know how to get in.
- Repro: click "Employee & Admin" tile on `/welcome` from a fresh install.
- Triage: **BI** — fresh-install onboarding affordance.

### D3 — Seeded admin credentials live only in source/`.env` — S0 quit (CRITICAL)
[`packages/db/src/seed.ts:546-562`](../../packages/db/src/seed.ts) hardcodes
`admin@dpf.local` / `changeme123` (or `$env:ADMIN_PASSWORD`). The installer
writes a strong random password into [`D:/DPF/.env`](D:/DPF/.env:10) but
nothing in the portal UI surfaces this. Dale wouldn't think to open a `.env`
file. If install scrollback is gone, he's locked out of his own install.
Also: default-password-with-no-forced-rotation is a security smell for any
public install.
- Repro: complete a fresh `setup.ps1`, close the terminal, attempt to log in.
- Triage: **BI** — installer "welcome card" + forced password rotation on first
  successful login, with credentials shown on a `/first-run` route protected
  by an installer-issued one-time token.

### D4 — Workspace landing assumes platform vocabulary — S1 stuck
First post-login view is "Internal Cockpit / Cross-business command center"
with a 6×6 matrix of green/yellow/red statuses across columns labeled
Context / Connections / Capabilities / Cadence / Confidence / Containment
(the "6Cs"). Rows are "AI workforce / Customers and delivery / Finance /
Compliance / People / Portal / Platform delivery." None of this maps to
Dale's mental model. He'd say "where do I build my thing?" Nothing on this
screen helps him answer that.
- Repro: log in as admin@dpf.local on a fresh install.
- Triage: **BI** — first-run mode for the Command Center that hides the 6Cs
  matrix until at least one domain has data, and surfaces a single "Start
  building" CTA.

### D5 — Coworker chat panel leaks system prompt — S2 wrong (BUG)
Right-hand coworker panel auto-opens with a blue debug-looking message that
starts with `[Setup step: Workspace — day-to-day operations and guardrails]
Organisation: Digital Product Factory This is the final setup step. Welcome
the user to their workspace. Briefly explain that this is where they will
manage day-to-day operations, viewing their backlog…` — the literal setup
*instruction* is rendered to the user, not just the resulting greeting.
- Repro: first login → look at the COO coworker panel.
- Triage: **fix-now candidate** — the instruction prefix should never reach
  the user-facing transcript. Locate the rendering site, strip the setup
  block from `assistant` role messages, retain only the resulting greeting.

### D6 — Fresh install isn't actually fresh — S2 wrong
"OPEN WORK 199" and "AI COWORKERS 81" greet Dale on a screen he's never
seen before. For Mark this is expected residue from prior testing. For
Dale this convinces him the install belongs to somebody else's company.
- Repro: log in for the first time on a fresh `setup.ps1`.
- Triage: confirm whether seed loads 199 work items (it shouldn't) vs
  whether this is accumulated runtime data. If runtime, ship a "first-run
  cleanse" toggle in the installer.

### D7 — Platform-update banner with raw bundle hash on first login — S3 friction
Yellow top banner: "Platform update vf2e89dd8a101ff2c49eb396f0d27e1d1ff83
a24d2287ae6db6522d724baa0498 is ready. Your customisations are preserved.
Review in Admin → Platform Development." 64-character hash is the first
thing Dale sees above the fold. He's been logged in for 2 seconds.
- Repro: first login.
- Triage: suppress for first N minutes of a brand-new tenant, OR render
  hash as a short label ("Update v2026-05-23"), OR collapse into a small
  badge with hover-to-expand.

### D8 — Left nav has 14 entries, no "Build something" CTA — S1 stuck
Workspace / Documents / Customer / People / Finance / Compliance / Portal /
Portfolio / Backlog / Architecture / AI Workforce / Build Studio / Platform
Hub / Admin / Knowledge / Wiki / Docs. Dale wants to build his Truck Stock
Tracker. He'd guess Backlog? Portfolio? Build Studio? Each guess wastes a
navigation. There should be one obvious primary action.
- Repro: log in, look at left rail.
- Triage: **BI** — primary CTA pinned above the nav: "+ Start a new build."

---

### D9 — Same system-prompt leak in Build Studio coworker (Software Engineer) — S2 wrong (BUG)
Second instance of D5 with different agent ("Software Engineer"), opens with
`[Setup step: Build Studio — custom feature development] Organisation: Digital
Product Factory This is a preview step. Introduce Build Studio briefly...`
Confirms it's a global rendering bug, not per-coworker.
- Triage: **fix-now (same fix as D5)**.

### D10 — Coworker chat shows fabricated user message — S2 wrong (BUG)
Right panel for "Software Engineer" includes a *user-styled* message Dale
never typed: "Can we select a few backlog items to get started? The ones we
created today are good." followed by an auto tool-call ("I'll call
list_backlog_items to retrieve the backlog items"). Either persisted prior-
tester chat surviving across logins, or a scripted demo turn rendered as if
the user sent it.
- Repro: log in fresh, open Build Studio. Chat is not empty.
- Triage: **BI** — coworker chat persistence scope unclear; either per-
  session or per-build, never carry strangers' utterances.

### D11 — Top context bar repeats "No active build" twice + raw internals — S3 friction
`PORTAL CONTEXT | Build Studio | No active build | No capsule | ⚠ No active
build | Select build | Open context` — duplicated chip, plus terms ("capsule",
"context") Dale doesn't know.
- Triage: dedupe + relabel.

### D12 — "Describe a new feature…" is single-line, scrolls horizontally — S2 wrong
Sidebar input accepted Dale's 88-char description but only the tail end is
visible. Dale would re-read and think he lost his text. Field labeled as a
description should be a multiline textarea with visible character count.
- Triage: **fix-now candidate**.

### D13 — Build / capsule / branch chips leak internal identifiers — S2 wrong
Header chips: `FB-6F7D6AC4`, `WC-1C481A3E`, branch
`dpf/4b41d6f0/i-want-to-know-what-parts-each-truck-has-so-my-guy`. Git branch
naming + internal IDs visible to a tradesperson user. Dale has no idea what
FB / WC / capsule / branch mean.
- Triage: **BI** — hide internals behind a "Details" disclosure; show only
  a human-readable feature title chip by default.

### D14 — "Missing evidence" warning appears the instant a build is created — S3 friction
Yellow chip "⚠ Missing evidence" surfaced at t=0 before any phase has had a
chance to produce evidence. Evidence-missing is *expected* at intake; not a
warning state until a phase gate is actually being attempted.
- Triage: gate the warning on phase-attempt, not creation.

### D15 — "Code intel & assurance" chip strip is platform jargon — S3 friction
`Code intel & assurance | Code intel: ready | BOM: no BOM | Findings: 0
active` — Bill of Materials? Findings? Index status? Dale has no use for any
of this on first build.
- Triage: collapse behind a "Build health" pill that expands on click; surface
  only when something is actually wrong.

### D16 — "Open sandbox · driving: idle" footer term — S3 friction
Dale doesn't know what a sandbox is or why it "drives." Internal term for
the build environment that should be relabeled.
- Triage: rename to "Live preview" + status word ("waiting" / "running").

### D17 — Pipeline minimap is visual noise at first-build scale — S3 friction
Bottom-right React Flow minimap shows the pipeline as a tiny abstract block
diagram. Useful for big graphs; not at 5 stages.
- Triage: hide minimap when graph fits in viewport.

### D18 — "Help me define it" framing is ambiguous — S3 friction
Auto-generated kickoff message ends with "Help me define it." Reads like the
coworker is asking the human for help, not offering it. Likely intentional
(human is requirements source) but the framing inverts the usual help-desk
expectation Dale would have.
- Triage: rephrase to "Let's define this together — first I'll ask a few
  questions about how your shop works."

### D19 — Coworker's first real response is meta-self-talk — S0 quit (CRITICAL BUG)
After Dale's intake sentence, after several seconds of "thinking," the
Software Engineer replies verbatim: *"I caught myself describing work without
actually doing it, and stopped so we don't end up with progress that isn't
real. Send me the same instruction again, or check the build details to see
what's been recorded so far."* Dale has no idea what this means. There is
zero forward motion. "Send me the same instruction again" — what instruction?
He doesn't know which input box to use. Result: laptop closed.
- Root cause (probable): routing fell back to the small local model
  (`magistral-small-3.2`, see D20) which produced this confabulation/
  self-meta-talk pattern instead of the actual Ideate scout questions. This
  is a direct repro of the "mechanism-question grounding gap" from project
  memory (`project_mechanism_question_grounding_gap.md`), but happening on a
  routine intake rather than a mechanism question. The small model is being
  used in a slot where it isn't grounded enough to perform.
- Triage: **CRITICAL BI** — (a) routing must not send Ideate kickoff to a
  small local model; (b) when the response matches a "I caught myself /
  stopped / send again" self-meta pattern, retry the call on a stronger
  model and never surface the meta-text to the user; (c) when retries fail,
  show a graceful "couldn't reach the coworker, try again" not a raw model
  monologue.

### D20 — Coworker model chip exposes Docker registry path — S3 friction
Chip beside agent name: `local:docker.io/ai/magistral-small-3.2:latest`.
Dale sees a Docker image tag in chat.
- Triage: relabel to friendly model name (e.g. "Magistral (local, small)"
  or just the role "Software Engineer"); registry path goes to debug pane.

---

## Triage summary so far

| #  | Severity | Triage           | Notes                                       |
|----|----------|------------------|---------------------------------------------|
| D1 | S2       | fix-now          | label tweak / third tile                    |
| D2 | S1       | BI               | first-run flow                              |
| D3 | S0       | BI               | installer welcome + forced rotation         |
| D4 | S1       | BI               | first-run command-center                    |
| D5 | S2       | fix-now (BUG)    | chat panel leaks system prompt              |
| D6 | S2       | investigation    | confirm seed vs runtime origin              |
| D7 | S3       | fix-now          | hash → label, or first-N-min suppress       |
| D8 | S1       | BI               | "Start a new build" primary CTA             |
| D9 | S2       | fix-now (BUG)    | same as D5, second coworker — global bug    |
| D10 | S2      | BI               | chat persistence scoping                    |
| D11 | S3      | fix-now          | dedupe context-bar chips                    |
| D12 | S2      | fix-now          | description = multiline                     |
| D13 | S2      | BI               | hide internal IDs / branch                  |
| D14 | S3      | fix-now          | gate "missing evidence" on phase attempt    |
| D15 | S3      | BI               | collapse code-intel chip strip              |
| D16 | S3      | fix-now          | rename sandbox → live preview               |
| D17 | S3      | fix-now          | hide minimap when small                     |
| D18 | S3      | fix-now          | rephrase intake auto-greeting               |
| D19 | **S0**  | **CRITICAL BI**  | routing + retry + graceful fallback         |
| D20 | S3      | fix-now          | friendly model label                        |
| D21 | S2      | BI               | agent should re-route itself, not ask Dale  |
| D22 | **S0**  | **CRITICAL BUG** | failure-handler promises re-route but never re-routes; verified across 3 retries — same model, same canned message |

---

## Recovery-path verification (D19 / D22)

Tried Dale's instructed recovery ("Send me the same instruction again") three
times verbatim. Result:

| Turn | Coworker model chip                    | Response                          |
|------|----------------------------------------|-----------------------------------|
| 1    | `magistral-small-3.2`                  | meta-self-talk (D19)              |
| 2    | `magistral-small-3.2`                  | "I'll route through a different model" |
| 3    | `magistral-small-3.2`                  | identical to turn 2, verbatim     |

No re-routing happened between turns 2 and 3. Either the "I'll route through
a different model" text is a hard-coded failure template (no actual re-route
logic) or the re-route logic exists but isn't wired to the next call.

Dale is hard-blocked at intake. There is no UX path forward without admin
intervention to reassign Software Engineer's model in AI Workforce settings.

---

## Showstopper summary (what makes Dale quit before he sees a single screen of progress)

1. **D3 lockout** (out of scope for this run — pre-configured portal)
2. **D19 + D22 routing wall** — re-diagnosed below.

## Re-diagnosis of D19 / D22 — not a routing pin

`AgentModelConfig` shows zero pinned agents. Software Engineer
(slugId=`build-specialist`) requires `minimumTier=strong`, `quality_first`,
32 K context, `toolUse=true`. These are correct requirements.

What's actually broken: **of all 25+ configured providers, only
`Docker Model Runner (local)` is `active`.** Every remote provider
(Anthropic, OpenAI, Gemini, Codex, Mistral, etc.) is `unconfigured` — no
API keys / OAuth attached. There are 31 *cached Gemini model profiles* but no
active Gemini provider behind them.

So routing legitimately had only one option (local + magistral-small). The
agent's "I'll route through a different model" promise is mathematically
impossible to fulfill on this install — **there are no other models**.

The bugs are:

- **D19' (routing): not a bug.** Routing did the only thing it could.
- **D22' (failure handler): real bug, different shape than first read.**
  The handler should detect "only local available + agent requires strong
  tier" and surface an honest message: *"No strong-tier model is configured.
  Open Platform > AI > Providers and connect Anthropic, OpenAI, or Gemini,
  then retry."* It must never promise a re-route that can't happen.
- **D23 (NEW — pre-flight): missing.** Build Studio should run a capability
  pre-check before letting Dale spend 60 s typing into a doomed pipeline —
  banner at the top of `/build` saying which providers are missing.

### Design decision (Mark, 2026-05-23)

The unconfigured-provider state is the **intended first-customer
experience** — DPF must surface "connect a provider" as the obvious next
step, not paper over it with silent fallbacks. Local stays valid for
lower-demand coworkers (admin chat, doc lookup); Build Studio specifically
gets a **hard gate** because it does code generation + complex reasoning
+ tool orchestration where local can't deliver.

### Fix-layer summary (sharpened)

| Layer     | Action                                                       | Status |
|-----------|--------------------------------------------------------------|--------|
| Code (G1) | Hard gate on `/build` entry when no strong-tier remote provider is active. Inline non-dismissable banner above the sidebar with plain-English explanation + single "Connect a provider →" CTA + short list of supported providers (OAuth = easiest). Disable New button + description field. | BI-7DA88A81 |
| Code (G2) | Backstop: rewrite `buildLocalToolCallFailureMessage` honest path for the runtime case where local is somehow reached anyway. Drop the false "I'll route through a different model" line. | BI-0BDA630D |
| Code (G3) | Future: add `excludeProviderIds` knob to `routeAndCall` for installs that DO have multiple providers — actual escalate-on-failure. Deferred until needed. | not yet filed |

## Provider-configuration UX (G1 destination) — D24-D28

`/platform/ai/providers` is the destination of G1's "Connect a provider →" CTA. Drove to it as Dale and found 5 additional deficiencies, captured in [BI-D6740C86](http://localhost:3000/backlog/BI-D6740C86):

- **D24** — "AUTH METHOD: api_key" on Claude OAuth row (wrong field text)
- **D25** — "CAPABILITY TIER: basic" for Claude (stale seed data). **Critical risk**: this could cause routing to exclude Claude even after Dale connects it, re-firing the G1 gate after a successful connect.
- **D26** — "Configure →" is small text, not a primary button. Dale will hunt for it.
- **D27** — Stale model list ("claude-3-5 · claude-4"); model discovery hasn't refreshed.
- **D28** — Coworker chat panel showing "AI provider unavailable" spam on the very page where Dale would fix that.

---

## Phase E (2026-05-24 ~15:30 UTC) — drive Dale with strong providers connected

After PR #1070 merged + Mark connected Claude OAuth Subscription + OpenAI Codex Subscription, re-drove FB-6F7D6AC4 (Dale's original "truck parts" intake from yesterday). Goal: see if the agent now behaves differently than it did under local Magistral.

**Result: the hotfix bundle landed as a single observable behavior change.**

| Yesterday (Magistral local, stale prompt) | Today (Claude Sonnet 4.6 / Codex GPT-5.4, D29 prompt) |
|---|---|
| "I caught myself describing work without actually doing it…" | "Scout is running. While it does — one quick question to make sure I design this right: Do your techs just need to **look up** what's on a truck, or do they also need to **update the list** when they use or pull parts during a job?" |
| "I couldn't complete this with the model my admin assigned me. Please try the question again — I'll route through a different model." | "I'm looking through the codebase and shaping the feature now; that usually takes about a minute or two. Next I'll bring back a plain-language design for how truck inventory lookup and updates should work." |
| Model chip: `local:docker.io/ai/magistral-small-3.2:latest` | Model chip: `anthropic-sub:claude-sonnet-4-6` (turn 1) → `codex:gpt-5.4` (turn 2). Dynamic per-turn routing. |
| Action: hedge / loop | Action: started `scout_research`, then `save_build_notes` + `start_ideate_research` |

**Vocabulary** throughout the agent's responses was Dale's, not the platform's — "codebase", "feature", "plain-language design", "tech", "look up", "update the list", "pull parts during a job". No `saveBuildEvidence`, no `start_ideate_research`, no internal IDs leaked.

**Principle #15 (NEVER DEFLECT WHEN THE USER HAS AGENCY)** observably active — the agent didn't suggest "wait and try again" or "escalate to admin"; it diagnosed the gap in plain language and took the next concrete step.

### Two new deficiencies surfaced in Phase E

**[BI-78499309](http://localhost:3000/backlog/BI-78499309) — D31 (S1):** long-running async tools (`start_ideate_research` etc.) return `success:true` immediately but the actual work continues in the background. Coworker chat panel reverts to idle, no spinner, no "still working" indicator. Per `feedback_agent_as_work_conduit` the principle exists but isn't honored for tools that kick off background jobs. Dale waited 10+ minutes thinking the AI ghosted him.

**[BI-F4A30FCB](http://localhost:3000/backlog/BI-F4A30FCB) — D32 (S0 CRITICAL):** `start_ideate_research` and `start_scout_research` resolved the active build via `findFirst({ where: { phase: "ideate" }, orderBy: { updatedAt: "desc" } })`. With multiple builds in ideate concurrently — common state once Build Studio sees real use — Dale's userContext landed on `FB-291BC06C` (an unrelated Portal self-upgrade build, fresher updatedAt) instead of his `FB-6F7D6AC4`. Bug hid behind `success:true` so neither the user nor the agent had any way to see the mismatch. **Note: D31 is what made D32 hide** — if progress visibility had been correct, the silent mis-targeting would have been caught faster. They're a pair.

---

## D32 surgical fix (PR #1077, merged 2026-05-24 ~16:35 UTC)

- New helper `apps/web/lib/build/ideate-build-resolution.ts` honors explicit `contextBuildId` first, falls back to "single ideate build" only when unambiguous, and refuses with plain-English message when 2+ ideate builds exist without an explicit buildId. Refusal is loud (`console.warn` for the operator).
- `agentic-loop.ts` plumbs `params.featureBuildId` through `governedExecuteTool → ToolExecutionContext` so the tool handlers can consume it.
- Both ideate-phase tools use the new helper instead of the old `findFirst`.
- 7/7 regression tests covering all three resolution paths plus the exact Dale dogfood cross-contamination scenario.

---

## Phase F (2026-05-24 ~17:00 UTC) — D32 behavioral verification BLOCKED

Tried to re-drive Dale's intake against the now-fixed `start_ideate_research` to behaviorally confirm cross-contamination is gone. Two environment issues blocked it:

1. **Prod portal `:3000` is serving stale pre-D32 bundle** — `docker compose build portal` returned exit 0 but was a complete cache hit (image hash unchanged). `--no-cache` rebuild surfaced the real failure: `pnpm --filter @dpf/db exec prisma generate` exit 1. Filed as [BI-09A48EAD](http://localhost:3000/backlog/BI-09A48EAD); spawned debug task working it.
2. **Dev-portal `:3001` routing returned "AI provider temporarily unavailable"** before reaching tool layer. `RouteDecisionLog` confirms Codex GPT-5.4 was selected with rankScore 30.0, but the actual provider fetch failed downstream — provider intermittency / rate limiting / something at the fetch layer. So the agent never reached `start_ideate_research` and couldn't exercise the D32 fix path.

**D32 verification state:**
- ✅ Unit tests pass — 7/7 covering the exact cross-contamination scenario
- ✅ Source on disk and in main as PR #1077
- ✅ dev-portal bundle has D32 (worktree hot-reload)
- ❌ Behavioral E2E unverified — environment blockers above

The cross-contamination from the original repro cleared itself naturally — `FB-291BC06C.buildExecState.userContext` now contains the correct self-upgrade context (overwritten at 15:53 UTC by a properly-targeted research call). So whoever drove the self-upgrade build through Ideate after the bug surfaced, did so correctly under the post-fix code. Dale's `FB-6F7D6AC4` is still untouched from yesterday at 23:37 — needs another go once one of the two blockers clears.

---

## Triage state of the Dale epic (EP-9FC5D2FD) at 2026-05-24 ~17:30 UTC

| # | Status | BI | Title |
|---|---|---|---|
| 1 | ✅ shipped | BI-7DA88A81 | G1 Build Studio entry gate |
| 2 | ✅ shipped | BI-0BDA630D | G2 honest failure messages |
| 3 | ✅ shipped (D25 portion) | BI-D6740C86 | Provider UX cleanup — D24/D26/D27/D28 queued |
| 4 | ✅ shipped (wiring) | BI-4C478ACF | D29 coworker route+capability context + NEVER-DEFLECT principle |
| 5 | ✅ shipped (D5/D9 portion) | BI-253ADC70 | Chat hygiene — D10/D18 queued |
| 6 | ✅ shipped (D12 portion) | BI-950FE085 | Intake affordance — D8 queued |
| 7 | open | BI-63EAD801 | Hide internal IDs / capsule slugs / git branch chips (D13) |
| 8 | ✅ shipped (D11/D14 portion) | BI-62075FF9 | Status-strip cleanup — D15/D16/D17/D20 queued |
| 9 | open | BI-EC26D09D | Portal first-touch labeling (D1, D7) |
| 10 | open | BI-78499309 | D31 long-running async progress visibility |
| 11 | ✅ shipped (code) / ❌ unverified | BI-F4A30FCB | D32 wrong-build cross-contamination |
| 12 | open (spawned debug) | BI-09A48EAD | portal rebuild prisma generate failure |
| 13 | open | BI-87D93A71 | ChatGPT/Codex OAuth port quirk (D30 also shipped via PR #1067 — but UX cleanup outstanding) |

---

## Phase H (2026-05-24 ~late) — Plan iteration shuttle on prod portal

After portal rebuilt cleanly (PR #1091 cleared the prisma generate failure) FB-6F7D6AC4
advanced **Ideate → Plan** with the full design-doc landing review-passed (idempotency,
optimistic locking, append-only ledger, mobile-first AC, multi-tenant isolation). Plan
phase ran its own review (reviewBuildPlan) which initially **failed** with 6 important
findings — all "plan structure", not "product direction":

- idempotency-key uniqueness scope not pinned (per org+actor+location+op)
- optimistic-locking versioning mechanism not chosen
- alternatives not documented (event-source vs cached-balance; pessimistic vs optimistic)
- append-only enforcement (DB-level update/delete restrictions) not specified
- multi-tenant query-level authorization not explicit
- low-stock threshold source + alert deduplication undefined

Agent acknowledged in plain English and re-decomposed the plan into a **much more
granular task graph** — visible in the stage view: Data Architect owning 14 schema/
seed/migration tasks (one model per task: `MobileInventoryLocationType`,
`MobileInventoryLocation`, `InventoryItem`, `LocationInventory`, `InventoryTransaction`;
plus `Add CHECK constraint to migration`, `Verify FK onDelete in migration`,
`Implement idempotency check`), Software Engineer owning test-first API endpoint
tasks (test → impl pairs for list, detail, usage POST), Frontend Engineer owning
component-level tasks (`LowStockBadge`, `InventoryCard`, `UsageButton`), QA Engineer
gating with `Full verification: tests + typecheck`. **This is what good Plan looks
like** — the unit of work is small enough to verify, the order is `model → migration
→ test → impl → ui → verify`, and review's "smaller steps" feedback was honored.

### New deficiencies surfaced in Phase H

**D33 (filed as BI-62442F75)** — header card text reads "Plan review failed. Revise
the implementation plan and re-run `reviewBuildPlan` before advancing." The
`reviewBuildPlan` is a **tool name**, not a Dale-facing concept. Same family as
D6 (capsule slugs leaking). User-facing copy should say "re-run plan review" or
just "submit the plan again".

**D34 (NEW)** — bottom status-bar shows `Open live preview · driving: FB-486B7710`
while the URL + canonical doc viewer focus is `FB-6F7D6AC4`. The "driving" context
is **stale from a previous build** — likely the last build the user viewed live-
preview for. When Dale clicks `Open live preview` he'll land on G2's preview (a
totally unrelated platform fix) instead of his truck-parts build. Either the strip
should auto-update to the active buildId, or the "driving" label needs to be
explicit-opt-in. File BI under BI-62075FF9 (status-strip cleanup family).

**D35 (NEW)** — mid-Plan-iteration, **portal self-upgrade banner fired**: "Platform
update vf2e89dd... is ready. Your customisations are preserved. Review in
Admin → Platform Development". The in-flight `reviewBuildPlan` call was dropped —
agent came back with G2 honest message *"I couldn't complete that — the underlying
work wasn't recorded. Try rephrasing the request, or open the build details to see
what's saved so far."* This is the exact failure mode in
`project_self_upgrade_kills_in_session_ux` — known issue, but now reproduced
inside Plan iteration too (previously documented only for `/build` intake +
sibling-PR-merge churn). Self-upgrade should **defer** when there's an active
agentic loop in flight, or at minimum block the upgrade until the in-flight
tool call completes.

### G2 honest-message family is working

Notable: when self-upgrade killed the call, the agent's recovery message was
the new G2 family (PR #1070) — *"I couldn't complete that — the underlying
work wasn't recorded. Try rephrasing the request…"* — no false "I'll route
through a different model" promise. That's the right shape. The deficiency
isn't the message; it's the underlying drop, captured as D35.

### D36 (NEW, BI-2ECD7499) — Agent loops on warmup probes after tool drop

After the self-upgrade dropped the in-flight `reviewBuildPlan` call, the agent
entered a warmup-probe loop instead of either retrying the real call or
escalating:

```
19:46:26  report_quality_issue  "System warmup check — Automated warmup — ignore this."
19:46:27  assistant→user        "I couldn't complete that — the underlying work wasn't recorded..."
19:47:27  user→assistant        "Please try resubmitting the implementation plan again..."
19:47:59  report_quality_issue  "System warmup check — Automated warmup — ignore this."
19:48:18  report_quality_issue  "System warmup check — Automated warmup — ignore this."
[4+ min silence after, no further tool calls or messages]
```

Three problems in one:
1. The agentic loop's warmup probe is firing repeatedly after a tool drop —
   probably the wrong recovery path.
2. The probe message is being written to `report_quality_issue`, which is the
   admin-facing quality feedback queue. Pollutes the BI signal stream.
3. The UI's "Software Engineer is still working (230s) [Cancel]" indicator
   keeps the user trusting that work is happening, when the back-end is just
   pinging itself.

This is paired with D35 (self-upgrade drop) — D35 is the trigger, D36 is the
broken recovery.

### Plan re-decomposition observed (post-resubmit-1)

The first resubmit (at 19:44:29 update timestamp) DID land — review re-ran and
produced **21 new issues**, escalated from the prior round's all-"important" to
this round's **critical**. Issues center on test-first discipline:

- "schema/migration/seed/setup/UI tasks (1-21, 60-66) are mostly
  implementation-first with empty or compile-only checks rather than failing
  tests first"
- "Tasks 1-20 ... violate test-first for foundational database and seeding work"
- "Tasks 60-65 (UI components/pages) also have no failing tests before
  implementation and only use `tsc --noEmit` verification"
- "No explicit test tasks exist for `apps/web/lib/mobile-inventory/types.ts`"

This is **review's third lever**: first round flagged scope/granularity
("smaller steps"), second round flagged structural rigor ("test-first").
Reviewer agents are stricter than implementation agents — each iteration
surfaces previously-tolerated patterns. The Build-Studio review loop
documented in `project_build_studio_review_loop` is operating as designed
(strict), but Dale is now 30+ minutes into Plan with no Build phase reached.

This is **legitimate review-iteration cost** for novel features. Documented
here as a Phase-H observation, not a deficiency on its own. The pairing
**D35-D36-warmup-loop** is the real deficiency: if every iteration risks
losing 10 minutes to a self-upgrade drop, total Plan-phase wall time
inflates dramatically.

### D37 (NEW, BI-0C19AFDD) — Max-iter handler confabulates unrelated domain

After my "Please try resubmitting" prompt, the agent (codex:gpt-5.4 this turn)
spent 569s in iteration loop before being cancelled. Its post-cancel recovery
message:

> "I used read_project_file x3, search_project_files x3, list_project_directory
> x2, describe_model, get_code_graph_freshness, but the coworker hit the runtime
> limit before it produced a final answer. I stopped before returning another
> raw tool request. The route and tool attempts were recorded; **try a narrower
> question or use the finance reports directly for the current totals while we
> add a more direct finance-summary tool**."

Dale is building **truck-parts inventory** — there are no finance reports,
nor would using finance reports help him. This is the same class as
`project_mechanism_question_grounding_gap` (PR #1018 follow-up): when the
agent loses grounding context (max-iter recovery here, mechanism questions
there), the model confabulates plausible-sounding-but-domain-wrong examples
to fill the response template.

Fix shape per BI-0C19AFDD: pass build title/domain into the max-iter prompt,
OR make max-iter messages deterministic (no model generation in failure
paths — the place we LEAST trust the model is failure recovery).

### D31 echo confirmed (long-running async UX)

The "Software Engineer is still working (569s)" indicator kept Dale trusting
that work was happening, when the back-end was just iterating in a loop
producing no useful tool calls (no DB writes for 11 minutes). This is exactly
the BI-78499309 surface — D31 is paired with D36/D37 as a cluster: when the
agent is stuck, the UI can't tell the difference between "thinking deeply" and
"looping uselessly". Without per-tool-call progress signal, the operator has
to read DB tables to know.

### Phase H final state (2026-05-24 ~20:30 UTC)

| Time  | Tasks | Issues | Crit | Notes |
|-------|-------|--------|------|-------|
| 19:44 | (initial) | 21 | many | first review pass |
| 20:01 | 99    | 11     | 4    | +78 tasks (test-first decomp), -10 issues |
| 20:03 | 86    | 13     | ?    | -13 tasks (consolidation), +2 issues |
| 20:09 | 50    | 21     | 6    | -36 tasks (over-consolidation), back to start |
| 20:11 | 97    | 15     | 4    | +47 tasks, -6 issues |
| 20:32 | 97    | 15     | 4    | **agent idle, no further activity** |

Plan iteration **trended down from 21→15** but never converged. Last 25 minutes
the agent has been silent — neither emitting a recovery message nor running
further tool calls. Build still in `plan` phase, no Build phase yet observed.

### D38 (NEW, BI-4396EFEC) — Plan-review iteration loop oscillates without converging

Distinct from `project_build_studio_review_loop` (known design-review strictness)
and `project_review_severity_gate` (which fixed "new important issue per iteration").
This is the **plan-phase iteration divergence**: the reviewer's optimum has competing
axes (test-first vs bite-size vs alternatives documented vs scope completeness) that
can't be simultaneously satisfied for a feature of this size. The agent oscillates
between two local minima.

Fix shapes proposed in BI: bound iteration count + emit "scope too big — split"
recommendation; review-delta-aware (acknowledge prior-round findings); operator-
visible iteration progress chip; pair implementer revisions with explicit acknowledge-
ment of what changed and why.

### Phase H deficiency roll-up

Six new BIs filed this round, all in EP-9FC5D2FD:

| # | BI | Title | Surface |
|---|---|---|---|
| D33 | BI-62442F75 | Tool-name leak in plan-review header ("re-run reviewBuildPlan") | UX copy |
| D34 | BI-EEC5A5ED | Bottom status-bar "driving:" pointer goes stale across builds | UX/state |
| D35 | (existing memory `project_self_upgrade_kills_in_session_ux`) | Self-upgrade drops in-flight Plan-iteration tool calls | infra |
| D36 | BI-2ECD7499 | `ModelWarmup` probe pollutes report_quality_issue on every page-load | client |
| D37 | BI-0C19AFDD | Max-iter handler confabulates unrelated domain (finance vs truck-parts) | agent/LLM |
| D38 | BI-4396EFEC | Plan-review iteration loop oscillates without converging | review-agent |

### Phase H lessons (architectural)

1. **G2 honest-failure family is working** — the agent's "platform connection dropped — send 'ready' to retry" message let me drive a clean retry. That's the right shape and shipped in PR #1070.
2. **The Plan-phase iteration loop is the bottleneck for Dale-class operators.** Ideate → Plan transition is now reliable; Plan → Build transition requires expert nudging.
3. **The deficiency cluster D31+D35+D36+D37+D38 is interlocking:**
   - D31 (invisible spin) makes D35-D38 all harder to detect from the seat
   - D35 (self-upgrade drops) triggers D36 (warmup re-fire) and degrades context
   - D37 (max-iter confab) is the failure shape when context degrades
   - D38 (review loop diverges) is what happens to plans across many of those degradations
4. **Build Studio needs a "Plan iteration referee"** — something that watches the issue-count trajectory across rounds and intervenes when oscillation is detected (bound iteration count + recommend scope-split).

### Where Dale's FB-6F7D6AC4 sits at end of Phase H

- Status: plan-phase, 97 tasks planned, 15 issues remaining (4 critical)
- Not approved; not actionable from Dale's seat without expert intervention
- Recommendation: either (a) cancel + split into 2-3 smaller features, or (b) wait
  on D38 fix landing before re-attempting Plan convergence

---

## End of Phase H — recommended next step

Per the autonomous shuttling directive, productive yield from this thread has
reached its natural end:

- Ideate → Plan transition: **shipped** (PR #1070 + #1077, verified Phase E-G)
- Plan-phase observation: **complete** — 6 fresh deficiencies filed, root causes
  understood, surgical fix shapes proposed in each BI
- Build-phase observation: **blocked** by D38 (Plan won't converge to approval)

Next thread should be **D38 (or its prerequisite BIs) before re-shuttling Dale**.
Mark's parallel "vertical-alignment" thread will independently inform the
architecture for which features need this hardening urgency.

### Phase H lesson learned (architectural)

Plan-phase review iteration is a **bottleneck without backpressure**:

- Review is stricter than implementation; each pass surfaces tolerated patterns.
- Self-upgrade can drop in-flight reviews; recovery isn't robust.
- Max-iter triggers domain-blind confabulation as fallback.
- Operator has no per-tool progress signal — looks like a fast spinner.

For Dale-class operators (zero technical background), this combination is
likely fatal. He has no vocabulary to say "the agent confabulated finance"
or "the build plan needs test-first decomposition". The only thing he can do
is wait, retry, or give up. Build Studio needs:

1. **Deterministic fallback messages** in failure paths (kill D37 confab risk).
2. **Tool-execution timeline visible to Dale** ("waiting for code review ·
   12s") so stalls are observable (kill D31 invisible-spin risk).
3. **Self-upgrade defer** when an agentic loop is active (kill D35 drop risk).

Each is a small surgical fix individually; together they elevate Plan-phase
reliability from "needs hand-holding by an AI engineer" to "Dale can wait
for it".
