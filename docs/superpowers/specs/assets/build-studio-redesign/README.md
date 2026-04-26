# Handoff: DPF Build Studio Redesign

## Overview

This is a redesign of the **Build Studio** in the Digital Product Factory (DPF) — the surface where a technical install owner watches an AI build a feature end-to-end and approves the result before it ships.

The redesign replaces the current 3-tab surface (Graph / Details / Preview) with a **two-pane conversational shell**:

- **Left:** A transcript between the user and a single AI persona ("DPF, your build assistant"). Drill-in cards summarize what the assistant just did. Choices and clarifications happen inline.
- **Right:** A peer-tabbed artifact pane — Preview, Walkthrough (verification screenshots), What changed (plain-English schema), The change (diff drill-in).
- **Top:** A 5-step "package delivery" tracker — Understanding → Planning → Building → Checking → Handover.
- **Header:** Build title, branch, theme toggle, **approvals folded in as a header pill** (no separate `/build/approvals` route).

The product metaphor is **package delivery**: the user requests a feature, watches it move through the steps, and signs for the handover. Internal tool calls and per-specialist activity are hidden behind drill-ins, not exposed by default.

## About the Design Files

The files in `design/` are **design references created in HTML** — a working React-via-Babel prototype that demonstrates the intended look, layout, copy, and interaction model. They are **not production code to copy directly**.

The implementation task is to **recreate these designs inside the existing DPF codebase** at https://github.com/OpenDigitalProductFactory/opendigitalproductfactory — specifically the Next.js 16 + TypeScript + Tailwind + shadcn/ui app under `apps/web/` — using the patterns already established there (the Tailwind config in `apps/web/`, the shadcn primitives in `apps/web/components/ui/`, and the Build Studio surface under `apps/web/components/build/` that this redesign replaces).

Do not import the prototype's `tokens.css`, raw `<svg>` icons, or inline-styled components verbatim. Use them as reference and rebuild with shadcn primitives, Tailwind classes, and `lucide-react` icons.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, and interaction model are all intentional. Recreate pixel-faithfully where the codebase's existing primitives allow it; otherwise stay true to the spirit (density, hierarchy, calm-by-default with one amber decision moment).

## Routes / Surfaces

This redesign delivers a single primary surface and removes one route:

| Route | Status | Notes |
|---|---|---|
| `/build/[id]` (Build Studio) | **Redesigned** | New two-pane shell described below |
| `/build/approvals` | **Removed** | Approvals are folded into the Build Studio header pill |

## Layout

Top-level grid (whole viewport, no scroll):

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER BAR                                            ~56px │
├──────────────────────────────────────────────────────────────┤
│  STEP TRACKER                                          ~58px │
├────────────────────────────┬─────────────────────────────────┤
│                            │                                 │
│  CONVERSATION PANE         │  ARTIFACT PANE                  │
│  ~44% width                │  ~56% width                     │
│  min-width 420px           │  flex: 1                        │
│  scrolls internally        │  scrolls internally             │
│                            │                                 │
│  [transcript]              │  [tabbed artifact view]         │
│                            │                                 │
│  [composer pinned bottom]  │                                 │
│                            │                                 │
└────────────────────────────┴─────────────────────────────────┘
```

CSS: `display: grid; grid-template-rows: auto auto 1fr;` on the page; `display: grid; grid-template-columns: minmax(420px, 44%) 1fr;` on the bottom row.

---

## Component Specs

### 1. Header bar (`design/header.jsx`)

Single row, 12px vertical / 22px horizontal padding. Background `--surface-1`, 1px bottom border `--border`.

**Left cluster:**
- DPF mark — 28×28 rounded square, `--text` background, `--bg` foreground, `DPF` set in 13px / weight 800 / letter-spacing -0.5.
- Label "Build Studio" — 11px / weight 600 / `--muted`.
- 22px-tall vertical divider.

**Title block:**
- `BUILD.title` ("Tenant API key rotation") — 14.5px / weight 700 / letter-spacing -0.15.
- Branch chip — `--font-mono` 11.5px, padding 1×8, `--surface-2` background, 1px `--border`, 6px radius. Content: `BUILD.branch`.
- Subline: "Requested by {requestedBy} · {requestedAt}" — 12px / `--muted`.

**Right cluster:**
- **Approvals pill** (the only persistently amber element):
  - Background `color-mix(in srgb, var(--warning) 12%, var(--surface-1))`, border `color-mix(in srgb, var(--warning) 35%, var(--border))`, 999px radius.
  - 18×18 amber circle with white warning-triangle icon.
  - Text: "**1 thing waiting on you** · 2 more across builds".
  - Click should open a popover listing all pending approvals across builds. (Stub for now — popover not implemented in the prototype.)
- Theme toggle (sun/moon icon, ghost button).
- Pause button (icon only, ghost).
- **Approve & ship** primary button — `--accent` background, white text, 13px / weight 600.

### 2. Step tracker (`design/step-tracker.jsx`)

Horizontal row of 5 steps with thin connectors. Padding 14×22, `--surface-1` background, 1px bottom border.

Each step:
- 24×24 status circle, 1.5px border. Filled background when `done` (success) or `active` (accent); soft amber tint when `waiting`. Number inside, or check icon when done.
- Active step has a pulsing 2px outer ring at -4px inset, 25% opacity.
- To the right: label (13px / weight 600) + a verb-line in 11.5px `--muted`. The verb is plain English — "We figured out what you want", "We're checking it works for you" — never agent jargon.
- Active step's verb-line includes progress: `· 4 of 6`.
- Connector line: 1.5px tall, 28px wide, `--success` if previous is done, otherwise `--border`.

The five steps and their copy live in `STEPS` in `design/data.jsx`.

### 3. Conversation pane (`design/conversation.jsx`)

Vertical flex column. Transcript on top (scrolls), composer pinned at bottom.

**Bubble row:**
- 12px gap, 10px vertical / 22px horizontal padding.
- Avatar column: `<Persona>` (28×28 rounded gradient circle with "D") for assistant, `<UserMark>` (28×28 surface-3 circle with first letter of name) for user.
- Header line: name in 13px / weight 700, plus "your build assistant" caption (11px `--muted`) for the assistant. Right-aligned timestamp (11px `--muted`).
- Body: 14px / line-height 1.55 / `--text`.
- When `msg.needsAction === true`, the row gets a subtle amber wash background: `color-mix(in srgb, var(--warning) 5%, transparent)`.
- Slide-up entry animation, 320ms ease-out.

**Embedded card variants (rendered inside the assistant's bubble):**

- **Choice card** — pill row of options. Selected pill: `--text` bg / `--bg` fg / weight 600. Unselected: `--surface-1` bg / `--text-2` fg / weight 500. 999px radius, 6×12 padding, 12.5px text. Hosts the inline clarification UX.
- **Plan summary card** — `--surface-2` background, 12px radius, 14px padding. Numbered list (5 items, each a one-liner in 13.5px). Footer button "See the technical plan" with a drill icon.
- **Files-touched card** — same shell. Each file row: a `new`/`modified` chip (10.5px / weight 700, success/warning tinted) + name (13px / weight 600) + plain-English detail (12px `--muted`). Footer button "See the diff".
- **Verification strip card** — header "Walking through the feature" + "4 of 6 working" pill. 6-up grid of 1.4:1 cards: surface-3 background, 1px border colored by step state, step number badge top-left. Running step has a shimmer overlay; passed step shows a translucent check. Footer button "See screenshots" — clicking calls `onOpenArtifact("verification")`.
- **Decision card** (the only persistent amber element in the body): warning-tinted background and border, "Needs your eye" header, 14px body copy, three buttons: "Approve & ship" (accent), "Request changes" (secondary), "See the change" (ghost — opens diff).
- **Step ref chip** — small inline pill: package icon + "Started Planning" — used to mark phase transitions inside the transcript without opening a full card.

**Composer:**
- 12×22 padding, `--bg` background.
- Inner card: `--surface-1`, 1px `--border`, 14px radius, `--shadow-card`, 10px padding.
- Auto-resizing textarea (2 rows initial), no border / outline / resize handle.
- Footer row: ghost buttons "Suggest a change" and "Pause build" on the left; primary "Send" with arrow icon on the right.

### 4. Artifact pane (`design/artifact.jsx`)

Container: `--surface-2` background with a 1px left border. Vertical flex.

**Tab row** (top, 12×22 padding, `--surface-1` background, 1px bottom border):
- Inline-flex segmented control: 3px padding, `--surface-2` background, 1px `--border`, 10px radius.
- Tabs (icons from `Icon` component):
  - Preview (`play` icon) — default
  - Walkthrough (`image` icon)
  - What changed (`table` icon)
  - The change (`drill` icon) — deepest layer; not the default
- Selected tab: `--surface-1` background, 1px border, weight 600. Unselected: transparent, `--text-2`, weight 500.

**Preview view:**
- 22px padding, gap 12px.
- URL bar: `mono` 12px in `--text-2`, padding 7×12, `--surface-1`, 1px border, 10px radius.
- "live" pulse chip on the right (success-colored).
- Inset card showing a mocked Settings → API Keys page (header strip + 3 key rows, last row in "grace window" state with pulsing amber chip).

**Walkthrough view (verification):**
- 22px padding.
- Header "Walking through it as a real user" eyebrow + "4 of 6 steps confirmed" h2.
- Auto-fill grid, `minmax(280px, 1fr)`, 14px gap.
- Each card: 16:10 striped surface-3 placeholder image, step badge, caption block (title 13.5px / weight 600 + 12.5px description). Running cards have a shimmer overlay; passed cards have a translucent check icon bottom-right.

**What changed (plain schema) view:**
- 22×28 padding, max-width 720px column.
- Eyebrow "What changed in your data" + h2 area name + intro paragraph.
- Stack of change cards. Each: 36×36 accent-soft square with a sparkle icon, then a sentence: muted verb ("We now remember") + bold what ("when a key expires") + 13px detail. Three changes for the demo.
- Risk callout: success-tinted card with check icon + "low risk" + sentence.
- Footer button "See the technical schema" (drill icon).

**The change (diff drill-in) view:**
- 22px padding.
- Eyebrow + h2 explaining which change is being inspected.
- Two-column "Before / After" grid (1fr 1fr, 14px gap):
  - Before: `--surface-1` card, "Before" eyebrow in `--muted`, mono 12.5px code in `--text-2`.
  - After: success-tinted card (`color-mix(in srgb, var(--success) 6%, var(--surface-1))`, 30% success border), mono 12.5px in `--text`.
- Explainer card below: `--surface-2`, plain-English "What it means for clients" sentence + Approve & ship + Request changes buttons.

---

## Interactions & Behavior

- **Drill-in flow.** Clicking a card's footer button (e.g. "See screenshots") calls `onOpenArtifact(viewId)` which sets the right pane to that tab. Add a brief highlight pulse on the destination tab (200ms accent border glow) to confirm the swap.
- **Choice pill.** Click toggles selection (single-select). Persist the picked option in conversation state so the assistant's next turn references it.
- **Composer Send.** Appends a user message with `role: "user"` and a fresh timestamp. Disabled when textarea is empty.
- **Pause / Suggest a change.** These pause the active build. Pause should yield a `paused` chip on the active step. (Backend: hook into existing build state machine.)
- **Approvals pill (header).** Click opens a popover listing all `PENDING_APPROVALS` (see `design/data.jsx`). Each row: title + step + risk pill (low=success, medium=warning, high=error) + Approve / Reject buttons.
- **Theme toggle.** Sets `document.documentElement.dataset.theme = "dark" | "light"`. Persist to localStorage as `dpf:theme`. The DPF codebase already has light/dark handling — wire into the existing system, don't roll your own.
- **Decision callout.** When `msg.needsAction === true`, **scroll the transcript to that bubble on mount** so the user lands on the actionable item.
- **Animations:**
  - New transcript rows: `slide-up` 320ms ease-out (translateY 6px → 0, opacity 0 → 1).
  - Active step ring: 1.6s pulse loop, expanding box-shadow 0 → 6px, fading out.
  - Running verification thumbs: linear shimmer 1.6s loop.
- **Keyboard:** ⌘/Ctrl+Enter sends the composer. Esc dismisses the approvals popover.

## State Management

Component-local state is sufficient for the visible surface; wire the rest into the existing DPF stores.

- `theme: "light" | "dark"` — at app root.
- `view: "preview" | "walkthrough" | "schema" | "diff"` — at app root, drives artifact pane.
- `transcript: Message[]` — server-driven. Each message: `{ role, time, text, needsAction?, choices?, cards? }`. Cards reference artifact views by id.
- `steps: Step[]` — derived from build state machine. Each: `{ id, label, verb, state: "done" | "active" | "waiting" | "queued", when, progress?, total? }`.
- `pendingApprovals: Approval[]` — global, for the header pill.

For real-time updates, mirror the existing build state subscription (likely Server-Sent Events or websockets in the current `apps/web/components/build/`). New transcript rows should append at the bottom; the slide-up animation triggers on mount.

## Design Tokens

All tokens are defined as CSS custom properties in `design/tokens.css`. Map each to your existing Tailwind/shadcn token system; do **not** import the file as-is.

### Colors — light

| Token | Value |
|---|---|
| `--bg` | `#fafafa` |
| `--surface-1` | `#ffffff` |
| `--surface-2` | `#f4f4f6` |
| `--surface-3` | `#eeeef2` |
| `--text` | `#14142b` |
| `--text-2` | `#4a4a5e` |
| `--muted` | `#6b7280` |
| `--accent` | `#2563eb` |
| `--accent-soft` | `color-mix(in srgb, var(--accent) 12%, var(--surface-1))` |
| `--border` | `#e2e2e8` |
| `--border-strong` | `#c8c8d4` |
| `--success` | `#16a34a` |
| `--warning` | `#d97706` |
| `--error` | `#dc2626` |
| `--info` | `#0284c7` |

### Colors — dark

| Token | Value |
|---|---|
| `--bg` | `#0f0f1a` |
| `--surface-1` | `#1a1a2e` |
| `--surface-2` | `#161625` |
| `--surface-3` | `#121220` |
| `--text` | `#e2e2f0` |
| `--text-2` | `#b8b8cc` |
| `--muted` | `#8888a0` |
| `--accent` | `#7c8cf8` |
| `--accent-soft` | `color-mix(in srgb, var(--accent) 18%, var(--surface-1))` |
| `--border` | `#2a2a40` |
| `--border-strong` | `#3a3a55` |
| `--success` | `#4ade80` |
| `--warning` | `#fbbf24` |
| `--error` | `#f87171` |
| `--info` | `#38bdf8` |

### Typography

- Sans: **Inter** (400/500/600/700/800), with `font-feature-settings: "ss01", "cv11"`.
- Mono: **JetBrains Mono** (400/500/600).
- Serif: Source Serif 4 (declared but not used in the visible surface — safe to drop).
- Base: 14px / line-height 1.5 / `-webkit-font-smoothing: antialiased`.

### Spacing & shape

- Radii: `--radius: 10px`, `--radius-lg: 14px`, `--radius-xl: 18px`. Buttons 10. Cards 12–14. Pills 999.
- Shadows:
  - `--shadow-card: 0 1px 2px rgba(15,15,30,0.04), 0 4px 14px rgba(15,15,30,0.05)` (light) / `0 1px 2px rgba(0,0,0,0.30), 0 4px 14px rgba(0,0,0,0.30)` (dark).
  - `--shadow-pop: 0 6px 24px rgba(15,15,30,0.10)` / `0 6px 24px rgba(0,0,0,0.40)`.

### Status semantics

- **Amber/warning** is reserved for "needs your attention" (active build step, decision callout, header approvals pill, expiring grace-period chips). Don't use it for general highlight.
- **Green/success** is for completed steps and verified test runs.
- **Accent (blue/indigo)** is for the *currently active* step and live indicators only.
- **Red/error** is for failed verification and rejection actions.

## Demo Data

All copy in the prototype is intentional and reviewed; reuse it in seed/fixtures for the implementation.

The build under demonstration:
- Title: "Tenant API key rotation"
- Branch: `feat/api-key-rotation`
- Requested by: Maya Chen, Today 9:14am
- Current step: **Checking** (4 of 6 verification steps complete)
- Pending decision: API expiry response shape — needs operator approval before ship.

Full transcript, file list, verification steps, and schema-change copy are in `design/data.jsx`.

## Assets & Icons

- **Icons** — the prototype's `Icon` component is a hand-rolled SVG set (16×16 viewbox, 1.6 stroke). In the real implementation, use **`lucide-react`** equivalents (already in shadcn/ui's standard set):
  - `check` → `Check`
  - `x` → `X`
  - `send` → `Send`
  - `arrow-r` → `ArrowRight`
  - `spark` → `Sparkles`
  - `package` → `Package`
  - `user` → `User`
  - `moon` → `Moon`
  - `sun` → `Sun`
  - `drill` → `ChevronRight` (or `MoreHorizontal` if used as a "see more" affordance)
  - `edit` → `Pencil`
  - `more` → `MoreHorizontal`
  - `branch` → `GitBranch`
  - `warn` → `AlertTriangle`
  - `image` → `Image`
  - `table` → `Table`
  - `play` → `Play`
  - `pause` → `Pause`
- **Persona avatar** — the gradient circle with "D" is a placeholder. Replace with whatever DPF brand mark exists, or keep a stable monogram with the DPF accent gradient.
- **Verification thumbnails** — placeholders only. Wire to the existing browser-use screenshot pipeline; the cards already accommodate 16:10 images.

## Files in this bundle

| File | Purpose |
|---|---|
| `design/index.html` | Entry — wires React + Babel + all jsx files |
| `design/tokens.css` | All design tokens (light + dark) — reference, not for direct import |
| `design/data.jsx` | All demo data: build, steps, conversation, files, verification steps, schema summary, approvals |
| `design/step-tracker.jsx` | The 5-step package-delivery tracker |
| `design/conversation.jsx` | Transcript, bubble variants, embedded cards, composer |
| `design/artifact.jsx` | Right pane: tabs + Preview / Walkthrough / Schema / Diff views |
| `design/header.jsx` | Header bar with title, approvals pill, theme toggle, primary actions |

## Existing surface to replace

The current Build Studio lives at `apps/web/components/build/` in the DPF repo (https://github.com/OpenDigitalProductFactory/opendigitalproductfactory). Read that directory before starting — keep wiring (subscriptions, server actions, state machine triggers) and replace presentation. The Tailwind config and shadcn primitives in `apps/web/` are the design system to lean on.

## Implementation notes / order

1. **Header + step tracker first** — they're the persistent chrome and validate the token + icon mapping in your codebase.
2. **Artifact pane scaffolding** — tab control + Preview view. Wire to the existing build sandbox iframe.
3. **Conversation pane** — bubble + composer + slide-up animation. Hook into the existing build event stream; render assistant turns server-side, append client-side.
4. **Card variants** — Plan summary, Files-touched, Verification strip, Decision. Each maps 1:1 to an existing build event type.
5. **Walkthrough + Schema + Diff views** — wire to existing data sources (browser-use screenshots, Prisma migration parser, git diff).
6. **Approvals header pill + popover** — replaces the standalone `/build/approvals` route.
7. **Theme integration** — defer to the codebase's existing light/dark system.
