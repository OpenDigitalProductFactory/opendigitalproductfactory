# EP-UX-COGLOAD — Login redirect fix + audit-slice coordination (plan)

**Epic:** EP-UX-COGLOAD — Live UX cognitive-load audit follow-up
**Date:** 2026-07-22
**Guiding outcome:** non-technical owners should see fewer walls of text, one clear
next action, working actions/deep links, mobile-safe navigation, and technical detail
behind progressive disclosure.

## Scope of this branch

This branch ships the one epic BI with **no existing PR** — the P1 login blocker.

### BI-86165533 — Login can appear inert with valid local admin credentials (P1, bug)

Root cause: with `trustHost: true` and no `AUTH_URL`, Auth.js can derive its base URL
from the container's `0.0.0.0` bind address on some request paths. A relative
`redirectTo: "/workspace"` then resolves to `http://0.0.0.0:3000/workspace`, which is a
valid bind address but **not** a routable browser destination — so a valid login
silently leaves the browser on `/login` with no error and no console message. Same root
cause as the observed `http://0.0.0.0:3000` callback redirect.

Fix (`apps/web/lib/govern/auth-redirect.ts`): a pure
`normalizeAuthRedirect({url, baseUrl, publicUrl})` that rewrites a non-routable bind host
(`0.0.0.0`, `::`) to the operator-visible host — `PUBLIC_URL` when the operator has
configured one, otherwise `localhost` (scheme + port preserved) — while preserving
Auth.js's open-redirect guard. Wired into the Auth.js `redirect` callback in
`apps/web/lib/govern/auth.ts`. Regression coverage: `auth-redirect.test.ts` (13 cases
including the exact `/workspace` × `0.0.0.0` failing case).

**Design grounding:** extends the existing auth/host substrate
(`apps/web/lib/govern/auth.ts`, `apps/web/lib/canonical-host.ts`, `apps/web/proxy.ts`);
adds a normalization step inside the existing `redirect` callback, does not fork host
policy.

## Rest of the epic slice — already in flight (do not duplicate)

An overlap sweep at branch-finish time found the remaining audit BIs already have open,
ready-to-merge PRs from a concurrent effort. This branch deliberately does **not** touch
their files:

| BI | Priority | Existing PR | Approach there |
| --- | --- | --- | --- |
| BI-BF53A701 (Simple mode density) | 2 | #3378 | adds `density` to `WorkspaceTwinHero`, condenses the hero in Simple mode |
| BI-882B3680 (mobile nav overflow) | 4 | #3377 | makes the mobile rail `flex-wrap` (no horizontal scroll) + `min-w-0` |
| BI-62FF22DB (header Feedback flow) | 8 | #3376 | — |
| BI-7D7EE150 (owner-mutation confirm/undo) | 3 | #3379 | — |

Observation for #3378 owners (not blocking): #3378 condenses the twin **hero** but leaves
the demoted `platformBody` at hardcoded `density="simple"`, so the builder/operator
`BusinessCommandCenter` (technical snapshot: coworker counts, open-work, improvement-proposal
/ Build Studio counts) still renders there in both toggle states. If the audit's "88 AI
coworkers / 3943 proposals" density is that snapshot, gating `BusinessCommandCenter` behind
Full mode in `PlatformWorkspaceHome` would complete the Simple-mode reduction.

## Deferred (next slice — own PRs)

- **BI-8C0F219A** (P7, refactor) — route audience/destination-kind registry, **extending**
  `apps/web/lib/ea/route-manifest.json` (`build-route-manifest.ts` + `audit-route-manifest.yml`)
  with a pure `classifyRoute()` + explicit override registry + a CI warning on unclassified
  new page routes. Enables the disclosure audit below.
- **BI-1D718FCA** (P5, refactor) — progressive-disclosure audit of high-overload pages
  (`/ops`, `/build`, `/workspace/inbox`, `/platform/tools/integrations`, `/platform/ai/overview`,
  `/finance`, `/storefront`): owner-first summary + one next action + technical inventory behind
  tabs/drawers, plus route-level word-count / disclosure-marker smoke checks keyed off the
  BI-8C0F219A audience classification. Sequenced after the registry.

## Verification

- Unit: `apps/web/lib/govern/auth-redirect.test.ts` — 13 pass, run in the topic worktree.
- The full runtime gates (typecheck, production build) are the CI required checks; the shared
  local-CI convergence sandbox was `blocked_sandbox_drift` at attempt time (its
  `pnpm install --frozen-lockfile` converge failed mid-install), which is a sandbox defect,
  not product build evidence (AGENTS §5). The auth changes are a new pure module + one
  callback wire; no dependency or schema change.
