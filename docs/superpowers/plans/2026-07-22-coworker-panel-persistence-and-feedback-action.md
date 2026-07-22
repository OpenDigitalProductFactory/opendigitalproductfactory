# Coworker side-panel persistence, identity & owner-readable controls

Status: implemented (single PR, BI-3238AAF0)
Owner: platform / portal UX
Related: BI-3238AAF0 (this PR — panel persistence + owner-readable controls +
route context), BI-62FF22DB (header Feedback mislabel — delivered separately by
PR #3376), epic EP-UX-COGLOAD (live UX cognitive-load audit follow-up)

## Coordination note (BI-62FF22DB ↔ PR #3376)

The audit filed two coupled BIs. **BI-62FF22DB** (header `Feedback` opening the
coworker panel instead of a feedback surface) is already being fixed by the
in-flight **PR #3376** (`fix/header-feedback-flow`), which reroutes
`HeaderFeedbackButton` to open the `FeedbackForm` directly and rewrites its test.
To avoid duplicate/colliding edits this PR **defers BI-62FF22DB entirely to
#3376** and does not touch `HeaderFeedbackButton.*`. The two PRs are disjoint at
the file level and can merge in any order. This PR owns **BI-3238AAF0**, the
panel-shell aspects #3376 does not address.

## Design grounding

- Source of truth: bug-fix under EP-UX-COGLOAD from the 2026-07-22 live
  action-result usability audit. No prior spec governs the coworker-panel shell
  mount contract; nearest existing artifact is the ops-map/coworker-panel-honesty
  plan (2026-07-06). This is a new artifact for BI-3238AAF0; it changes no
  published contract.
- Substrate inspected: `AgentCoworkerShell` (panel mount + localStorage
  open-flag), `AgentCoworkerPanel` / `AgentPanelHeader` / `AgentMessageInput` /
  `CoworkerPostureControl` (the flagged control surface), and
  `portal-navigation-model` (canonical route → label). Also inspected #3376 to
  scope out the Feedback path.
- Decision: **extend** the existing components; add one pure helper
  (`resolvePanelRouteContextLabel`). No new tables, enums, or MCP tools — the nav
  model already exposes the labels needed (`getRouteNavRecord`).

## The audit findings (BI-3238AAF0 portion)

The coworker panel could become a persistent cognitive-load layer across
unrelated routes, carrying cryptic controls (`⋯`, `x`, `+ Add`, `Controls`) onto
each page and never naming the route/business context it was attached to.

## Root causes addressed here

- **Cryptic accessible names.** The posture control's accessible name collapsed to
  its visible summary "Controls"; the panel never named its route/business
  context.
- **Persistence semantics.** The panel open-state is a single localStorage flag
  set by any open. Once #3376 stops the mislabelled Feedback trigger from opening
  the panel, the remaining opens (launcher FAB / explicit guided opens) are the
  "intentional opens" the acceptance calls for and legitimately follow the user
  across routes. This PR adds the identity + control-legibility defenses and
  locks the intentional-open persistence/collapse behavior behind a smoke test.

## The change (BI-3238AAF0)

1. **Panel names its route/business context.** New pure helper
   `lib/agent/panel-route-context.ts#resolvePanelRouteContextLabel` derives a short
   human label from the canonical `portal-navigation-model` (deepest known
   ancestor; title-cased domain fallback). `AgentCoworkerPanel` computes it from
   the effective route and `AgentPanelHeader` renders it as a context chip
   (`data-testid="panel-route-context"`, `aria-label="Current context: <area>"`).

2. **Owner-readable controls.** `CoworkerPostureControl` gets a stable
   `aria-label="Conversation controls…"` so its accessible name is no longer the
   bare "Controls". The overflow (`⋯` → "More options"), close (`x` → "Close
   coworker panel"), add-context (`+ Add` → "Add context"), dictation ("Start
   dictation"), send ("Send"), and the collapse affordance (FAB → "Open AI
   Coworker") already carry owner-readable accessible names — now asserted by a
   smoke test so they cannot silently regress.

## Tests

- `lib/agent/panel-route-context.test.ts` — pure label resolution against the real
  nav model (`/finance`→Finance, `/customer/marketing`→Marketing,
  deepest-ancestor + title-case fallbacks, query/hash stripping).
- `components/agent/coworker-panel-ux-smoke.test.tsx` — UX smoke: intentional open
  persists across `/finance` and another route; a fresh mount reopens the pinned
  panel; close collapses to the launcher; every control exposes an owner-readable
  accessible name (not only `⋯`/`x`/`+ Add`/`Controls`); the header names the
  route context. The Feedback-surface bullet is covered by
  `HeaderFeedbackButton.test.tsx` in #3376 and intentionally not duplicated here.

## Verification

Authored in a source-only worktree whose local install lacks `next` runtime
files, so specs importing `next/navigation` (the shell + control-name suite)
cannot transform locally; the pure-logic and non-`next` component suites pass
locally (43 tests). Relying on CI (Unit Tests, Typecheck, Prod Build) for the
`next`-importing suites — the same substrate the existing shell/header tests use.

## Non-goals

- No change to BI-62FF22DB / `HeaderFeedbackButton` (owned by #3376).
- No change to the `open-agent-panel` guided-work / provider-consultation / setup
  opens, which are genuine user-initiated contextual assists.
