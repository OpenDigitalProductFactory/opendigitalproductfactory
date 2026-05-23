# First-Run Customer Experience Hardening Design

**Date:** 2026-05-23
**Status:** Draft
**Author:** Claude with user direction (Mark Bodman)
**Related docs:**
- `docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md`
- `docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md`
- Today's PRs: #1041 (README install bootstrap), #1042 (whisper digest), #1043 (inngest healthcheck), #1044 (installer enables Model Runner)

## 1. Problem Statement

DPF's target customer is a small-business operator — a plumber, a hair salon owner, an HVAC technician — with at-best high-school education and no IT background. The current first-run experience requires this user to:

1. Manually enable Docker Model Runner via `docker desktop enable model-runner` (or buried Settings → AI menu)
2. Pull a model by guessing the right Docker Hub tag (the portal's own catalog shows wrong tags — `ai/qwen3:14b` 404s; the real tag is `ai/qwen3:14B-Q6_K`)
3. Discover the **Sync Models & Profiles** button buried on `/platform/ai/providers/local`
4. Discover the **Run Probes** button labeled *"Optional diagnostics"* (in reality, mandatory — without it the router fails)
5. Navigate to **Assignments**, click **Advanced**, lower **Minimum Quality** to **Basic** because the seeded `ModelProvider.capabilityTier` is `basic` and never auto-promotes
6. Survive an error message that reads `The AI provider is temporarily unavailable. Please try again in about 30 seconds.` with no actual fix on the other side of waiting

Every one of those steps is a point where a non-technical user abandons the product. **Error-prone install ≠ shippable to plumbers.**

This spec is the response to a real cold-install session on 2026-05-23 in which the founder walked the install end-to-end and surfaced 8 distinct install-path defects (tracked as session tasks #13–#18, plus open PRs #1043–#1044). The 8 defects all collapse to one root cause: **the platform delegates setup work to the user that the platform should do itself.**

## 2. Goals

- **Zero decisions on first run.** A non-technical user can complete install → login → conversational AI without making any technical choice. If a decision is unavoidable, the platform picks a safe default and surfaces the alternative only behind explicit opt-in.
- **Zero buttons to find.** No user-visible setup affordance (`Sync Models & Profiles`, `Run Probes`, `Update Providers`, `Test Connection`) should be required to reach a working coworker. The platform must run those automatically.
- **The installer ships a demonstrably working state**, not a "configured" state. `install-dpf.ps1` does not declare success on "all 10 green checks"; it declares success when an actual AI Coworker has replied to an actual test prompt.
- **Human error messages.** Every error a default user can hit must (a) describe the situation in plain English, (b) propose the next action, (c) include a self-retry where possible. No internal-state strings (`endpoint manifest`, `tier`, `profile`) surface to default users.
- **Progressive disclosure of complexity.** The full power-user surface (tier dropdowns, provider matrix, capability assignments, manual probes, model-pin overrides) remains available behind an **Advanced settings** toggle. Default users never see it.

## 3. Non-Goals

- **Removing the power-user surface.** IT professionals, integrators, and DPF contributors all need fine-grained control. This spec hides those surfaces by default — it does not delete them.
- **Re-architecting the routing engine.** The router, ModelProfile, EndpointTaskPerformance, and tier-matching logic stay as they are. This spec changes what triggers their population and how they surface failure, not how they compute decisions.
- **Eliminating cloud LLM support.** Cloud providers (Anthropic, OpenAI, Gemini, etc.) remain a supported upgrade path. They become an explicit opt-in for "more capable answers," not a requirement to start.
- **Choosing a specific local model.** Model selection logic is captured separately (Task #14 — installer must pull a `strong + Tool Use` model from the platform's own catalog rather than hardcoding `ai/gemma3`/`ai/gemma4`). This spec assumes that fix and focuses on the broader UX.

## 4. Current State (Evidence from 2026-05-23 cold install)

A fresh install on a known-good machine (Win 11 25H2, Docker Desktop 4.74.0, RTX 4090, no prior DPF) produced the following first-run experience:

1. **Step 8 of installer** silently failed at `docker model pull ai/gemma4` because Docker Model Runner was disabled by default. The installer claimed success on `$LASTEXITCODE` check; in reality no model landed on disk. Fixed in PR #1044 by adding explicit `docker desktop enable model-runner` before pull.
2. **Selected model `ai/gemma4`** calibrates as `adequate` tier per the platform's own catalog. Every default coworker (AI Ops Engineer, COO, Software Engineer, etc.) has `minimumTier: strong`. Result: zero routing matches even after the model was on disk. (Task #14.)
3. **Portal's `Coworkers` catalog UI** at `/platform/ai/providers/local` displays pull commands with wrong tags. The "best tool-calling" recommendation shows `docker model pull ai/qwen3:14b` — that tag returns 404. The real tag is `ai/qwen3:14B-Q6_K`. (Task #15.)
4. **`Refresh` button on Installed Models** updates the displayed list but does not propagate to `ModelProfile` rows. New models are visible in the UI but invisible to the router. The correct affordance is `Sync Models & Profiles` (different button, different section, easy to miss). (Task #16.)
5. **`ModelProvider.capabilityTier`** is set at seed (`basic` for local) and never re-evaluated when stronger-tier models are added to the same provider. Router filters at provider tier first, so a provider hosting a `strong` model still rejects `minimumTier=strong` requests. (Task #17.)
6. **`Run Probes` button** is labeled *"Optional diagnostics. The platform automatically tests providers on startup and when they are configured."* The labeling is false — the platform does NOT auto-probe; without manually clicking it, zero LLM `EndpointTaskPerformance` rows exist and the router fails every LLM task with: `[agentic-loop] routeAndCall threw: No eligible endpoints for task 'greeting': No active endpoint manifests found.` (Task #18.)
7. **The AI Ops Engineer coworker** — the very coworker meant to guide the user through configuring AI providers — depends on a configured AI provider to function. Result: a polished chicken-and-egg that surfaces as `The AI provider is temporarily unavailable. Please try again in about 30 seconds.` The "30 seconds" is fiction; nothing changes on retry.
8. **`AgentModelConfig.minimumTier`** for the AI Ops Engineer (and other coworkers) is hardcoded to `strong` in seed, but `strong`-tier local models require Qwen3 8B/14B/32B from the platform's catalog, none of which the installer's Step 6 hardware-detection picks.

Each defect in isolation is small. The compound failure rate, multiplied across a non-technical user base, approaches 100% abandonment.

## 5. Research & Benchmarking

### 5.1 ChatGPT / Claude.ai consumer onboarding

New-user flow: sign up → land on chat interface → type a message → receive a response. Total user decisions on first run: zero (model selection is hidden behind a dropdown most users never click). Total error states reachable by default: effectively zero — service-side failures surface as ambient "ChatGPT is at capacity" banners, not as user-actionable errors.

Adopted pattern: **the first thing the user sees is a working conversation**, not a configuration screen. The configuration screen is reachable but never required.

### 5.2 QuickBooks Online new-company setup

QuickBooks asks 3–4 questions (industry, business name, business type, who you sell to) and uses those answers to pre-populate a chart of accounts, tax setup, and report defaults. The user never sees a "Configure your General Ledger" screen. Every decision they would need to make is either inferred from their industry answer or hidden behind an "Advanced" section.

Adopted pattern: **infer technical setup from non-technical questions.** Asking *"What kind of business is this?"* is fine; asking *"What is your accounting cost basis?"* is not.

### 5.3 Linear

Linear is famously opinionated: it refuses to expose options for things it has a good default for. The first-time user gets a workspace with a sensible workflow, sensible statuses, sensible defaults; if they want to customize, they can — but it's never required.

Adopted pattern: **opinionated defaults > flexible configuration** for the first-run path. Flexibility is a power-user feature, not a default-user feature.

### 5.4 Heroku / Vercel "git push, get a URL"

Heroku's market-defining promise was "push your code, get a running app." No configuration files required for the simple case. The platform inferred everything from the code itself. Configuration files (Procfile, app.json) existed but were optional until the user outgrew the defaults.

Adopted pattern: **inference over configuration.** The platform should look at what it can see (host hardware, available providers, network reachability) and decide, rather than ask the user.

### 5.5 Stripe dashboard empty state

Stripe's dashboard works the moment you sign in. Empty states are designed to be productive: "You don't have any payments yet — here's a test card number to try" rather than "Configure your gateway integration first." Connecting a real payment processor is a separate, opt-in flow.

Adopted pattern: **the empty state must be productive.** An empty AI Provider list is not "go configure something" — it's "you can already talk to the built-in assistant; want to upgrade to cloud?"

### 5.6 Notion / Slack workspace creation

Notion creates a workspace with starter pages, sample databases, and a getting-started checklist. Slack creates channels, invites the user to a default conversation, and offers a simple invite-by-email flow. Neither asks the user to configure anything before they can use the product.

Adopted pattern: **sample/example state on first run.** Show what the platform can do via pre-populated content, not via a "create your first X" wizard.

### 5.7 Where DPF currently violates these patterns

| Pattern | DPF today | DPF after this spec |
|---|---|---|
| First screen = working state | First screen = "Configure AI Providers" with 22 unconfigured rows | First screen = working AI Coworker conversation |
| Infer over ask | Asks 9 setup steps | Asks 0 setup steps (1 only if user clicks "upgrade to cloud") |
| Empty state is productive | "AI provider temporarily unavailable" | "Built-in assistant ready. Want a more capable cloud assistant? [Optional setup]" |
| Defaults > flexibility | Tier dropdowns + provider matrix + capability assignments all visible | All advanced settings behind a single "Advanced" toggle |
| Errors are human + actionable | "No active endpoint manifests found" | "Still warming up — about 1 minute on first start. We'll let you know." |

## 6. Design

### 6.1 The six principles

This spec is anchored on six principles. Every implementation choice traces back to one of them.

1. **Zero-touch first run.** Install → portal → working coworker, no clicks.
2. **No technical concepts in surface UX.** *Inference engine, endpoint manifest, capability tier, model profile, probe* are developer language. Hide all of them from default users.
3. **Self-healing, not self-configuring.** The platform fixes its own setup. Auto-sync, auto-probe, auto-promote tier — never delegated to user clicks.
4. **The installer ships a working state.** Last step of `install-dpf.ps1` is a successful round-trip to a coworker, not the green-check of step 10.
5. **Progressive disclosure.** All advanced surfaces remain available behind a single visible "Advanced" toggle. Default users never see them.
6. **Human, actionable error messages.** No internal-state strings. Every error proposes the next action. Self-retry where possible.

### 6.2 Installer changes (`install-dpf.ps1`)

Step 6 (hardware detection) and Step 8 (model pull) change as follows:

**Step 6 — Hardware detection + model selection:**

- Detect: GPU (NVIDIA, AMD, Intel Arc, Apple Silicon — currently only NVIDIA is detected; broaden), VRAM, system RAM, free disk.
- Select model **from the platform's own Coworkers catalog**, not hardcoded names. The catalog says `Qwen3 8B / 14B / 32B` are `strong + Tool Use`; pick the largest that fits VRAM. Fall back to `Qwen3 8B` if VRAM is unclear. Never pick `ai/gemma3` or `ai/gemma4` for the default coworker path (both are `adequate` tier and will fail the seeded `minimumTier=strong`).
- Source-of-truth: the installer queries the same JSON catalog the portal renders. No second copy of the model list in PowerShell.

**Step 8 — AI Coworker setup (renamed from "Setting up your AI Coworker"):**

Replace the current `docker model pull → save progress → exit` with a verification chain:

```
1. Enable Docker Model Runner (already in PR #1044).
2. Enable Docker Model Runner GPU-backed inference. THE single
   highest-impact line in this entire spec. Without it, llama-server
   processes silently run on CPU + system RAM instead of VRAM,
   inference is 10-50× slower, and every downstream symptom in §4
   (probe timeouts, model swap fallbacks, "AI provider temporarily
   unavailable") gets dramatically worse or appears where it
   otherwise wouldn't. Verify via nvidia-smi (or rocm-smi / Metal
   equivalent) that the llama-server PIDs show non-zero VRAM use
   after first inference call.
3. Pull selected model from catalog. Verify with `docker model ls`.
4. Wait for portal to be reachable at localhost:3000/api/health.
5. Hit the new portal API endpoint POST /api/internal/first-run-bootstrap
   which the portal exposes specifically for the installer. The endpoint:
     a. Test-connects to local Docker Model Runner.
     b. Runs Sync Models & Profiles (populates ModelProfile).
     c. Promotes ModelProvider.capabilityTier to max(ModelProfile.tier).
     d. Runs Run Probes synchronously (populates EndpointTaskPerformance).
     e. Sends a test prompt to AI Ops Engineer.
     f. Returns 200 with the assistant's reply, or 4xx/5xx with a
        human-readable failure.
6. Installer prints the assistant's reply to the console.
   "✓ Your AI assistant said: <reply>. Setup complete."
7. On failure, installer prints the human-readable error AND a
   one-line "what to try next" suggestion. Never a tier dropdown.
```

The GPU-enable mechanism is platform-specific:

- **Windows / macOS Docker Desktop**: Settings → AI → "Enable GPU-backed
  inference" checkbox. Programmatic access: investigate `docker desktop
  enable model-runner --gpu` (if it exists in the current Docker Desktop
  CLI surface) before falling back to editing `~/.docker/desktop/settings-
  store.json` directly. The settings file approach is fragile against
  Docker Desktop schema changes; prefer the CLI if available.
- **Linux Docker Engine**: GPU passthrough is handled at runtime via
  `--gpus all` on the container; Docker Model Runner on Linux must be
  configured with NVIDIA Container Toolkit installed on the host. The
  installer's Linux path must check for `nvidia-container-toolkit` and
  surface the install command if missing.
- **WSL2 (Docker Desktop on Windows)**: requires the NVIDIA CUDA driver
  for WSL on the host. Docker Desktop normally bundles the WSL-side
  passthrough; verify via `docker run --rm --gpus all nvidia/cuda:base
  nvidia-smi` after enabling.

The installer NEVER claims success without seeing a real coworker reply.

### 6.3 Portal first-boot auto-bootstrap

On portal startup (or whenever a `ModelProvider` row transitions to status `active`), the portal runs an idempotent background job:

```
1. For each provider with category=direct and a localhost-like baseUrl:
   a. Test-connect (HTTP HEAD on /v1/models or equivalent).
   b. If reachable: Sync Models & Profiles (populate ModelProfile).
   c. Promote ModelProvider.capabilityTier = max(model tiers in profile).
   d. Run Probes for each model × supported task type.
   e. Mark status=active only after probes return at least one
      successful task evaluation.
2. For cloud providers (Anthropic, OpenAI, etc.):
   a. Skip auto-probe (requires credentials user hasn't entered yet).
   b. Status stays unconfigured until user provides credentials.
3. Idempotent — re-running is safe and produces no duplicates.
4. Async/non-blocking — portal serves traffic during bootstrap;
   AI Coworker setup wizard renders "Still warming up..." until ready.
```

Existing buttons remain (`Sync Models & Profiles`, `Run Probes`, `Update Providers`) — they become manual triggers for IT pros who want to re-bootstrap on demand. They are no longer required for normal use.

### 6.4 AI Providers setup wizard redesign

Current setup step is titled "AI Providers — configure inference engines" and shows 22 rows of providers, most `unconfigured`, with tier badges, model counts, capability matrices, and audit-cost columns.

New design:

- **Title**: "Set up your AI assistant"
- **Single question**: *"How smart should your AI assistant be?"*
  - **Option A (default, pre-selected): "Built-in (free, runs on your computer)"** — uses the local Docker Model Runner installation that the installer just set up.
  - **Option B: "Cloud (paid, more capable)"** — exposes a single sub-question: "Which service?" with three icon choices (Anthropic Claude, OpenAI ChatGPT, Google Gemini) and a single field per choice: *"Paste your API key"*. Includes a link: *"How do I get an API key?"* with step-by-step instructions.
- **Advanced settings toggle** at the bottom of the page: clicking expands the full current provider matrix UI for IT-pro users.
- **Status indicator**: above the question, a single sentence — *"Your built-in AI assistant is ready."* (or *"Still warming up..."* if bootstrap hasn't completed).

The setup wizard does not advance past this step until the AI assistant is verifiably reachable. The user cannot land on a portal where the coworker is broken.

### 6.5 AI Coworker error message catalog

Every user-facing error path that currently exposes internal state strings must be replaced with a human message. Catalog:

| Internal state | Default user sees | Recovery action |
|---|---|---|
| `No active endpoint manifests found` | "Your AI assistant is still warming up. This usually takes about a minute on first start." | Auto-retry every 10s for 2 min; then surface "Still warming up — give it another minute or refresh the page." |
| `pull may have failed` | "Couldn't download your AI assistant. Check your internet connection and try again." | Button: [Retry download] |
| `Docker Model Runner is not running` | "The AI engine on your computer isn't running. We'll start it for you." | Auto-action: `docker desktop enable model-runner` + retry. |
| `Provider unconfigured` | "Your built-in AI assistant is ready. Want a cloud upgrade?" | Button: [No thanks, use built-in] / [Yes, upgrade] |
| `Tier mismatch` (e.g. coworker needs strong, only basic available) | Never shown to default user — auto-resolved by tier-promotion in §6.3. | n/a |

All advanced/raw error strings remain visible behind the **Diagnostics** toggle in the coworker panel for IT pros. Default users never see them.

### 6.6 Progressive disclosure UI patterns

Every advanced-settings surface follows this pattern:

- **Default**: hidden. Replaced with a one-sentence summary describing what the section controls and a default value.
- **"Advanced settings" toggle**: a single chevron at the bottom of each major page that expands ALL advanced surfaces for that page at once.
- **State persistence**: per-user. A power user who expands once stays expanded; a default user who never expands never sees it.
- **No nested toggles.** One Advanced/Default state per page, not five.

Affected pages (initial scope):

- `/platform/ai/providers` — collapses to "Your AI assistant is ready" + Advanced toggle
- `/platform/ai/assignments` — collapses to "Auto-routing on" + Advanced toggle
- `/platform/ai/providers/local` — collapses to "Built-in AI: ready, running locally" + Advanced toggle
- AI Coworker right-panel — `CONFIDENTIAL / HANDS OFF / EXTERNAL ACCESS OFF / DIAGNOSTICS` row hidden behind Advanced

## 7. Acceptance Criteria

The spec ships when a clean cold install on Windows 11 / macOS / Linux completes the following round-trip with **zero user interaction beyond the initial install-dpf invocation and answering the single setup-wizard question:**

1. User runs `install-dpf.ps1` (or `bash install-dpf.sh`) per README.
2. Installer completes through Step 8 and prints: `✓ Your AI assistant said: <real reply text>. Setup complete.`
3. User opens browser to `localhost:3000`, signs in with installer-generated credentials.
4. Portal shows setup wizard with "Set up your AI assistant" and a status line: *"Your built-in AI assistant is ready."*
5. User picks "Built-in (free)" (the default) and clicks Continue.
6. User lands on the workspace. AI Coworker panel responds to "hello" within 30 seconds.
7. **No error message containing the words** *manifest, profile, tier, probe, endpoint, capability, unavailable* **appears at any point in this flow** for the default-persona user.
8. **`nvidia-smi` (or platform equivalent) shows the llama-server PIDs holding non-zero VRAM** after the first AI Coworker call. CPU-only inference fallback in the presence of a usable GPU is a defect, regardless of whether the conversation eventually completes.

Power-user acceptance criteria (separate):

- All current advanced settings remain reachable via "Advanced settings" toggles.
- IT-pro user with explicit needs (pin a specific model, configure a specific tier, run a manual probe) can do everything they can today.
- The platform exposes diagnostics for IT troubleshooting; they are never the default failure path for a non-technical user.

## 8. Open Questions

1. **Should `/api/internal/first-run-bootstrap` be a real endpoint or a script the installer runs inside the portal container?** Pros of endpoint: testable, idempotent, reusable for future "Reset AI Setup" UX. Pros of in-container script: simpler initial implementation.
2. **What does the cloud-LLM upgrade flow look like for someone who DOES have an API key?** A separate spec on cloud-provider onboarding may be warranted — the current 22-row provider matrix needs the same simplification treatment.
3. **How do we handle a user who installs on a machine that can't run any local LLM** (low VRAM, no Docker Model Runner support)? Falls back to requiring a cloud API key at setup time. The setup wizard would need a different first screen in that case.
4. **What metrics tell us this worked?** Suggested: install-completion rate, time-to-first-coworker-reply, % of installs that surface an internal-state error string to the default user. Captured separately as observability spec.

## 9. Related Tracked Work

Open follow-up items surfaced during the 2026-05-23 cold install:

- Task #13: Portal auto-probes local provider on boot (subsumes §6.3 here)
- Task #14: Installer model selection mismatches platform catalog (subsumes §6.2 here)
- Task #15: Portal Coworkers catalog shows wrong qwen3 pull tags (separate hotfix; should land before this spec is fully executed)
- Task #16: Refresh button doesn't create ModelProfile rows (subsumes §6.3 step 1b)
- Task #17: ModelProvider.capabilityTier not derived from model tiers (subsumes §6.3 step 1c)
- Task #18: Run Probes mislabeled "Optional diagnostics" (subsumes §6.3, §6.4)
- Task #20: Probe HTTP timeout shorter than cold model load (largely subsumed by #21 — GPU inference makes the existing timeout adequate; remaining hardening is async/sequential probe execution, captured in §6.3)
- **Task #21: Installer must enable Docker Model Runner GPU-backed inference (subsumes §6.2 Step 8.2 — THE highest-impact item in this spec; without it, every other change is materially less effective)**
- PR #1044: Installer enables Docker Model Runner before pull (lands ahead of this spec, prerequisite)

This spec consolidates all of the above into one coherent first-run UX. Per the standing process, this spec is committed to main and fed to `writing-plans` to be broken into Build Studio work items.
