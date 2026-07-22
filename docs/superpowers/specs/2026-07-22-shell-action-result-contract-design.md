# Common Shell Action-Result Contract (BI-9C0954D0)

**Status:** Draft
**Date:** 2026-07-22
**Epic:** EP-UX-COGLOAD (Live UX cognitive-load audit follow-up)
**Primary BI:** BI-9C0954D0 — *Common shell actions need visible results and unique accessible targets*
**Coordinates with:** BI-BF53A701 (Simple/Full delta), BI-62FF22DB (Feedback flow), BI-3238AAF0 (coworker-panel persistence/controls), BI-2DD18122 (Docs/help overload), BI-F0B389C9 (Storefront mobile tap-safe), BI-7D7EE150 (owner action safety), BI-8D87084D (self-upgrade readability)
**SSOT:** `docs/platform-usability-standards.md` — this spec adds the *Common Shell Action-Result Contract* section there.

---

## Problem Statement

A live action-result usability audit (2026-07-22) found that the **common shell chrome** wrapping every owner route (`/workspace`, `/storefront`, `/finance`, `/customer/marketing`, `/employee`, `/admin`, `/ops/self-upgrade`) creates confusion for non-technical owners even when the underlying page is correct. The shell is composed in `apps/web/app/(shell)/layout.tsx`:

1. **Ambiguous Docs targets.** `apps/web/components/docs/ContextualDocsButton.tsx` renders a control labelled `Docs` whose href is route-scoped (e.g. `/docs/workspace/index?sourceRoute=%2Fworkspace`), while the global nav in `apps/web/lib/navigation/portal-navigation-model.ts` also exposes a control labelled `Docs` pointing at `/docs`. Two controls, identical accessible name, different destinations — ambiguous for assistive tech and automation.
2. **Simple/Full is a near no-op with no explanation.** `apps/web/components/shell/AppRail.tsx` toggles a `dpf-nav-mode` cookie (`worker`/`operator`) and calls `router.refresh()`. It filters the nav rail (`apps/web/lib/govern/permissions.ts` `getShellNavSections`) but changes almost nothing an owner can see, and the UI never explains what "Simple" did.
3. **Feedback opens the wrong surface.** `apps/web/components/feedback/HeaderFeedbackButton.tsx` dispatches `open-agent-feedback`, which `apps/web/components/agent/AgentCoworkerShell.tsx` intercepts and answers by opening the generic AI coworker side panel. The visible result (a COO conversation with `Skills`, `Priority`, `Proactivity`, `Send`) does not match the command `Feedback`.
4. **No visible result after click.** Several shell controls change state with no motion or confirmation an owner can perceive.
5. **Controls below the mobile tap target.** In 390px audits the alert badge (~36×23), `Feedback` (~55×16), `Sign out` (~47×16), Simple/Full (~101×25), and the coworker close `x` (~21×20) are all below the 44px minimum.
6. **Chrome before the task.** The first viewport is dominated by global/internal chrome before the owner reaches the route task.

## Goals

Define **one common shell action-result contract**. Every shell control must have:

- **C1 — Unique accessible target per region.** One accessible name per visible region; a control's accessible name must not collide with a different destination in the same shell.
- **C2 — Label matches result.** The visible/accessible label names the surface or state the click produces.
- **C3 — Visible result after click.** Every shell action produces a visible change an owner can perceive (navigation, a labelled popover, a pressed state, a pending affordance, or a `role="status"` announcement) — never a silent state change.
- **C4 — Route-aware behavior.** Route-scoped controls resolve against the current route and say so.
- **C5 — Mobile tap-safe.** Interactive shell controls present a ≥44×44px hit area (WCAG 2.2 AA 2.5.8 Target Size Minimum) via the shared `dpf-tap-target` affordance.
- **C6 — Task before chrome.** Owner surfaces expose the route task ahead of global/internal chrome in reading order (skip link + chrome that recedes in Simple mode).

## Non-Goals

- Per-page Simple/Full content deltas beyond the shell chrome (owned by **BI-BF53A701**; this spec provides the explanation, the immediate feedback, and the shell-chrome delta, and documents the `data-audience-mode` hook pages consume).
- Redesigning the coworker panel's persistence model and full owner-readable control labels (**BI-3238AAF0**; this spec only enlarges the panel close/overflow hit areas to satisfy C5).
- Route-local mobile layout for Storefront setup pages (**BI-F0B389C9**).
- Owner action-safety confirm/preview/undo (**BI-7D7EE150**) and the self-upgrade release card (**BI-8D87084D**).

---

## Design

### 1. Unique Docs targets (C1, C2, C4)

- `apps/web/components/docs/ContextualDocsButton.tsx` becomes **"Help for this page"** — visible `Help` in compact (header) form, visible `Help for this page` otherwise, and a stable `aria-label="Help for this page"` plus a `title` naming the current route. It stays route-scoped via `buildContextualDocsHref`.
- The global nav Docs record (`apps/web/lib/navigation/portal-navigation-model.ts`) becomes **"All docs"**.

Result: the two controls now carry distinct visible and accessible names in every shell region.

### 2. Simple/Full: meaningful, explained delta (C2, C3)

`apps/web/components/shell/AppRail.tsx`:

- Add a persistent, mode-aware **explanation caption** under the toggle:
  - Simple → *"Showing the essentials. Builder and platform tools are hidden. Switch to Full to see everything."*
  - Full → *"Showing everything, including builder and platform tools."*
- Add a **`role="status"` live region** that announces the switch ("Switched to Simple view — showing the essentials.") for AT.
- Give the click an **immediate visible result**: while `router.refresh()` is in flight, the pressed button shows an `InlineBusy` "Switching…" affordance (`aria-busy`), so the control never looks inert.
- Give each toggle button an explicit `aria-label` naming the outcome (`Switch to Simple view`, `Switch to Full view`).

Real shell-chrome delta (so Simple is not rail-only): `apps/web/components/shell/Header.tsx` receives the resolved mode and, in Simple mode, hides builder-flavored chrome — the `Internal cockpit` badge and the "small human team…" tagline — so the owner header is visibly calmer. The `data-audience-mode` attribute stays on the shell so pages (BI-BF53A701) can extend the delta into their own body content.

### 3. Feedback opens a feedback-labeled flow (C2, C3)

`apps/web/components/feedback/HeaderFeedbackButton.tsx` opens the existing **`FeedbackForm`** popover directly — a feedback-labelled surface with a `Send feedback` title, a type select (Bug/Suggestion/Question), a message field, route/context capture (`routeContext = pathname`), and Submit/Cancel with a filed-report confirmation. It no longer dispatches `open-agent-feedback` into the coworker panel, so a `Feedback` click never leaves generic coworker chrome attached across unrelated routes (this also removes the accidental-persistence trigger noted in BI-3238AAF0 / BI-62FF22DB). The button gains `aria-haspopup="dialog"` + `aria-expanded`.

### 4. Visible result for every shell action (C3)

- **Help / All docs / nav** — navigation is the result; keep hover + focus-visible states.
- **Health badge** — opens the health popover; add `aria-expanded` so the toggle state is exposed.
- **Feedback** — opens the labelled `FeedbackForm` popover (§3).
- **Sign out** — extracted to `apps/web/components/shell/ShellSignOut.tsx`, a client form whose submit button uses `useFormStatus` to show `InlineBusy` "Signing out…" (`aria-busy`) instead of a dead click before the redirect.
- **Simple/Full** — explanation + live region + "Switching…" (§2).
- **Coworker close/overflow** — the panel already closes visibly; §5 makes the targets tappable.

### 5. Mobile tap-safe controls (C5)

Add a shared `dpf-tap-target` utility to the `@layer components` block in `apps/web/app/globals.css`: `min-height:44px; min-width:44px; display:inline-flex; align-items:center; justify-content:center;`. It guarantees the WCAG 2.2 target size without forcing the visible glyph to grow. Apply it to the alert/health badge button (`apps/web/components/monitoring/PlatformHealthIndicator.tsx`), `Feedback` (HeaderFeedbackButton), `Sign out` (ShellSignOut), the Simple/Full buttons (AppRail), and the coworker close `x` + overflow `⋯` (`apps/web/components/agent/AgentPanelHeader.tsx`). The shared class name is exported as `SHELL_TAP_TARGET_CLASS` from `apps/web/lib/shell/shell-action-contract.ts` so components and the smoke test reference one source of truth.

### 6. Task before chrome (C6)

`apps/web/app/(shell)/layout.tsx` gains a visually-hidden-until-focused **"Skip to main content"** link as the first focusable element, targeting `#main-content` on the route `<main>`. Keyboard and AT users reach the route task ahead of the global header/rail chrome. In Simple mode the header chrome recedes (§2), further front-loading the task on small viewports.

---

## The contract module

`apps/web/lib/shell/shell-action-contract.ts` (new) is the single source of truth for the shared, testable pieces of the contract:

```ts
export const SHELL_TAP_TARGET_CLASS = "dpf-tap-target";
export const CONTEXTUAL_DOCS_LABEL = "Help for this page";
export const GLOBAL_DOCS_LABEL = "All docs";
export function navModeExplanation(mode: PortalAudienceMode): string;   // caption copy
export function navModeSwitchAnnouncement(mode: PortalAudienceMode): string;  // live-region copy
export function navModeToggleAriaLabel(target: PortalAudienceMode): string;   // "Switch to Simple view"
```

The copy lives here (not inlined) so the smoke test and the components assert the same strings.

## Data Model

**No schema changes.** The Simple/Full mode continues to live in the `dpf-nav-mode` cookie.

## Files Affected

**New:**
- `docs/superpowers/specs/2026-07-22-shell-action-result-contract-design.md` (this file)
- `apps/web/lib/shell/shell-action-contract.ts`
- `apps/web/components/shell/ShellSignOut.tsx`
- `apps/web/components/shell/shell-action-result-contract.test.tsx` — 7-route action-result smoke

**Modified:**
- `apps/web/app/globals.css` — `dpf-tap-target` utility
- `apps/web/app/(shell)/layout.tsx` — skip link + `#main-content`, pass mode to Header
- `apps/web/components/shell/Header.tsx` — ShellSignOut, Simple-mode chrome reduction
- `apps/web/components/shell/AppRail.tsx` — explanation caption, live region, "Switching…", aria labels, tap targets
- `apps/web/components/docs/ContextualDocsButton.tsx` — "Help for this page" + aria/title + tap target
- `apps/web/lib/navigation/portal-navigation-model.ts` — global Docs → "All docs"
- `apps/web/components/feedback/HeaderFeedbackButton.tsx` — open FeedbackForm directly + aria + tap target
- `apps/web/components/monitoring/PlatformHealthIndicator.tsx` — tap target + `aria-expanded`
- `apps/web/components/agent/AgentPanelHeader.tsx` — tap targets on close `x` + overflow `⋯`
- `docs/platform-usability-standards.md` — new *Common Shell Action-Result Contract* section

## Testing Strategy

- **Vitest action-result smoke** (`shell-action-result-contract.test.tsx`), parameterised over the 7 owner routes by mocking `usePathname`:
  - contextual Help control's accessible name is `Help for this page`, distinct from the global `All docs` (C1);
  - the `Feedback` control opens a surface whose visible text is `Send feedback`, not a coworker conversation (C2/C3);
  - health badge, Feedback, Sign out, and Simple/Full carry `SHELL_TAP_TARGET_CLASS` (C5);
  - AppRail renders the mode explanation and a `role="status"` region, and the explanation text changes between Simple and Full (C2/C3).
- **Existing tests** in `AppRail.test.tsx`, `PlatformHealthIndicator.test.ts`, `HeaderFeedbackButton.test.tsx`, `AgentPanelHeader.test.tsx`, `nav-mode.test.ts` are updated for the new labels/aria.
- Playwright viewport assertions for Storefront setup routes remain **BI-F0B389C9**; this contract is exercised at the component level, which is the runnable gate in CI.

## Demo Story

A restaurant owner opens `/storefront` on their phone. The first thing focus lands on is **Skip to main content**. The header shows one clearly-named **Help for this page** button — not a second ambiguous `Docs`. They tap **Feedback**; a titled **Send feedback** form opens with a message box and Submit/Cancel — no COO panel bolts itself onto the next three pages. They tap **Simple**; the button shows **Switching…**, the rail sheds operator tools, the header sheds its "internal cockpit" badge, and a line explains *"Showing the essentials. Builder and platform tools are hidden."* Every control they touch is a comfortable 44px tap, and every tap produces something they can see.
