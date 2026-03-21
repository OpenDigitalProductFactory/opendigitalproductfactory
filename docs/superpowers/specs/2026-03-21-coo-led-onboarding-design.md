# EP-ONBOARD-001: COO-Led Platform Onboarding

**Status:** Draft
**Date:** 2026-03-21
**Epic:** AI-Assisted Platform Setup & Provider Education
**Dependencies:** Ollama bundled in Docker, existing agent coworker infrastructure, provider registry

---

## Problem

New platform users — typically non-technical business owners in regulated industries — are dropped into a manual provider configuration page with no guidance. They don't understand:

- Why AI providers matter or how they differ
- What "sensitivity clearance" or "capability scores" mean
- That the platform itself is a privacy-safe AI deployment option
- What Ollama is, why it's running locally, or what its limitations are
- How to connect a cloud provider or why they'd want to
- How to configure foundational business settings (identity, branding, financials)

There is no setup wizard, no onboarding checklist, and no first-run experience. The platform assumes technical familiarity that the target user does not have.

## Solution

An AI Coworker-led onboarding experience where the platform's COO persona guides the user through initial setup. The COO is honest about its own limitations (running on a local model), explains provider options in plain language, and walks the user through foundational configuration at their own pace.

### Design Principles

1. **The COO is the host.** Not a setup wizard that disappears — the user's ongoing operational partner, introducing itself and the platform on day one.
2. **Honest about limitations.** The COO explicitly states it's running on a local model, explains what that means, and frames cloud providers as a capability upgrade rather than a mysterious configuration step.
3. **The platform leads with privacy.** Local AI is presented as the default and safest option. Cloud is an upgrade. Enterprise private cloud is best-of-both-worlds. This framing serves regulated-industry users.
4. **Interruptible and resumable.** The user can complete, skip, or pause any step. Returning later picks up exactly where they left off.
5. **Real pages, not throwaway wizard.** Each setup step uses the actual platform settings page for that area. The user learns where things live while configuring them.
6. **Professional and understanding.** The COO persona is a competent second-in-command — warm but not cute, transparent, never condescending.

---

## Architecture

### 1. Ollama Auto-Bootstrap

When the platform starts for the first time (Docker Compose), the Ollama container is already running as a bundled service.

**Integration with existing infrastructure:** The bootstrap extends the existing `checkBundledProviders()` function in `apps/web/lib/ollama.ts` rather than creating a parallel first-run path. The existing function already pings Ollama, detects models, and sets provider status. The bootstrap adds first-run detection and model auto-pull to this existing flow.

On first page load:

1. Detect first-run: no `Organization` record exists in the database AND no `PlatformSetupProgress` record with `completedAt` set. This two-condition check avoids false positives from seeded dev data — if an org exists from `db:seed`, skip onboarding.
2. Call `checkBundledProviders()` — pings Ollama at `http://localhost:11434/api/tags`, confirms alive.
3. Check if a model is pulled. If not, auto-pull `llama3.1:8b` with **real-time progress reporting**. The Ollama `/api/pull` endpoint streams progress events (download percentage, layer extraction). The UI renders a progress bar with status text: "Downloading AI model... 45% (2.1 GB / 4.7 GB)". Timeout: 15 minutes. If the pull stalls for >60 seconds with no progress, mark as failed.
4. Within `checkBundledProviders()`, set Ollama provider to `status: "active"`. Sensitivity clearance is set to `["public", "internal", "confidential", "restricted"]` — this is used by the V2 routing pipeline's hard filter in `pipeline-v2.ts` (the `sensitivityClearance.includes()` check). Note: the legacy `isProviderAllowedForSensitivity()` in `agent-sensitivity.ts` uses a separate code path that checks `isLocalProvider()` directly — both paths allow Ollama for all levels, so they are consistent.
5. Create the `onboarding-coo` agent definition if it doesn't exist (see Section 5).
6. Create a `PlatformSetupProgress` record with all steps set to `"pending"`.
7. Redirect to `/setup`.

**Model selection rationale:** `llama3.1:8b` balances capability with resource usage. Per existing feedback, local models must leave 30%+ VRAM headroom. The 8B parameter model fits within this constraint on most consumer GPUs (6GB+ VRAM). The platform detects available VRAM via Ollama's `/api/ps` endpoint and selects appropriately.

**Failure path:** If Ollama is unreachable, model pull times out, or pull fails, the platform renders a static welcome page with:
- What went wrong (in plain language)
- Manual instructions for starting Ollama or pulling a model
- A "Retry" button that re-runs the bootstrap
- An option to paste a cloud API key instead (bypasses Ollama requirement)

The COO experience begins once any working LLM is available.

**Volume/DB mismatch:** If the database is cleared but the Ollama Docker volume retains a pulled model (or vice versa), the bootstrap handles both cases: it checks for models regardless of DB state, and creates missing DB records regardless of model state. No inconsistency arises because each check is independent.

### 2. Setup State Machine

Setup progress is persisted in the database so the user can pause and resume across sessions.

```
PlatformSetupProgress {
  id: string
  userId: string?                        // Null until Step 2 creates the owner account
  organizationId: string?                // Null until Step 1 creates the org
  currentStep: string                    // "business-identity", "ai-capabilities", etc.
  steps: {
    [stepId]: "pending" | "completed" | "skipped"
  }
  context: {                             // Accumulated from user interactions
    orgName?: string
    industry?: string
    hasCloudProvider?: boolean
    skippedSteps?: string[]
  }
  pausedAt?: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
}
```

**Foreign key lifecycle:** The setup record is created during bootstrap (Section 1, step 6) with `userId` and `organizationId` both null. After Step 1 creates the organization, `organizationId` is populated. After Step 2 creates the owner account, `userId` is populated. This avoids the chicken-and-egg problem — the record exists before either entity.

**Thread association:** The COO conversation thread uses the existing `AgentThread` system with `contextKey: "setup/onboarding"`. No separate `conversationThreadId` field is needed on the setup progress table. The thread is resolved via the standard `getOrCreateThreadSnapshot` infrastructure, keyed by `contextKey` and `userId` once available.

**Resume behavior:** When the user returns after pausing, the platform loads the setup progress, resolves the COO thread via `contextKey: "setup/onboarding"`, and navigates to the current step page. The COO acknowledges the break: "Welcome back. Last time we finished setting up your business identity. Ready to continue with branding, or would you prefer to skip ahead?"

**Completion:** When all steps are completed or skipped, the setup record is marked complete. The `/setup` route redirects to the main workspace. The setup can be re-entered from Platform Settings if the user wants to revisit skipped steps.

### 3. Pre-Auth Session Strategy

Steps 1 and 2 occur before a user account exists, but the existing agent coworker infrastructure (`sendMessage` in `agent-coworker.ts`) requires an authenticated user via `requireAuthUser()`.

**Solution: Two-phase onboarding.**

- **Phase 1 (Steps 1-2): System-driven, no LLM chat.** The Business Identity and Owner Account steps render as standard form pages with static COO guidance text (the welcome message and account creation instructions shown in the step descriptions below). No live chat panel — the COO's introductory messages are pre-written and rendered as styled text blocks alongside the forms. This avoids the auth dependency entirely.
- **Phase 2 (Steps 3-8): COO-driven, live chat.** Once the owner account is created (Step 2 complete), the user is automatically logged in. From Step 3 onward, the full COO chat panel is active and the `onboarding-coo` agent handles the conversation through the standard `sendMessage` infrastructure.

This split is natural — the first two steps are simple data entry that doesn't need AI guidance, while the AI Capabilities step (Step 3) is where the COO's explanatory value begins.

### 4. Hybrid UI Layout

Each setup step renders as a two-panel layout, reusing the existing `CoworkerPanel` component for the chat side (Phase 2 steps only).

```
+------------------------------------------+------------------+
|                                          |                  |
|         Setup Page Content               |   COO Chat       |
|         (real platform page)             |   Panel          |
|                                          |                  |
|  [Form fields, uploads, selections]      |  [Conversation]  |
|                                          |                  |
|                                          |  [Input field]   |
+------------------------------------------+------------------+
```

- **Left panel (70%):** The actual settings page for the current step. Forms, uploads, toggles — standard platform UI. These pages persist as the permanent admin pages after onboarding.
- **Right panel (30%):** In Phase 1 (Steps 1-2): static COO guidance text. In Phase 2 (Steps 3-8): the live `CoworkerPanel` with the `onboarding-coo` agent.

**Navigation:** A minimal progress bar at the top shows steps and their states. The user can click any step to jump to it (with COO acknowledgment in Phase 2). At the bottom of each step, three options:

- **Continue** — mark step complete, move to next
- **Skip for now** — mark step skipped, move to next
- **Pause and come back later** — save state, exit to a landing page

### 5. Page-Chat Coordination

Applies to Phase 2 steps only (Steps 3-8, after user is authenticated).

Each setup page emits events when the user interacts. These events are injected into the COO conversation as system context so the agent can react.

**Event flow:**

1. User fills in a field or completes an action → page emits a typed event to a client-side `SetupEventQueue`.
2. The queue debounces on a 500ms idle timer (client-side, in the React component). When the timer fires, all queued events are batched into a single system message appended to the COO conversation.
3. If the COO is still generating a response when a new batch arrives, the new batch is held until the current response completes. Events are never dropped — they queue. This prevents interleaving that would confuse the local model.
4. COO responds contextually to the batch.

**Event types:**

| Event | Trigger | COO Response Pattern |
|-------|---------|---------------------|
| `field_updated` | User fills a form field | Acknowledge and guide to next field |
| `step_completed` | User clicks Continue | Summarize what was configured, introduce next step |
| `step_skipped` | User clicks Skip | Acknowledge, note they can return, move on |
| `error` | Validation or connection failure | Explain what went wrong in plain language, suggest fix |
| `provider_test_success` | API key validated | Confirm connection, describe what's now available |
| `provider_test_failure` | API key rejected | Explain the error, suggest common fixes |

**Inference latency:** On a local model, responses may take 5-10+ seconds. The UI shows a typing indicator in the COO panel during inference. The user can continue interacting with the left panel while the COO is thinking — events continue to queue and will be delivered in the next batch.

### 6. Onboarding COO Agent Definition

A dedicated agent — `onboarding-coo` — with a system prompt tuned for the setup flow.

**Agent schema mapping:** Uses the existing `Agent` table. The `type` field is set to `"onboarding"` (a new agent archetype alongside existing types like `"specialist"`). No schema migration needed — `type` is a free-text string.

**Route resolution:** Add `/setup` to `ROUTE_AGENT_MAP` in `agent-routing.ts`, mapping to `agentId: "onboarding-coo"`. Also add `/setup` to `ROUTE_SENSITIVITY` in `agent-sensitivity.ts` with sensitivity `"internal"` to make the intent explicit rather than relying on the default fallthrough.

**Task type registration:** Add `"onboarding"` to the `TASK_TYPES` list in `task-classifier.ts` so the routing pipeline recognizes it. Default reasoning depth: `"minimal"` (matching `"greeting"` — this is guided conversation, not complex reasoning).

**Tool suppression:** The `onboarding-coo` agent runs with **no tools injected**. The `sendMessage` function in `agent-coworker.ts` calls `getAvailableTools()` and `getActionsForRoute()` — for the onboarding agent, both must return empty arrays. This is critical because `llama3.1:8b` cannot reliably orchestrate tool calls (per existing feedback: "Haiku can't orchestrate multi-step tools. System drives execution, Haiku handles conversation only." — the same applies to local models). The COO's job is conversation only; all setup actions (creating org, saving branding, testing providers) are triggered by the user clicking UI buttons, not by the COO calling tools.

**Configuration:**

| Field | Value |
|-------|-------|
| `agentId` | `onboarding-coo` |
| `type` | `onboarding` |
| `sensitivity` | `internal` |
| `preferredProviderId` | `ollama` (guaranteed available) |
| `persona` | COO — professional, understanding, transparent |

**System prompt structure:**

```
You are the platform's Chief Operating Officer — the user's second-in-command.
You are guiding a new platform owner through initial setup.

This is a CONVERSATION request. You have no tools. Do not attempt to call
functions, execute actions, or generate structured output.

IMPORTANT CONSTRAINTS:
- You are running on a local AI model (Ollama). Be honest about this.
- Do not attempt complex reasoning, multi-step analysis, or tool orchestration.
- Your job is guided conversation: explain, recommend, and acknowledge.
- If the user asks something beyond your capability, say so clearly and note
  that a cloud AI provider would handle it better.

CURRENT STATE:
- Step: {currentStep}
- Completed: {completedSteps}
- Skipped: {skippedSteps}
- Industry: {industry}
- Has cloud provider: {hasCloudProvider}

TONE:
- Professional and understanding. Not cute, not robotic.
- Frame yourself as their operational partner, not a setup wizard.
- Use "we" when describing platform capabilities.
- Be direct about trade-offs — don't oversell.

AT EVERY STEP BOUNDARY, offer three options:
1. Continue to the next step
2. Skip this step for now
3. Pause and come back later
```

The system prompt is assembled dynamically from the setup state, injecting the current step context and accumulated user information. The "This is a CONVERSATION request" prefix follows existing convention for conversation-only agent interactions (per feedback: conversation skills must strip tools and prefix accordingly).

---

## Setup Steps

### Step 1: Business Identity

**Page:** Organization settings (name, industry, location)
**COO introduction:**

> "Welcome. I'm your AI operations officer — think of me as your second-in-command for running this platform.
>
> I should be upfront: I'm running on a local AI model right now. That means I can handle this walkthrough and day-to-day conversations, but for complex tasks like regulatory analysis, document processing, or deep research, we'll want to connect a more capable AI service. I'll help you with that in a few steps.
>
> Let's start with the basics — what's your business called?"

**Fields:** Organization name, industry/sector (dropdown + freetext), primary location, timezone.
**COO behavior:** Uses industry selection to tailor later recommendations. Stored in setup context for use in subsequent steps.

### Step 2: Owner Account

**Page:** User profile creation
**COO context:**

> "Now let's set up your account. You'll be the platform owner — full access to everything. You can add team members later and control what each person can see and do."

**Fields:** Name, email, password.
**COO behavior:** Brief explanation of role hierarchy. No deep dive — just enough to understand they're the owner.

### Step 3: AI Capabilities

**Page:** AI Providers overview (simplified view for onboarding)
**COO context:**

This is the most important educational step. The COO explains three tiers:

**Tier 1 — This Platform (Local AI):**

> "Right now, I'm running entirely on your system. Your data never leaves this machine. Everything — conversations, documents, analysis — stays within the platform's own database. This is the safest option for regulated industries. It meets privacy requirements by design because there's no third party involved. The trade-off is capability: I can handle conversations and guided tasks, but I'm limited by the hardware you're running on."

**Tier 2 — Cloud AI Services:**

> "Services like Anthropic or OpenAI provide more powerful models. Your data is sent to their servers for processing. The platform controls which tasks are allowed to use cloud services based on sensitivity — for example, admin-level operations always stay local. You decide what's acceptable for your business."

**Tier 3 — Enterprise / Private Cloud:**

> "For organizations that need cloud-level capability with local-level privacy, services like Azure OpenAI or AWS Bedrock can run in your own cloud environment. Your data stays within your infrastructure. This requires more setup and typically an enterprise contract. We can explore this later if it's relevant."

**Cost explanation:**

> "Local costs electricity only. Cloud services charge per use — roughly like a utility bill. A typical business conversation costs fractions of a penny. Complex analysis might cost a few cents. I'll always let you know before doing something expensive."

**Action:** The COO asks: "Would you like to add a cloud AI provider now, or stick with local for today?"

If yes → guided API key entry with live test. COO reports results: "Connected successfully. I can see 3 models available from Anthropic. The platform will use those for complex tasks and keep using the local model for everyday conversation to save costs."

If no → COO acknowledges and moves on. The platform works with Ollama alone for basic tasks.

**Industry-specific tailoring:** If the user selected healthcare in step 1: "Since you're in healthcare, you'll want to be thoughtful about which tasks use cloud services. The platform enforces this automatically through sensitivity levels — I can show you how that works when we get to your workspace."

### Step 4: Branding

**Page:** Branding settings
**COO context:**

> "This is what your customers and team will see. Your logo and colors appear on your storefront and any materials the platform generates."

**Fields:** Logo upload, primary/secondary colors, tagline.
**COO behavior:** Minimal guidance — this is a creative step. COO acknowledges uploads and selections but doesn't over-direct.

### Step 5: Financial Basics

**Page:** Financial settings
**COO context:**

> "A few financial basics so the platform can handle pricing and billing correctly."

**Fields:** Default currency, tax configuration, payment provider connection (if applicable).
**COO behavior:** Adapts based on industry. Retail/services → emphasizes payment setup. Consulting/B2B → notes this can be skipped if they invoice externally. Flags which fields are required vs. optional.

### Step 6: First Workspace

**Page:** Workspace creation
**COO context:**

> "Workspaces are where your team does their day-to-day work. Let's create your first one."

**Fields:** Workspace name, optional description.
**COO behavior:** Creates a default workspace. Briefly explains that agents (AI coworkers) operate within workspaces and can be customized per workspace.

### Step 7: Platform Extensibility (Preview)

**Page:** Informational card (no form fields — this is a preview, not configuration)
**COO context:**

> "One thing that makes this platform different — if you need something that isn't built in, the platform can help you build it. You describe what you need, and the AI workforce develops it: new workflows, reports, integrations, whatever your business requires.
>
> Anything you build can be kept private or donated back to the community so other businesses benefit too.
>
> Would you like me to walk you through a quick example of how that works?"

If yes → placeholder for guided demo (separate epic — see **EP-ONBOARD-002**).
If no → COO notes it: "No problem. When you're ready, you'll find the Build Studio in your workspace."

**Note:** The extensibility demo is tracked as a separate epic (EP-ONBOARD-002) since the self-development pipeline is still evolving. This step provides awareness without requiring the full pipeline to be complete.

### Step 8: What's Next

**Page:** Summary card with checklist
**COO context:**

> "Here's what we've set up: [summary of completed steps]. [If skipped steps exist:] You skipped [list] — you can come back to those anytime from Platform Settings.
>
> A few things to explore when you're ready:
> - [If no cloud provider:] Adding a cloud AI provider will unlock the platform's full capability. You'll find that under Platform > AI Providers.
> - Your workspace is ready — you can start using the platform right away.
> - I'll be here whenever you need help. Just open the chat panel.
>
> Welcome aboard."

---

## Provider Reference Data

A structured reference stored alongside the provider registry, queryable by the COO when users ask about providers post-onboarding.

**Per-provider fields:**

| Field | Example (Anthropic) |
|-------|-------------------|
| `plainDescription` | "AI research company. Their Claude models excel at analysis, writing, and code." |
| `authExplained` | "API key — a password you get from their website (console.anthropic.com)." |
| `costTier` | "pay-per-use" |
| `costExplained` | "Charges per use. A short conversation costs less than $0.01. A long document analysis might cost $0.05-0.20." |
| `capabilitySummary` | "Strong at reasoning, document analysis, code generation, and following complex instructions." |
| `limitations` | "Data is processed on Anthropic's servers. Not suitable for tasks requiring data to stay on-premise." |
| `dataResidency` | "United States (Anthropic servers) or selected cloud regions." |
| `setupDifficulty` | "easy — paste an API key" |
| `regulatoryNotes` | "SOC 2 Type II certified. Suitable for most business data. Consult compliance team for healthcare/financial PII." |

**Platform-local entry:**

| Field | Value |
|-------|-------|
| `plainDescription` | "AI running entirely on your own hardware. No data leaves your system." |
| `authExplained` | "None needed — it's already running on your machine." |
| `costTier` | "free (electricity only)" |
| `costExplained` | "Costs only the electricity to run your computer. No per-use charges." |
| `capabilitySummary` | "Handles conversation, simple summaries, guided tasks, and basic analysis. Limited by your hardware." |
| `limitations` | "Cannot match cloud models for complex reasoning, large document processing, or specialized tasks like code generation." |
| `dataResidency` | "Your machine. Nothing leaves." |
| `setupDifficulty` | "automatic — already configured" |
| `regulatoryNotes` | "Maximum privacy. Suitable for all sensitivity levels including restricted/regulated data." |

This data is stored in the provider registry JSON (extending the existing `providers-registry.json`) and loaded by the COO agent when the user asks provider comparison questions.

---

## Post-Onboarding Integration

The COO doesn't disappear after setup.

### Provider Page Help
When a user visits Platform > AI Providers after onboarding, the COO panel is available with context-aware help:

- Explains provider status changes ("Anthropic is showing as degraded — this usually means a rate limit was hit. It will recover automatically.")
- Translates sensitivity clearance ("This provider isn't used for admin-level tasks because that data stays private on your local model.")
- Shows cost context ("You've spent $3.42 on Anthropic this month, mostly from document analysis tasks.")

### Setup Resume
If the user skipped steps during onboarding, a subtle banner appears on relevant pages: "You haven't configured branding yet. Would you like to do that now?" Clicking opens the setup step with the COO panel.

### Skipped Step Reminders
The COO can reference skipped steps in regular conversation: "I notice we haven't set up a cloud AI provider yet. For the analysis you're asking about, I'd need a more capable model. Would you like to set that up now?"

---

## Data Model Changes

### New: `PlatformSetupProgress` Table

```prisma
model PlatformSetupProgress {
  id                    String        @id @default(cuid())
  userId                String?       // Null until Step 2 creates owner account
  organizationId        String?       // Null until Step 1 creates org
  currentStep           String        @default("business-identity")
  steps                 Json          // { [stepId]: "pending" | "completed" | "skipped" }
  context               Json          // Accumulated setup context
  pausedAt              DateTime?
  completedAt           DateTime?
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt

  user                  User?         @relation(fields: [userId], references: [id])
  organization          Organization? @relation(fields: [organizationId], references: [id])
}
```

Note: COO conversation thread uses the existing `AgentThread` system with `contextKey: "setup/onboarding"` rather than a separate FK on this table.

### Extended: `providers-registry.json` — `userFacing` Block

Each provider entry in the existing registry gains a `userFacing` block. This data is **seeded into a new `userFacingDescription` JSON column on `ModelProvider`** during the registry sync job (the same way other registry fields are synced). It is NOT read from the filesystem at runtime — this avoids a filesystem dependency in Docker deployments.

```json
{
  "providerId": "anthropic",
  "userFacing": {
    "plainDescription": "AI research company...",
    "authExplained": "API key — a password you get from...",
    "costTier": "pay-per-use",
    "costExplained": "Charges per use...",
    "capabilitySummary": "Strong at reasoning...",
    "limitations": "Data is processed on...",
    "dataResidency": "United States...",
    "setupDifficulty": "easy",
    "regulatoryNotes": "SOC 2 Type II certified..."
  }
}
```

**Platform-local entry:** The `userFacing` block is added to the existing `ollama` provider entry — NOT as a separate `platform-local` provider. The existing `providerId: "ollama"` already represents the local deployment (`costModel: "compute"`, `authMethod: "none"`, checked by `isLocalProvider()` throughout the codebase). Creating a second entry would cause routing confusion. The `userFacing` data on the `ollama` entry frames it as "This Platform (Local AI)" in the onboarding UI.

**Cost explanation accuracy:** The COO's cost explanations during onboarding use the actual pricing data from the `ModelProvider` table (`inputPricePerMToken`, `outputPricePerMToken`) at runtime, not hardcoded estimates. The system prompt includes a brief cost summary generated from live data: "Based on current pricing, a typical conversation costs approximately $X."

### New: `ModelProvider` Column

```prisma
// Add to existing ModelProvider model:
userFacingDescription  Json?  // Seeded from providers-registry.json userFacing block
```

### New: Agent Definition — `onboarding-coo`

Seeded during first-run bootstrap alongside the Ollama auto-setup. Uses the existing `Agent` table with:

- `agentId: "onboarding-coo"`
- `type: "onboarding"`
- `sensitivity: "internal"`
- `preferredProviderId: "ollama"`
- System prompt: dynamically assembled from setup state (see Section 6)

---

## Related Epics

| Epic | Scope | Status |
|------|-------|--------|
| **EP-ONBOARD-001** (this spec) | COO-led onboarding, provider education, setup state machine | Draft |
| **EP-ONBOARD-002** | Extensibility demo — guided walkthrough of Build Studio self-development | Planned (parked) |
| **EP-INF-003** | ModelCard schema for full provider metadata | Draft |
| **EP-OAUTH-001** | OAuth authorization code + PKCE for subscription providers | Draft |

**Backlog entry:** Per project convention, a corresponding Epic record must be seeded in the database before implementation begins. The implementation plan will include a seed script for EP-ONBOARD-001 and EP-ONBOARD-002.

---

## Out of Scope

- Build Studio self-development demo (EP-ONBOARD-002)
- OAuth authorization code flow setup during onboarding (EP-OAUTH-001 — not ready)
- Multi-tenant onboarding (single-org focus for now)
- Agent workforce configuration during onboarding (post-setup exploration)
- Storefront archetype selection during onboarding (separate flow, already exists)

---

## Success Criteria

1. A non-technical business owner can go from Docker Compose up to a working platform with zero prior knowledge.
2. The user understands what local AI means, why it's private, and what its limitations are.
3. The user can optionally add a cloud provider with guided help.
4. Setup can be paused and resumed across sessions without losing progress.
5. The COO persona is consistent — professional, understanding, transparent about limitations.
6. Every setup page is a permanent admin page, not throwaway wizard UI.
7. Provider education content is accurate, plain-language, and queryable post-onboarding.
