# Plan — Common Shell Action-Result Contract (BI-9C0954D0)

**Spec:** `docs/superpowers/specs/2026-07-22-shell-action-result-contract-design.md`
**Branch:** `claude/shell-action-result-contract-c38ddb`
**Scope:** the common shell chrome in `apps/web/` only. Per-page Simple/Full body deltas (BI-BF53A701), coworker-panel persistence redesign (BI-3238AAF0), Storefront mobile route layout (BI-F0B389C9), owner action-safety (BI-7D7EE150), and self-upgrade readability (BI-8D87084D) are coordinated but out of scope.

## Phase 1 — Contract substrate
1. `apps/web/lib/shell/shell-action-contract.ts` — shared labels, tap-target class, mode copy. **done**
2. `apps/web/app/globals.css` — add `.dpf-tap-target` in `@layer components`.

## Phase 2 — Unique targets & labels (C1)
3. `apps/web/components/docs/ContextualDocsButton.tsx` — "Help for this page" (compact "Help") + aria-label + route title + tap target.
4. `apps/web/lib/navigation/portal-navigation-model.ts` — global Docs label → "All docs".

## Phase 3 — Feedback flow (C2/C3)
5. `apps/web/components/feedback/HeaderFeedbackButton.tsx` — open `FeedbackForm` popover directly; drop coworker-panel dispatch as the primary path; `aria-haspopup="dialog"` + `aria-expanded`; tap target; "Send feedback" title.

## Phase 4 — Simple/Full delta + explanation (C2/C3)
6. `apps/web/components/shell/AppRail.tsx` — explanation caption, `role="status"` live region, immediate "Switching…" `InlineBusy`, outcome aria-labels, tap targets on both buttons, `data-audience-mode` passthrough.
7. `apps/web/components/shell/Header.tsx` — accept `navMode`; in Simple mode hide the "Internal cockpit" badge + tagline; use `ShellSignOut`.
8. `apps/web/components/shell/ShellSignOut.tsx` (new) — client form, `useFormStatus` "Signing out…" (C3), tap target.

## Phase 5 — Health badge + panel targets (C5)
9. `apps/web/components/monitoring/PlatformHealthIndicator.tsx` — tap target + `aria-expanded`.
10. `apps/web/components/agent/AgentPanelHeader.tsx` — tap targets on close `x` + overflow `⋯`.

## Phase 6 — Task before chrome (C6)
11. `apps/web/app/(shell)/layout.tsx` — skip-to-content link (first focusable) + `id="main-content"` on `<main>`; pass `navMode` to Header.

## Phase 7 — Tests + docs
12. `apps/web/components/shell/shell-action-result-contract.test.tsx` (new) — 7-route action-result smoke.
13. Update `AppRail.test.tsx`, `HeaderFeedbackButton.test.tsx`, `PlatformHealthIndicator.test.ts`, `AgentPanelHeader.test.tsx` for new labels/aria.
14. `docs/platform-usability-standards.md` — add *Common Shell Action-Result Contract* section.

## Verification
- Source-only worktree: run vitest directly (`node node_modules/vitest/vitest.mjs run <files>`) after relinking `.bin`, or rely on CI Unit gate; typecheck via `DPF_SKIP_TYPECHECK=1` commit override + CI Typecheck gate.
- Overlap sweep against open EP-UX-COGLOAD PRs (#3376–#3384) before push.
