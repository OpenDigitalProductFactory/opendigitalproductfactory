# Build Studio Shell-Native Refactor

**Date:** 2026-04-18  
**Status:** Draft  
**Author:** Codex  
**Purpose:** Refactor Build Studio so it works as an immersive first-class workspace inside the new portal shell, while keeping configuration and day-to-day usage clearly separated.

## 1. Inputs

This spec extends and aligns:

- `docs/superpowers/specs/2026-04-17-portal-navigation-consolidation-design.md`
- `docs/superpowers/specs/2026-04-17-business-first-portal-workflow-consolidation-design.md`
- `docs/superpowers/specs/2026-04-16-build-studio-process-improvements.md`
- `docs/superpowers/specs/2026-04-13-build-studio-happy-path-rescue-design.md`
- `docs/superpowers/specs/2026-04-13-build-studio-process-visualization.md`
- `docs/superpowers/specs/2026-04-08-build-studio-config-design.md`

It is grounded in the current implementation:

- `apps/web/app/(shell)/layout.tsx`
- `apps/web/app/(shell)/build/layout.tsx`
- `apps/web/app/(shell)/build/page.tsx`
- `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`
- `apps/web/components/build/BuildStudio.tsx`
- `apps/web/components/agent/AgentCoworkerShell.tsx`
- `apps/web/components/agent/agent-panel-layout.ts`

## 2. Problem Statement

Build Studio was designed before the portal shell was consolidated around a compact left rail, a utilities-focused top bar, and a docked AI coworker. The shell has improved, but Build Studio still behaves like a separate fullscreen application.

Today, the main breakage is structural:

1. `/build` forcibly breaks out of the shell with `fixed inset-0 top-[48px]` in `apps/web/app/(shell)/build/page.tsx`.
2. The shell expects pages to live inside shared width, padding, and coworker-reservation rules in `apps/web/app/(shell)/layout.tsx`.
3. The coworker now docks on desktop and reserves width through `--agent-panel-reserved-width`, but Build Studio still assumes it owns the entire viewport.
4. `/platform/ai/build-studio` already exists as a configuration page, so users can now encounter two different places called "Build Studio" that do different jobs.

This creates three user-facing failures:

- the studio feels visually broken after the navigation refactor
- the app shell and the studio compete for screen ownership
- "use the studio" and "configure the studio" are not clearly distinguished

## 3. Goals

1. Keep `/build` as the primary day-to-day Build Studio workspace.
2. Preserve an immersive, cockpit-like Build Studio experience without bypassing the shared shell.
3. Keep `/platform/ai/build-studio` as a configuration-only page for CLI/runtime setup.
4. Make the AI coworker feel like a supporting expert pane, not a collision with the studio canvas.
5. Reduce navigation ambiguity so users understand where to build, where to configure, and where to return to active work.
6. Create a reusable "immersive within shell" pattern for other specialized workspaces if needed later.

## 4. Non-Goals

This refactor does not:

- redesign the underlying Build Studio orchestration pipeline
- replace the process graph model introduced in earlier specs
- merge Build Studio into `/platform/ai/build-studio`
- solve every platform/admin information architecture issue in the same change

Those remain adjacent work, but this slice removes the largest current UX mismatch.

## 5. Operating Model Assumption

This portal is optimized for a small number of human operators, many of whom are external or fractional, with AI coworkers filling specialist depth across domains.

That means Build Studio should not assume:

- an expert engineer sitting in the product all day
- a human who knows the entire platform map
- a willingness to hop between config screens and execution screens to understand one job

The target experience is:

> Start a build, stay in one focused workspace, rely on the coworker for specialist support, and only visit configuration when something administrative needs to change.

## 6. Research & Benchmarking

### 6.1 Systems compared

Open source leaders:

- **Plane App Rail**
  - separates app switching from local work surfaces
  - treats persistent navigation as compact, scalable chrome rather than descriptive page content
  - source: <https://plane.so/blog/introducing-apprail-plane-new-navigation>

- **GitLab navigation sidebar / Pajamas**
  - keeps navigation available when it helps users complete tasks
  - emphasizes consistent top-level positioning with context-sensitive sub-level items
  - explicitly allows a minimal layout only when navigation is not beneficial
  - sources:
    - <https://design.gitlab.com/patterns/navigation-sidebar/>
    - <https://docs.gitlab.com/development/navigation_sidebar/>

Commercial best-of-breed:

- **Atlassian new navigation**
  - moved primary product navigation from the top bar to the sidebar
  - keeps the top bar for universal actions like search and create
  - validated with staged user testing and iterative rollout
  - source: <https://www.atlassian.com/blog/design/designing-atlassians-new-navigation>

- **GitHub Codespaces**
  - keeps an immersive, split-pane development workspace while preserving stable global product framing
  - demonstrates that a browser-based build environment can feel specialized without becoming a disconnected fullscreen island
  - source: <https://github.com/features/codespaces>

Internal platform references:

- current shell consolidation already established the compact left rail and coworker docking direction
- the existing Build Studio process specs already prefer a guided, trustworthy, low-black-box build experience

### 6.2 Patterns adopted

1. **Stable shell, immersive workspace inside it**  
   Adopted from Atlassian, Plane, and GitHub Codespaces. The shell gives durable orientation; the workspace gives domain focus.

2. **One canonical home for doing the work**  
   Users should not have to infer whether `/build` or `/platform/ai/build-studio` is the "real" studio.

3. **Configuration separated from execution**  
   Setup/config stays quieter and less prominent than operational workflow surfaces.

4. **Compact nav, richer content surface**  
   Persistent navigation should orient. The page should do the explaining.

5. **Contextual side panels instead of overlapping chrome**  
   The coworker should augment the build flow and preserve continuity, not cover the canvas.

### 6.3 Patterns rejected

1. **Fullscreen takeover routes inside a shared portal shell**  
   This was acceptable before the shell refactor. It is now a structural anti-pattern.

2. **Duplicate Build Studio homes**  
   A user-facing product should not have one route for usage and another route with nearly the same name that appears to be another usage surface.

3. **Global-navigation-like tabs inside the workspace**  
   Graph/details/preview are workspace modes, not product-level navigation.

4. **Viewport-coupled heights with magic offsets**  
   Hardcoded `top-[48px]` and `calc(100vh - 200px)` values are brittle once shell chrome changes.

### 6.4 Anti-patterns identified and avoided

- overlapping shells and content ownership
- two places named Build Studio doing different jobs
- build flow spread across navigation, page, and coworker without clear roles
- bottom-fixed or viewport-fixed elements that assume the page owns the full browser window

## 7. Decision

### 7.1 Canonical route model

- `/build` is the **only** primary Build Studio workspace.
- `/platform/ai/build-studio` is the **configuration** page for CLI/runtime/provider setup.
- Any Platform page that implies "go use Build Studio" should deep-link to `/build`.
- Any Build Studio page that implies "change runtime/provider settings" should deep-link to `/platform/ai/build-studio`.

### 7.2 Experience model

Build Studio remains an immersive split-pane cockpit.

It does **not** become a standard portal card page.

However, it becomes shell-native:

- it respects the app rail
- it respects the top bar
- it respects reserved coworker width on desktop
- it renders as a full-height studio surface inside the shell instead of escaping it

## 8. Target UX Model

### 8.1 Shell roles

Global shell:

- left rail = durable app/domain navigation
- top bar = utilities, account, health, search
- right side = AI coworker when open

Build Studio page:

- left pane = build navigator + create/resume entry
- center = active build workspace
- in-workspace tabs = graph, details/review, preview

This removes role confusion:

- the shell answers "where am I in the product?"
- the studio answers "what build am I working on?"
- the coworker answers "how do I move this forward?"

### 8.2 Page composition

The `/build` page should render a single studio surface with these traits:

- full available content width inside the shell, not `max-w-7xl`
- full available content height under the header/status area, not fixed to raw viewport offsets
- rounded, bordered, theme-aware workspace frame
- overflow controlled inside the studio, not by the document body

### 8.3 Primary states

#### No active builds

Show a focused empty state that makes three things obvious:

- what Build Studio does
- how to start a new build
- that the coworker will guide the user after creation

This should feel like the front door of the studio, not a generic blank page.

#### Existing builds

The left build navigator should prioritize:

- active/in-progress builds first
- recent builds next
- clear selection state
- obvious resume behavior

#### Active build selected

The center workspace becomes the stable place for:

- process graph and execution state
- supporting details / review context
- live preview when available

### 8.4 Coworker integration

Desktop:

- coworker remains docked on the right when open
- `/build` content shrinks cleanly using reserved-width logic already introduced in the shell
- the studio should still feel balanced when the coworker is open

Closed state:

- the floating pill remains acceptable
- opening the coworker from build creation remains the right behavior

The coworker should be treated as an expert console attached to the studio, not as another layer of navigation.

## 9. Technical Design

### 9.1 Add shell-native immersive page mode

The shell currently hardcodes:

- inner content padding
- `max-w-7xl` for the child page container

That works for standard portal pages, but not for immersive tools like Build Studio.

Introduce a route-scoped shell presentation mode for immersive pages.

Recommended implementation shape:

- shell layout reads CSS custom properties for page max width and page padding, with current values as defaults
- immersive routes can override those variables on mount and clean them up on unmount
- Build Studio sets:
  - page max width to full available width
  - tighter or zero inner shell padding as appropriate for the studio frame

This is preferable to:

- more negative-margin breakouts
- additional fullscreen `fixed` wrappers
- special-casing only `/build` directly in shell markup

### 9.2 Refactor `/build/page.tsx`

Remove the fullscreen breakout wrapper:

- delete `fixed inset-0 top-[48px]`
- stop assuming the page owns the viewport

Replace it with a shell-native studio frame:

- `min-h` based on available shell space
- full-width content surface
- overflow handled inside the studio component

### 9.3 Refactor `BuildStudio.tsx`

Keep the split-pane model, but align it to the new shell:

- remove remaining viewport-coupled heights where feasible
- replace magic `calc(100vh - ...)` graph sizing with container-driven height
- ensure the left build navigator width feels proportional now that the outer shell also has a left rail
- make the center header feel like workspace state, not a second global nav

### 9.4 Clarify internal workspace navigation

Keep the current workspace modes but frame them as build modes:

- `Graph`
- `Details` or `Review`, depending on build phase
- `Live Preview` when preview exists

These should stay visually subordinate to the page title and build identity.

### 9.5 Preserve configuration separation

`/platform/ai/build-studio` remains a straightforward configuration page:

- title should clearly communicate setup/administration
- wording should reinforce that this page affects how builds run, not where builds are executed
- links from this page back to `/build` should use language like "Open Build Studio"

## 10. Responsive Behavior

Desktop:

- app rail visible
- build navigator visible by default
- coworker docks on the right above the reserved-width system

Tablet:

- app rail remains
- build navigator can collapse more aggressively
- center canvas stays primary

Mobile / narrow screens:

- follow current sidebar toggle pattern
- no desktop coworker reservation
- studio becomes a stacked experience rather than forcing three concurrent columns

## 11. Information Architecture Rules

1. Only one route is the working studio: `/build`.
2. Platform Build Studio config is not a second studio.
3. Global navigation must never be restated as workspace tabs.
4. Workspace tabs only switch the representation of the selected build.
5. Configuration links are escape hatches, not peer destinations inside the working flow.

## 12. Implementation Sequence

### Phase 1: Repair the shell integration

- add immersive shell mode
- remove `/build` fullscreen breakout
- make the studio fill the shell-native workspace area cleanly

### Phase 2: Repair Build Studio layout hierarchy

- tune pane widths
- remove brittle height calculations
- refine empty and selected states
- ensure coworker-open state still feels balanced

### Phase 3: Repair route clarity

- audit every Build Studio entry point
- replace "go to Build Studio" links that point at config pages
- add explicit config links only where administrative setup is the real task

### Phase 4: Continue broader consolidation work

After Build Studio is repaired, resume the broader workflow refactor:

- narrow and regroup `Admin`
- continue route demotion and hub cleanup in remaining Platform areas
- keep Build Studio aligned with the same business-first, workflow-first IA model

## 13. Verification

Before claiming the refactor done:

1. Run affected unit tests.
2. Add or update tests for shell presentation mode and Build Studio layout behavior where practical.
3. Run `pnpm --filter web build`.
4. Rebuild the live Docker portal image.
5. Live-smoke:
   - `/build`
   - `/platform/ai/build-studio`
   - coworker open and closed on desktop
   - empty state and active build state

## 14. Success Criteria

This refactor succeeds when:

- `/build` no longer visually fights the app shell
- Build Studio still feels immersive and specialized
- the coworker no longer appears to overlap or steal ownership from the studio
- users can clearly distinguish "use Build Studio" from "configure Build Studio"
- the refactor establishes a repeatable immersive-page pattern instead of another exception

## 15. Follow-on Refactoring Opportunities

Discovered during this design, but deferred:

1. create a shared page-shell utility for immersive route presentation instead of repeating route-level overrides
2. standardize "workspace mode" tabs across specialized surfaces like Build Studio and future operational cockpits
3. review whether the bottom `PhaseIndicator` should eventually merge into the active build header or graph surface instead of living as a separate strip
