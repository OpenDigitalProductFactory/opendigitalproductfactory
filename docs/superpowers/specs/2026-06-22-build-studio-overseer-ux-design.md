# Build Studio — Overseer-Grade Single-Build UX (Solution & Oversight layer)

- **Status:** DESIGN-ONLY (no code in this PR). Implementation lands via Build Studio / the normal PR path after the design is accepted.
- **Date:** 2026-06-22
- **Epic:** [EP-BUILD-STUDIO-UX](https://example.invalid) — "Build Studio UX Redesign — workflow-primary canvas, anchored inspectors, compact fleet" (extends; no new epic — `check-epic-overlap-before-creating`).
- **Author:** Claude Code (external coding agent), founder-directed `/goal`.
- **Relates to:** EP-NAV-COHERENCE (load is felt on surfaces), the cognitive-load-migration work (`docs/superpowers/specs/2026-06-19-…`), and the in-flight layout redesign (BI-7BBD930F, `2026-05-20-build-studio-layout-redesign-design.md`).
- **Mockup:** rendered live for founder reaction on 2026-06-22 (visualize/show_widget — `build_studio_solution_oversight_layer`).

---

## 1. Problem & founder framing

As DPF's build process becomes more autonomous, the human's role shifts from **operator** (driving the steps) to **overseer** (judging the decisions, approving the outcome, intervening only when something looks off). Build Studio's single-build watching UX is still **operator-grade**: it presents status + a process diagram, and clicking through reveals more *technical* detail with little plain-language meaning or instruction. Specifically, for a non-technical user (the "Dale" persona):

1. **No plain summary of the SOLUTION being built** — only `designDoc` prose + a live sandbox preview button; no curated "here is what we're building, in your words."
2. **No plain summary of the CHANGES made** — the "summary" the user sees is the first 500 characters of the *raw git diff* (see §3); there is no "we added X so your customers can Y."
3. **The WWMD/governance decisions are hard to find** — they are persisted but buried in a collapsed drawer, jargon-framed, and the kernel/`principle_decide` decisions are not surfaced in the build UI at all.

2026-06-29 founder extension: the Build Studio AI Coworker should act as the **custodian of the build**, not as a passive status wall. When a user presses a recovery button and the surface appears inert, the coworker should notice the quiet/stuck state, explain "why now" in one line, and offer the one safest next action. This is the Build Studio pilot for the cross-coworker [Attention Surface proactive custodian mode](2026-06-23-human-attention-surface-design.md#34-proactive-custodian-mode--quiet-until-useful) (`BI-5B6F666F`); the Build Studio implementation item is `BI-ACB04A21`.
4. **The many human-help stops do not say what to actually DO** — most stops have a working button, but the message is technical ("Failure axis: rate-limit") and review-failures punt the user back to chat.

**The reframe to hold:** operator-grade UX (drive the steps) vs. overseer-grade need (judge the work). The deliverable is an **oversight layer for non-technical users — not the removal of the engineer surfaces.** Default plain and minimal; dive into detail only when something looks off.

---

## 2. Substrate map (verified 2026-06-22 — re-checked before building on it)

The architecture is denser than a first read suggests. Verified by code investigation this session (`dpf-verify-substrate-first`):

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Progressive disclosure already exists | CONFIRMED | `BuildStudio.tsx` default = canonical-backlog strip + compact `BuildStudioWorkflowActionCard` + `ProcessGraph` (primary canvas); engineer detail behind the collapsed `DetailsDrawer` (`buildDetailsDrawerSections`, lines ~881–938). Internal IDs already hidden by default (BI-63EAD801, lines 119–133). |
| The detail is engineer-grade | CONFIRMED | Drawer sections render `taskResults`, `buildExecState`, `verificationOut`, raw `diffPatch`, Scout findings JSON (`CanonicalDocSection`, `ReviewPanel` `CodeChangesSection` ~625–701). |
| WWMD/deliberation persisted + partially surfaced | CONFIRMED (findability gap) | `FeatureBuild.deliberationSummary Json?` (`schema.prisma:4686`) rendered by `DeliberationSummaryCard.tsx` — but **only** inside `FeatureBriefPanel` (lines 65/96/181/201) and `ReviewPanel` (line 43), **both of which live inside the collapsed `DetailsDrawer`**. Never at top altitude. |
| Kernel/`principle_decide` decisions are NOT in the build UI | CONFIRMED | `DecisionInteraction` (`schema.prisma:9881`) is written by `persistDecisionInteraction()` (`decision-perspective/persistence.ts:195`) at the plan→build gate (`advance-phase/route.ts:125–135`). It is read only by `/platform/ai/founder-review` and `/platform/ai/decisions/[interactionId]` and `coworker-record/load-record.ts` — **nothing in `components/build/**` surfaces it.** |
| "Visual design of the solution" | CONFIRMED (gap) | Only `designDoc` text (problem/approach/data-model — `FeatureBriefPanel.tsx:88–173`) + the live sandbox `OpenSandboxButton`. No curated "here is what we built." |
| **`build.diffSummary` is the change summary** | **CORRECTED — sharper than the brief stated** | The field is **not empty**: it is auto-written as `fullDiff.slice(0, 500)` — the first 500 chars of the *raw git diff*, truncated mid-hunk — at three sites: `build-pipeline.ts:646`, `sandbox-promotion.ts:216`, `mcp-tools.ts:10403`. `FeatureBriefPanel.tsx:68–71` renders it in a `<pre>` **labeled as a summary**. So the user is shown engineer-grade raw-diff text at the wrong altitude — worse than nothing, because it *looks* like the summary. |
| Human-help stops have actionable buttons | CONFIRMED | `deriveBuildStudioWorkflowAction` (`build-studio-workflow-actions.ts`) emits 11 action kinds (approve-start, advance-phase, run-review-verification, record-acceptance, retry-build, reset-build, resume-implementation, decompose-now, amend-parent-design, rerun-plan-review, review-only) each with a button. Escalation is sophisticated (`escalate-build-to-human.ts` → `PlatformIssueReport` → `/ops` EscalationsAttention). |
| …but the messages are technical + review-failures punt to chat | CONFIRMED | e.g. `"Failure axis: out-of-scope-noise. …"` (`buildResumeAction`); the `review` recoverable-concern branch hands the user to the coworker chat (`coworkerPrompt`) rather than a guided in-place action. |

**Net:** three of the four overseer answers are a **findability/altitude/translation gap over data that already exists**; one ("what's changing") is a **content gap** (the field exists but carries the wrong content). This is high-ROI: we surface and translate, we do not invent a new substrate.

---

## 3. Design — the "Solution & Oversight" layer

A plain-language layer answering the four overseer questions becomes the **default first-viewport** of the active-build pane. The engineer-grade surfaces (`ProcessGraph`, raw diff, task evidence, `DetailsDrawer`) are **retained, demoted one disclosure click away** behind a single "Engineer view" affordance. A thin always-visible phase liveness strip (`PhaseMiniRail`) keeps in-flight progress legible so "plain by default" never means "blind to progress."

### 3.1 IA decision (the altitude reframe) — see §6 for the recorded decision

Default the pane to the plain layer (Option B), not an additive band above the graph (Option A) and not an audience-mode toggle (Option C). Rationale and kernel record in §6.

### 3.2 The four bands

Each band: **one overseer question → plain content from an existing/▲new data source → a single "dive in" disclosure down to the engineer surface.** Bands render top-to-bottom; the band where action is needed ("Where we need you") is visually accented and, when active, floats to the top.

| Band | Overseer question | Plain content | Data source | Dive-in link |
| --- | --- | --- | --- | --- |
| **1. What we're building** | "What is this?" | One plain paragraph of intent + a "See it live" preview button. | `designDoc.problemStatement` + `proposedApproach`, rendered plainly (data-model jargon demoted to disclosure); `OpenSandboxButton`. | "Design doc →" (drawer Brief) |
| **2. What's changing** | "What changed and why?" | Headline sentence + 3–5 plain bullets + "Why it matters" + honest "one thing we left open." | ▲**new** `FeatureBuild.changeNarrative` (see §4.1); raw diff stays the dive-in. | "N changed files →" (drawer Review `CodeChangesSection`) |
| **3. The decisions we made & why** | "What calls did the AI make?" | Plain list of "the call / the options / the why," each tagged plan/review/governance, with unresolved risks shown honestly. | ▲**new** `buildDecisionLedger(buildId)` read-model unifying `deliberationSummary` + `DecisionInteraction` (see §4.2). | "All decisions →" (drawer + `/platform/ai/founder-review`) |
| **4. Where we need you** | "What do I do now?" | One plain sentence: *what it means* + *what to do* + the button. Two-choice where applicable (Approve / Something looks off). No jargon, no chat-punt. | `deriveBuildStudioWorkflowAction` (existing) re-skinned to plain copy; extends BI-FD796419. | "Why is it waiting? →" (drawer Progress) |

### 3.3 Band detail

**Band 1 — What we're building.** Translate `designDoc` into a single plain paragraph (the platform already has the structured fields; the band renders `problemStatement` + `proposedApproach` in plain prose and moves `dataModel`/AC lists to the dive-in). The "See it live" button reuses `OpenSandboxButton`. During `ideate`/`plan` (before a design exists) the band shows the captured intent (the originating BI description) instead, so the band is never empty.

**Band 2 — What's changing (the highest-value gap).** A new `changeNarrative` is generated once at the build→review / PR boundary by a **local-first** model (per the fully-local deployment strategy) from `buildPlan` + `designDoc` (the "why") and the diff (the "what"). Rendered as: a one-line headline, 3–5 plain bullets, a "Why it matters" line, and any open question. Modeled on Devin Review's "explain in reading order" + v0's "explain what I did" (see §5). The existing raw `diffSummary` (`fullDiff.slice(0,500)`) stops being shown as the summary — it remains available as raw fallback behind the dive-in.

**Band 3 — The decisions we made & why.** A pure read-model `buildDecisionLedger(buildId)` projects two existing tables into one plain shape and the band renders them as "the call / the options / the why," each tagged by source. This finally surfaces the kernel decisions the founder explicitly called out ("kept as one build rather than split, because…") which are persisted to `DecisionInteraction` but invisible in the build UI today. Unresolved risks (already on `deliberationSummary.unresolvedRisks`) are shown honestly rather than hidden.

**Band 4 — Where we need you.** The existing action layer already computes the right button per stop; the gap is **copy altitude and the failure path.** Each stop is reduced to one plain sentence (*what it means* + *what to do*), the technical axis label (`Failure axis: …`) moves to the dive-in, and the review-failure branch gets a **guided in-place recovery** (a "Try to fix" attempt + a clear two-choice) instead of punting to chat — directly countering the documented "70%-then-cliff" anti-pattern (§5). This band is delivered by **extending BI-FD796419** (which already owns "Next: <do this>", the waiting-on-you vs technical-block distinction, WIP slots, and hidden internal IDs) — not duplicated.

---

## 4. Data-model & read-model changes (design only)

### 4.1 `FeatureBuild.changeNarrative` (new field)

- **Shape:** `Json?` on `FeatureBuild`, with a typed `BuildChangeNarrative` in `apps/web/lib/feature-build-types.ts` — `{ headline: string; bullets: string[]; whyItMatters: string; openQuestions?: string[]; generatedAt: string; model: string }`.
- **Why a new field, not overloading `diffSummary`:** `diffSummary` is semantically the raw-diff prefix and is read by an existing `<pre>` render; silently changing its meaning is a data-stewardship violation (§11) and breaks the raw fallback. A dedicated typed field mirrors the existing `deliberationSummary Json?` precedent exactly. (Kernel/merits rationale: §6, Fork 2.)
- **Writer:** a local-first generator invoked at the same boundary `diffSummary` is already written (build→review transition and/or `create_portal_pr`). Captured once as evidence — not derived on every read (respects "if it isn't in the MCP plane it didn't happen").
- **Migration:** additive nullable column; backfill not required (older builds simply fall back to the raw `diffSummary` dive-in). This is a runtime-bound surface — the migration-applies-cleanly gate (§5 of AGENTS) runs in the sandbox/canonical install, not the worktree.

### 4.2 `buildDecisionLedger(buildId)` (new read-model, no schema change)

- **Location:** `apps/web/lib/build/decision-ledger.ts` (pure projection).
- **Inputs:** `FeatureBuild.deliberationSummary` (already typed) + `DecisionInteraction` rows scoped to the build (reuse the loader already reading them at `apps/web/lib/coworker-record/load-record.ts`).
- **Output:** `BuildDecisionLedgerEntry[]` — `{ theCall: string; theOptions?: string[]; theWhy: string; phase: "ideate"|"plan"|"build"|"review"; source: "deliberation"|"kernel"; governance: boolean; unresolvedRisks?: string[] }`.
- **No new substrate** — pure read over two existing tables; this is why Band 3 is high-ROI.

### 4.3 Route-manifest note

The new band components are rendered inside the existing `/build` route (no new route), so no new route-manifest entry is required. If any new sub-route is introduced during implementation, regenerate `apps/web/lib/ea/route-manifest.json` (the "Route Manifest Freshness" gate).

---

## 5. Research & Benchmarking

How leading AI build/coding agents surface **plan → decisions → change-review** to a human overseer. Sources were retrieved this session; claims that could not be verified are labeled. (Per AGENTS.md §10 — real products, their actual behavior, not abstract best practices.)

### 5.1 Devin (Cognition AI, Devin 2.x)
- **Plan:** "Interactive Planning" proposes an editable plan with code citations you approve — but **technical altitude** (file paths, IDE deep-links). [Devin 2.0](https://cognition.com/blog/devin-2); [Interactive Planning docs](https://docs.devin.ai/work-with-devin/interactive-planning).
- **Decisions:** raw real-time trail — shell/browser/editor tabs + chain-of-thought + session logs. Engineer altitude. [EasyClaw review](https://easyclaw.com/blog/knowledge/devin-ai-review/).
- **Change review (the strong part):** **Devin Review** groups logically-connected hunks, **orders and explains each hunk in reading order "as if a smart colleague walked you through the PR,"** and flags by severity — **red=probable bug, yellow=warning, gray=FYI**. [Devin Review](https://cognition.com/blog/devin-review). But the unit is still a code diff; no product-language "what changed for your customers."
- **Intervention (the weak part):** plan-approval defaults to **30-second auto-proceed unless you set "wait for my approval"** — silence becomes consent; failure recovery = "read the session log and re-specify." [Interactive Planning docs](https://docs.devin.ai/work-with-devin/interactive-planning).
- **ADOPT:** explain-each-change-in-reading-order + severity flags. **REJECT:** auto-proceed-on-silence default. **ANTI-PATTERN:** reasoning as raw logs; failure = go read logs.

### 5.2 GitHub Copilot Workspace → Copilot coding agent
- *Status:* Workspace was a research preview **discontinued 2025-05-30**; cited as a pattern source, not a live product. Live successor = the Copilot coding agent. [GitHub Next](https://githubnext.com/projects/copilot-workspace/).
- **Plan:** a natural-language **as-is / to-be Specification** *above* the file-level plan, **everything editable before any code**; the coding agent drafts an **issue with title + acceptance criteria + loose plan**. [GitHub Blog: Copilot Workspace](https://github.blog/news-insights/product-news/github-copilot-workspace/); [From idea to PR](https://github.blog/ai-and-ml/github-copilot/from-idea-to-pr-a-guide-to-github-copilots-agentic-workflows/).
- **Change review:** reverts to a **bare GitHub PR diff** — no plain-language change layer beyond the PR body.
- **Intervention:** a clean **staged approval ladder** (spec → plan → code → PR), each independently editable; nothing executes until you say so.
- **ADOPT:** the editable plain-language **intent artifact above the technical plan**; the staged "nothing runs until you approve" ladder. **REJECT:** final review as a bare diff. **ANTI-PATTERN:** four staged *technical* gates can be *more* to misjudge for a non-coder, not less ("took longer than coding it myself" — [hands-on](https://medium.com/@gmanzano.mx/exploring-github-copilot-workspace-early-insights-into-a-development-game-changer-3a994cd3dcc1)).

### 5.3 Vercel v0
- **Plan/intent:** prompt-then-show; **"explain what I'm about to do → do it → explain what I did"** narration. Plan-before-generation only began rolling into long runs mid-2026. [Ann Jose firsthand](https://annjose.com/blog/v0-dev-firsthand/); [v0 changelog](https://v0.app/changelog).
- **Decisions:** a left-pane reasoning view; the reviewer valued it because "if it gets something wrong, you can see where." Useful but interleaved with code.
- **Change review:** **three altitudes** — live preview (default for non-coders), a **diff "summary header" naming changed files/areas**, then the raw diff on demand. [v0 changelog](https://v0.app/changelog).
- **Intervention:** no hard gate; Git is the safety net. On failure it **does not auto-fix** — the reviewer hit "three build failures requiring manual intervention… debug via error logs."
- **ADOPT:** the plain "what I'm about to do / what I did" bracket; **live preview as the default review surface** with diff + summary header as progressive disclosure. **REJECT:** no pre-execution gate; "contact support" error guidance. **ANTI-PATTERN:** last-mile drop into "rename components / fix imports / read error logs."

### 5.4 Lovable (lovable.dev) — the most non-technical-first
- **Plan:** dedicated **Plan Mode** — "before the AI writes any code, it shows you a detailed plan of what it intends to build. **You review, adjust, approve**"; **Chat Mode** = "a planning session with a technical co-founder." [Plan Mode](https://lovable.dev/faq/ai-agent/plan-mode); [Chat mode & questions](https://lovable.dev/blog/chat-mode-and-questions).
- **Decisions:** folded into the conversational plan + clarifying-questions loop (not raw logs). In-progress reasoning narration could not be verified from the pages retrieved.
- **Change review:** **live preview is the primary surface** + visual click-to-edit in plain language; code/diff/GitHub are secondary, opt-in.
- **Intervention:** the Plan-Mode review-adjust-approve gate + a clarifying-questions loop; on failure a one-click **"Try to fix"** button is the explicit single next action. [Lovable FAQ](https://docs.lovable.dev/introduction/faq).
- **ADOPT:** Plan Mode "plain plan → review, adjust, approve"; the **clarifying-questions-before-building** loop; **live preview as default**; the **one-click "Try to fix"** recovery. **REJECT:** opaque metered "slot-machine" cost (corrodes trust). **ANTI-PATTERN — the strongest in the field:** the **"70%-then-cliff"** — a fully plain experience that, on the hard 30%, silently drops the non-coder into raw code, cascading cross-file edits they can't trace, and a GitHub/IDE they can't operate. [Superblocks hands-on](https://www.superblocks.com/blog/lovable-dev-review).

### 5.5 Also informative — Replit Agent (v3/v4)
- Explicit **Plan mode** with an editable ordered task list and a hard checkpoint: **"Accept tasks" / "Revise plan"** (two-button, plain), plus **checkpoint rollback** (undo to a known-good state without git). The cleanest *intervention* model found. [Replit Agent docs](https://docs.replit.com/core-concepts/agent).

### 5.6 Synthesis — patterns adopted, rejected, anti-patterns

**Adopted into this design:**
1. **Plain-language intent artifact above the technical plan** (Lovable Plan Mode, Copilot as-is/to-be) → **Band 1**.
2. **Tiered change review: plain "what changed & why" on top, raw diff underneath**; explain-in-reading-order + a summary header naming changed areas (Devin Review, v0) → **Band 2**.
3. **Decisions as a short plain "what I decided & why," raw trail behind disclosure** (counter to Devin's raw-log altitude) → **Band 3**.
4. **Explicit two-choice intervention, never auto-proceed-on-silence**, + one-click recovery + plain rollback (Replit Accept/Revise; Lovable "Try to fix") → **Band 4**.
5. **Live preview as the default review surface** for non-coders (Lovable, v0) → "See it live" in Band 1; preview-first oversight.

**Rejected:** auto-proceed-on-silence (Devin); reverting the final review to a bare diff (Copilot); opaque metered cost (Lovable); no pre-execution gate as the norm (v0).

**Anti-patterns explicitly designed against:**
1. **The 70%-then-cliff / last-mile drop into the IDE** — Band 4's guided recovery + the always-honest "Engineer view" disclosure (we never *silently* drop the user into raw code; the dive-in is a deliberate, labeled choice).
2. **Reasoning as raw engineer logs** — Band 3 curates the decisions at plain altitude; the raw trail stays behind disclosure.
3. **Ambiguous "what do I do now" / silence-as-consent** — Band 4 states one explicit action; consent is active.

**Gap this design fills that none of the four products do:** surfacing the **governance/kernel decisions** (`DecisionInteraction` / WWMD) as a first-class plain-language oversight band. The benchmarked products surface plan + diff + (sometimes) reasoning; none surfaces a governed decision ledger ("we kept this as one build because…") to a non-technical overseer. That is DPF-native and is Band 3's distinctive contribution.

---

## 6. Decision record

### 6.1 Kernel decision — IA altitude (Fork 1)

`principle_decide` (population `external_coding_agent`, surface `build-studio-overseer-ux-design`, 2026-06-22) over `additive-band` / `overseer-default-with-liveness` / `audience-mode-toggle`. Result: **degenerate** — all options composite `0.000`, margin `0.000`, `confidence: low`, because the deciding axis is `human_cognitive_load` (a known-degenerate axis in `principle_decide`) and the commandments returned `missingDimensions` (no structured features supplied; semantic fallback was nil). The "recommends additive-band" line is a tie-break artifact at all-zero, **not** a real preference. The one load-bearing signal: **`commandmentConflict: false`** — no commandment forbids any option.

**Decided on the merits (per AGENTS.md §12):** **`overseer-default-with-liveness`.** It is the only option that satisfies the founder's stated requirement ("plain by default, dive in only when something looks off"), best honors progressive-disclosure-by-default (§12) and hide-complexity-from-laymen (§17 Q3), and is corroborated by the benchmarking (non-coder-first tools default to the plain/preview surface; engineer detail is opt-in). `additive-band` fails the altitude test (the dense graph still competes on first paint). `audience-mode-toggle` reuses a dead pattern (the `audienceModes` the AppRail already ignores, per EP-NAV-COHERENCE) and pushes a configuration choice onto the layman. Residual risk (loss of liveness) is mitigated by retaining the `PhaseMiniRail` strip.

### 6.2 Data-model decision (Fork 2)

New `changeNarrative` field over overloading `diffSummary` — data-stewardship (§11) + mirrors the `deliberationSummary` precedent. No kernel escalation needed (clear winner after grounding; `commandmentConflict: false` would apply equally).

### 6.3 UX-Fit review (`dpf-ux-fit-review`)

```
UX fit review — Build Studio Solution & Oversight layer
- Decision: fits-with-guardrails
- Owning area: Platform (Build Studio, /build) — internal contributor + non-technical operator surface
- Route family: /build (no new route; new bands render inside the existing active-build pane)
- Primary persona: non-technical overseer (founder/operator) judging an autonomous build; secondary: contributor/engineer who dives into the retained engineer surfaces
- Navigation layer touched: local page (band stack + a single "Engineer view" disclosure); contextual actions (the per-stop button) — NO new global/section nav
- Reuse/convergence: compose report-kit (StatusBadge/statusColors intent registry for the status pill, StatCard where a metric is shown); reuse OpenSandboxButton, PhaseMiniRail, DeliberationSummaryCard (promoted), DetailsDrawer (as the dive-in). New: changeNarrative renderer + buildDecisionLedger projector (no parallel status map, no hand-rolled badge/table)
- Source truth: designDoc (Band 1); changeNarrative ▲new (Band 2); deliberationSummary + DecisionInteraction via buildDecisionLedger (Band 3); deriveBuildStudioWorkflowAction (Band 4)
- Empty/failure behavior: Band 1 falls back to captured intent pre-design; Band 2 falls back to the raw diffSummary dive-in until changeNarrative is generated; Band 3 shows "no decisions recorded yet" honestly; Band 4 is the action surface itself. No empty-zeros dashboards.
- AI boundary: bands are informational and navigate/disclose only — they do NOT send prompts. The single coworker-launch action (Band 4 "Something looks off") keeps preview + explicit confirmation per the existing workflow-action pattern. The changeNarrative generation is a backend evidence-capture step, not a user-facing prompt-send.
- Required plan/spec edits (guardrails for implementation):
  - Status pill resolves through report-kit statusColors (status → intent → --dpf-* token); no local color map, no raw hex.
  - "Engineer view" disclosure must be a single, clearly-labeled affordance; never silently drop the user into raw code (anti-pattern 1).
  - Band copy must avoid visible phase jargon, FB-*/WC-* ids, "Failure axis", and vendor names; technical axis labels move to the dive-in.
  - changeNarrative generation is local-first (fully-local deployment strategy); cost-bounded; captured once at the build→review/PR boundary.
  - Preserve the PhaseMiniRail liveness strip in the default view.
- Evidence before merge: route test for /build default-renders-the-bands; theme scan (no hardcoded colors); browser/viewport exercise on the canonical install or leased sandbox (worktree is source-control only); fixture build with deliberationSummary + DecisionInteraction rows to prove Band 3; a build with a generated changeNarrative to prove Band 2.
- Captured in: this spec (§3, §6.3) + the keystone BIs under EP-BUILD-STUDIO-UX.
```

**UX-Fit-Decision trailer (for the implementation PR(s)):**

> `UX-Fit-Decision: fits-with-guardrails. Build Studio overseer "Solution & Oversight" layer makes a plain-language 4-band view the default first-viewport of /build, demoting engineer surfaces behind a single labeled "Engineer view" disclosure (progressive disclosure, §12). principle_decide on the IA altitude was degenerate (human_cognitive_load axis; commandmentConflict:false) — decided on merits = overseer-default-with-liveness. Bands compose report-kit (statusColors/StatCard), reuse OpenSandboxButton/PhaseMiniRail/DeliberationSummaryCard/DetailsDrawer; no new route, no new nav layer, no prompt-send from informational bands. See docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md.`

---

## 7. Keystone backlog items (filed under EP-BUILD-STUDIO-UX)

Sequenced by ROI (data-already-exists first), per the founder framing:

1. **Keystone A — Build decision ledger + "Decisions we made & why" band (Band 3).** `buildDecisionLedger(buildId)` projector over `deliberationSummary` + `DecisionInteraction`; promote to top altitude in plain language. *Highest ROI — pure projection, no schema change.*
2. **Keystone B — Auto plain-language change summary (`changeNarrative`) + "What's changing" band (Band 2).** New typed field + local-first generator at the build→review/PR boundary; plain headline/bullets/why/open-questions. *Highest-value content gap.*
3. **Keystone C — Solution & Oversight IA shell + "What we're building" band (Band 1).** The overseer-default container (Option B): plain layer first-viewport, engineer surfaces behind one "Engineer view" disclosure, `PhaseMiniRail` retained; Band 1 from `designDoc` + "See it live." *Hosts the other bands; the altitude reframe.*
4. **Custodian pilot — proactive stuck detection + guided next action (`BI-ACB04A21`).** Build Studio proves the platform primitive in the Attention Surface: one per-build status, one recommended next action, quiet while work progresses, and in-place recovery before escalating. It composes `BI-5B6F666F` rather than defining a Build-Studio-only pattern.
5. **Extend BI-FD796419 — "Where we need you" plain stop layer (Band 4).** Add the plain *what-it-means* sentence per stop + replace the review-failure chat-punt with a guided in-place recovery (two-choice + "Try to fix"), countering the 70%-then-cliff anti-pattern. *Relates to / extends the existing item — not duplicated.*

---

## 8. Non-goals & constraints

- **Not** removing or weakening the engineer surfaces — `ProcessGraph`, raw diff, `taskResults`, `buildExecState`, `DetailsDrawer`, assurance cards all remain, one disclosure away.
- **Not** a new route, global-nav entry, or audience-mode toggle.
- **Not** changing the build lifecycle, gates, or governance evidence — this is a *presentation + one capture-step* change.
- Compose report-kit (`statusColors`, `StatCard`); no hardcoded colors (§12); no native dialogs (§12).
- `changeNarrative` generation is local-first and cost-bounded (responsible-capacity).
- Implementation runs through Build Studio / the normal PR path; runtime-bound gates run on the canonical install or a leased sandbox, never the worktree (§5).

## 9. Open questions for implementation

- Whether `changeNarrative` should also feed the PR body and capsule timeline (likely yes — it is the human-readable companion to `diffSummary`/`diffPatch`; composes with the delivery-visibility PR-capture work).
- Whether Band 3 should show kernel decisions from *all* phases or only those with a recorded option set (avoid noise from trivial gate passes).
- The exact "Try to fix" recovery scope for Band 4 (reuse `rerun-plan-review` / `resume-implementation` plumbing where it exists; only add new recovery where the chat-punt is the sole current path).

## 10. Implementation status

- **2026-06-23 — Keystone A / Band 3 data layer landed (directly, not via Build Studio).** `apps/web/lib/build/decision-ledger.ts` ships the pure `projectDecisionLedger(deliberationSummary, decisions)` projector + the thin DB-bound `loadBuildDecisionLedger(buildId)` loader, with comprehensive unit tests (`decision-ledger.test.ts`). It unifies the two existing sources — `FeatureBuild.deliberationSummary` + `DecisionInteraction` rows (`buildId`-scoped, confirmed schema relation) — into the plain `BuildDecisionLedgerEntry { theCall, theOptions, theWhy, phase, source, governance, unresolvedRisks }`. No schema change; read-only. The Band 3 **component + top-altitude wiring** also landed (`BuildDecisionLedgerBand.tsx` + `build-decision-ledger.ts` server action, wired into `BuildStudio.tsx` above the ProcessGraph, gated on having entries; composes report-kit `StatusBadge`, no hardcoded colors; render-tested). Live UX verification runs on the install after the next self-upgrade. Implemented directly because Build Studio could not complete these platform-code builds on the post-revert fully-local engine (`qwen3-coder`): the three trial builds (FB-8F8E2CE6 / FB-3B4A5D66 / FB-CF954D55) escalated-to-human or stalled — the pipeline machinery is solid but the local model can't carry review-passing designs; completion via Build Studio needs the robust/cloud tier restored. Resolves open-question #2 conservatively: the loader surfaces all `buildId` decisions; phase/noise filtering can be applied at the component.
- **2026-06-26 — Band 1 "What we're building" (additive band) landed.** `BuildSolutionSummaryBand.tsx` renders a plain-language intent paragraph from `designDoc.problemStatement` + `proposedApproach` (read client-side from `activeBuild.designDoc`, so no server action), falling back to the captured backlog intent before a design exists; wired into `BuildStudio.tsx` above the Band 3 decision band, gated on having content; render-tested; the live-preview ("see it") remains the shared footer link. **This is the additive band only — the IA reframe (making the plain layer the DEFAULT first-viewport and demoting the engineer ProcessGraph behind an "Engineer view" disclosure) is the remaining, separate step of BI-90670010 and is intentionally NOT in this change**, since that altitude restructure needs live UX verification (browser tooling was unavailable). Until the reframe lands, Bands 1 + 3 render additively above the existing operator surfaces.
- **2026-06-29 — Proactive custodian follow-up captured.** Live `/build` use showed the plain bands still fail if a human action appears to do nothing. The long-term primitive now lives in the Attention Surface spec (§3.4, `BI-5B6F666F`), with Build Studio as the pilot (`BI-ACB04A21`): detect quiet/stuck/retry-failed states, explain the real status in plain English, and offer the safest in-place action before asking the human to investigate.
