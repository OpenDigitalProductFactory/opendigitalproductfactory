# Build Studio Redesign — Conversational Shell with Multi-Reviewer Narration

**Date:** 2026-04-25
**Status:** Approved design, ready for implementation planning
**Owner:** TBD (assigned by Build Studio)
**Replaces:** Current three-tab Build Studio surface at `apps/web/components/build/`
**Source:** Generated via Claude Design ([Anthropic Labs](https://www.anthropic.com/news/claude-design-anthropic-labs)), refined in design review on 2026-04-25

## TL;DR

Replace the existing three-tab Build Studio (Graph / Details / Preview) with a **two-pane conversational shell** that uses a single AI persona ("DPF, your build assistant") to narrate AI-driven feature development to the install owner. The persona surfaces parallel sub-agent activity and multi-reviewer judgment *in the conversation* rather than hiding it; quality emerges from visible deliberation, not from a black-box dashboard. Approvals fold into a header pill — the standalone `/build/approvals` route is removed.

## Background

The current Build Studio surface (`apps/web/components/build/BuildStudio.tsx`) suffers from documented UX problems captured in the project's comparison research and prior review-panel UX feedback:

- Three sibling tabs (Graph / Details / Preview) prevent the user from seeing agent activity and the artifact at the same time.
- Per-specialist tool calls are not surfaced anywhere — agents work in a black box.
- Code diff renders as raw `git diff` in monospace; no syntax highlighting, no per-hunk review.
- No surface for HITL approval gates (`awaiting_operator` ship state, register-product, hive contributions).
- Schema changes are buried in prose inside `designDoc.dataModel`.
- Verification evidence appears as a final batch instead of streaming as the run progresses.
- Backlog items and builds are disconnected — manual copy-paste between screens.
- A `BuildActivityLog` component exists in `apps/web/components/build/` but is not wired into the main shell — infrastructure was ahead of UI.

A market scan of full-SDLC AI build platforms (Replit Agent 4, Devin 2.2, v0, Lovable 2.0, Bolt.new) confirmed that the dominant pattern is a **two-pane chat + live artifact** layout — Build Studio's tabbed approach is structurally out of step.

## Goals

1. Single, calm UX where the user reads what the platform is doing and acts only when something needs them.
2. **Multi-reviewer judgment is visible** — DPF's quality bar comes from N reviewers reaching consensus via the [deliberation pattern framework](2026-04-21-deliberation-pattern-framework-design.md); the UX must surface this as a trust signal rather than hide it.
3. Parallel sub-agent activity narrated through the single persona (not exposed as a separate dashboard) — concurrency without cognitive load.
4. Plain-English first, technical drill-in second — non-engineering install owners can supervise; engineers can drill into the diff/schema when they want.
5. Approvals visible from anywhere in the platform (header pill), not gated behind a separate route.
6. Preserve all existing wiring: build state machine, agent-event-bus, browser-use verification, sandbox iframe, Inngest queue, deliberation framework. This is a presentation-layer change.

## Non-goals

- New backend behavior. The build orchestrator, deliberation loops, browser-use verification, and Inngest events stay as-is.
- Replacing or extending the agent registry. The same coworkers do the same work.
- A standalone IDE. DPF is not Cursor — we expose design / data / components / verification, not a code editor.
- Backlog → Build deep-link automation (gap #7 from the comparison report). Out of scope for this slice; tracked as future work.

## Source design bundle

The design was produced in [Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs) on 2026-04-25 and lives at [`assets/build-studio-redesign/`](./assets/build-studio-redesign/) for reference:

- [`README.md`](./assets/build-studio-redesign/README.md) — full design handoff documentation: layout, component specs, interactions, design tokens, animations, state model, file structure, and implementation order. **The README is authoritative for visual / layout / token details — read it before implementing.**
- [`design/index.html`](./assets/build-studio-redesign/design/index.html) — runnable React-via-Babel prototype entry.
- [`design/tokens.css`](./assets/build-studio-redesign/design/tokens.css) — design tokens (light + dark). Reference only; map onto the existing Tailwind / shadcn token system.
- [`design/header.jsx`](./assets/build-studio-redesign/design/header.jsx), [`step-tracker.jsx`](./assets/build-studio-redesign/design/step-tracker.jsx), [`conversation.jsx`](./assets/build-studio-redesign/design/conversation.jsx), [`artifact.jsx`](./assets/build-studio-redesign/design/artifact.jsx), [`data.jsx`](./assets/build-studio-redesign/design/data.jsx) — component prototypes.

**Do not import the prototype files directly.** They use inline styles, hand-rolled SVGs, and `tokens.css`. Implementation must use shadcn/ui primitives, Tailwind classes, and `lucide-react` icons against DPF's existing design system.

## Shell architecture summary

(For full pixel-level specs see [`assets/build-studio-redesign/README.md`](./assets/build-studio-redesign/README.md). High-level recap follows.)

```text
┌──────────────────────────────────────────────────────────────┐
│  HEADER BAR — title, branch, approvals pill, theme, action  │  ~56px
├──────────────────────────────────────────────────────────────┤
│  STEP TRACKER — Understanding · Planning · Building · ...   │  ~58px
├────────────────────────────┬─────────────────────────────────┤
│                            │                                 │
│  CONVERSATION PANE         │  ARTIFACT PANE                  │
│  ~44%, min 420px           │  ~56%, flex                     │
│  scrolls internally        │  scrolls internally             │
│                            │                                 │
│  [transcript with cards]   │  [tabbed: Preview / Walk- /     │
│                            │   What changed / The change ]   │
│                            │                                 │
│  [composer pinned]         │                                 │
│                            │                                 │
└────────────────────────────┴─────────────────────────────────┘
```

**Five package-delivery steps** replace the engineering-jargon phases:

| Old phase | New label     | Verb (user-facing copy)             |
| --------- | ------------- | ----------------------------------- |
| ideate    | Understanding | "We figured out what you want"      |
| plan      | Planning      | "We sketched how to build it"       |
| build     | Building      | "We wrote the code & tests"         |
| review    | Checking      | "We're checking it works for you"   |
| ship      | Handover      | "Awaiting your approval"            |

**Conversation cards** (rendered inside assistant bubbles): Choice, Plan summary, Files-touched, Verification strip, Decision callout (the only persistent amber element), Step-ref chip.

**Artifact tabs** (right pane): Preview (live sandbox iframe) → Walkthrough (verification screenshots grid) → What changed (plain-English schema) → The change (before/after diff drill-in). Progressive drill-down from plain to technical.

**Approvals** fold into a header pill: "1 thing waiting on you · 2 more across builds." Click opens a popover listing all pending approvals across all builds. The standalone `/build/approvals` route is removed.

## Refinement: Multi-reviewer narration & parallel activity surfacing

This refinement extends the source bundle and is **load-bearing for the design's trust model**. The single conversational persona is the *narrator*; behind it, named sub-agents and multi-reviewer panels do the work and reach consensus. The UX makes this visible as a trust signal rather than hiding it.

### Principle

> Quality at DPF emerges from multiple reviewers deliberating to consensus. The conversation must show this — not as noise, but as evidence the install owner can trust.

The [deliberation pattern framework](2026-04-21-deliberation-pattern-framework-design.md) already runs N reviewers in parallel for design / plan / code reviews. The agent-event-bus already streams per-specialist activity. This refinement is a UX surfacing job, not new infrastructure.

### Three new conversation cards (additions to the bundle)

1. **Parallel-activity card** — rendered when ≥2 sub-agents are active concurrently.
   - Header: "Right now: N things in motion."
   - Inline grid: each row = one sub-agent role (Architect / Software Engineer / QA Engineer / Code Reviewer / Senior Reviewer) + 24×24 role chip + one-line status (queued / running / waiting-for-review / complete) + relative timestamp.
   - Footer button: "See what each is doing" — opens an inset detail panel within the conversation pane (not a separate route) showing per-agent tool calls in chronological order.
   - Shape: matches the existing Files-touched / Verification-strip card pattern (surface-2 background, 12px radius, 14px padding).

2. **Reviewer-panel card** — rendered when a deliberation review event fires (design-review / plan-review / code-review).
   - Header: "I asked N reviewers to check this."
   - Per reviewer row: 20×20 role chip + reviewer name (e.g. "Architect", "Senior Reviewer") + verdict pill (✓ pass / ⚠ concerns / ✗ fail, color-coded) + one-line summary in their voice.
   - Footer button: "See full reviews" — opens an inset detail showing each reviewer's full ReviewResult (issues, summary, decision).
   - When all reviewers pass with no concerns, the card collapses to a single-line green chip ("3 reviewers signed off") to keep the transcript calm.

3. **Deliberation card** — rendered when reviewers initially disagreed and reached consensus through deliberation.
   - Header: "Two reviewers disagreed on X. They worked it out."
   - Body: one-line plain-English summary of the disagreement and resolution.
   - Footer button: "See how they agreed" — opens an inset detail with the deliberation thread.
   - This card is the explicit trust signal — it is the platform showing its work.

### Updates to existing bundle cards

- **Files-touched card** — append authorship/review chain: "Written by Software Engineer · reviewed by Code Reviewer + Senior Reviewer". Reviewer names render as small chips inline with a verdict tick.
- **Plan summary card** — append "Reviewed by N planners" footer when applicable.
- **Verification strip card** — header copy stays the same; tooltip on hover surfaces "QA Engineer ran 6 walkthrough steps" so the named role is one hover away.
- **Decision callout** — when the decision was triggered by a reviewer's flag (not the assistant's own judgment), prepend "Senior Reviewer flagged:" so the user knows which reviewer raised it.

### Updates to artifact pane

- **The change (diff drill-in) view** — per-hunk reviewer pills next to comments. Each hunk shows which reviewer signed off (or flagged) it. When reviewers disagreed on a hunk, an inline pill links to the deliberation card.
- **Walkthrough view** — each verification step card shows "Run by QA Engineer" in a small caption under the title. Names the role even on the artifact side.

### What stays hidden

The conversation does NOT surface raw tool-call arguments, internal token usage, model names, or specialist routing decisions in the default view. These are available in an "internals" drill-in (post-MVP) but not in the main transcript. The default voice is the persona's; the named sub-agents are referenced by role, not by the underlying LLM provider.

## Component → existing-data mapping

For implementation reference: each new card's data already exists in DPF's domain.

| Card / surface | Backed by |
| --- | --- |
| Parallel-activity card | `agentEventBus` events filtered by build id; `taskResults` for completed work |
| Reviewer-panel card | `ReviewResult[]` from [deliberation framework](2026-04-21-deliberation-pattern-framework-design.md); `designReview` / `planReview` / per-task code-review fields on `FeatureBuild` |
| Deliberation card | `DeliberationChain` records (existing in the deliberation framework) |
| Files-touched card | `taskResults[].filesChanged` + `specialist` field |
| Verification strip card | `uxTestResults`, `uxVerificationStatus` (already streamed via Inngest events) |
| Decision callout | `awaiting_operator` ship-fork state + `ChangePromotion.status` |
| Step tracker | `build-flow-state.ts` derived phase progress |
| Approvals header pill | New cross-build query: every build with `awaiting_operator` fork OR pending HITL gate |
| Preview tab | Existing `sandboxPort` + `resolve-sandbox-url.ts` |
| Walkthrough tab | Existing `browser-use` evidence at `/api/build/<id>/evidence/<file>` |
| What changed (schema) | New: derive plain-English schema delta from Prisma migration metadata |
| The change (diff) | Existing `diffPatch` field; replace `<pre>` rendering with a real diff viewer |

## Out of scope for this slice (future work)

- **Backlog → Build deep-link wizard** (comparison gap #7) — assigning a backlog item to Build Studio that pre-fills the brief and back-references the build in the backlog row.
- **Click-on-preview annotation loop** (Lovable Visual Edits / tldraw Make Real pattern) — would require CDP-driven element-to-JSX mapping; bigger swing.
- **Component+token mapping panel** (Builder.io Visual Copilot 2.0 pattern).
- **Lifecycle hooks** (Claude Code-style `PreToolUse`, `PostToolUse`, etc.) — deterministic guardrails. Tracked separately.
- **"Internals" drill-in** showing raw tool calls, token usage, and model routing for engineers who want it. Post-MVP.

## Implementation order (from bundle README §Implementation notes / order, lightly amended)

1. Header bar + step tracker. Validates token + icon mapping in the codebase. Includes the **approvals header pill** with a stub popover.
2. Artifact pane scaffolding — tab control + Preview view wired to existing sandbox iframe.
3. Conversation pane — bubble + composer + slide-up animation. Hook into existing build event stream.
4. Card variants from the bundle: Choice, Plan summary, Files-touched, Verification strip, Decision callout, Step-ref chip.
5. **New card variants from this spec's refinement**: Parallel-activity, Reviewer-panel, Deliberation.
6. Walkthrough view — wire to existing browser-use screenshot pipeline.
7. What changed (plain schema) view — Prisma migration parser + plain-English summarizer.
8. The change (diff drill-in) view — real diff viewer with per-hunk reviewer pills.
9. Approvals header popover — full implementation listing all pending approvals across all builds.
10. Theme integration — defer to existing light/dark system in the codebase.
11. Remove the old `/build/approvals` route and its components.
12. Remove the deprecated `BuildStudio.tsx` tabbed shell after the new shell is feature-equivalent.

## State model (from bundle, lightly extended)

- `theme: "light" | "dark"` — at app root.
- `view: "preview" | "verification" | "schema" | "diff"` — at app root, drives artifact pane.
- `transcript: Message[]` — server-driven from the agent-event-bus. Each message: `{ role, time, text, needsAction?, choices?, cards? }`. Cards reference artifact views and deliberation chains by id.
- `steps: Step[]` — derived from build state machine.
- `pendingApprovals: Approval[]` — global, for the header pill. New query — see Component → existing-data mapping.
- `parallelActivity: AgentRun[]` — derived from agent-event-bus filtered to currently-active runs for this build.

The conversation persona's narrator voice is generated server-side (a transformer on top of raw events) — not free; this is a known scope item.

## Risks & open questions

- **Persona voice transformer** — converting raw tool events into the assistant's narration ("I'm walking through the feature in the browser…") requires either a templated converter (deterministic, brittle) or an LLM pass per event (expensive, latency-sensitive). Decision deferred to the implementation plan.
- **Streaming density** — long builds will produce many transcript turns. Need a strategy: collapse old turns into a step-level summary, or paginate. Decision deferred to the implementation plan.
- **Multi-build approvals scaling** — header pill query must be cheap; hot path. Index on the relevant fork-state fields if needed.
- **Backwards compatibility** — existing build event consumers (admin pages, finance / token-spend panels) currently read fields that the new shell stops surfacing. Audit and migrate before deletion.

## References

- [Claude Design announcement (Anthropic Labs)](https://www.anthropic.com/news/claude-design-anthropic-labs)
- [Deliberation pattern framework spec](2026-04-21-deliberation-pattern-framework-design.md)
- [Build Studio governed backlog delivery spec](2026-04-23-build-studio-governed-backlog-delivery-design.md)
- [Build process orchestrator design](2026-04-02-build-process-orchestrator-design.md)
- [Browser-use integration design](2026-04-06-browser-use-integration-design.md)
- [Build Studio agent handoff design](2026-03-31-build-studio-agent-handoff-design.md)
- Source design bundle: [`assets/build-studio-redesign/`](./assets/build-studio-redesign/)
