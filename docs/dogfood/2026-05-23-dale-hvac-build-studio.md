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
