# Build Studio Shell-Native Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Build Studio so `/build` remains the immersive day-to-day workspace while fitting cleanly inside the new shell, and make `/platform/ai/build-studio` read as configuration-only.

**Architecture:** Add a reusable shell presentation mode that lets immersive routes override shell width/padding through root CSS variables instead of fullscreen breakouts. Then refactor the Build Studio page/component to use that mode, replace viewport-coupled sizing with container-driven layout, and clean up Platform-side labels/links so users can clearly distinguish building from configuring.

**Tech Stack:** Next.js App Router, React server/client components, TypeScript, Tailwind utilities with DPF CSS variables, Vitest, Docker Compose, Playwright/live browser smoke checks.

---

## Scope

This plan covers the Build Studio refactor defined in:

- `docs/superpowers/specs/2026-04-18-build-studio-shell-native-refactor-design.md`

This plan intentionally includes only:

- shell-native immersive page support needed for `/build`
- `/build` layout repair
- Build Studio route clarity cleanup in Platform
- QA-plan updates and verification for this slice

Do **not** fold Admin regrouping or unrelated Platform IA work into this plan. Resume that broader consolidation only after this slice is shipped and verified.

## Constraints

- Use the PR workflow for this slice. Create one short-lived intent-named branch and do not push directly to `main`.
- Do not touch unrelated dirty files already present in the worktree:
  - `.admin-credentials`
  - `.host-profile.json`
  - `apps/web/components/agent/AgentCoworkerPanel.tsx`
  - `apps/web/components/agent/AgentCoworkerShell.tsx`
  - `apps/web/components/agent/AgentPanelHeader.test.tsx`
  - `apps/web/components/agent/AgentPanelHeader.tsx`
  - `apps/web/components/agent/agent-panel-layout.test.ts`
  - `apps/web/components/agent/agent-panel-layout.ts`
  - `monitoring/prometheus/alerts.yml`
  - `monitoring/prometheus/prometheus.yml`
  - `.codex`
- Keep all new/edited UI theme-aware: `--dpf-bg`, `--dpf-surface-1`, `--dpf-surface-2`, `--dpf-text`, `--dpf-muted`, `--dpf-border`, `--dpf-accent`.
- Production build must pass before claiming the refactor is done.

## File Structure

### Existing files to modify

- `apps/web/app/(shell)/layout.tsx`
  - consume root CSS variables for page frame width, content width, padding, and minimum content height so immersive routes can opt in without viewport hacks
- `apps/web/app/(shell)/build/layout.tsx`
  - keep the existing permission gate but activate shell presentation overrides for the Build Studio route
- `apps/web/app/(shell)/build/page.tsx`
  - remove the old fullscreen breakout and render the studio as a shell-native workspace page
- `apps/web/components/build/BuildStudio.tsx`
  - rebalance pane widths, remove viewport-coupled graph height, and make the empty/active states fit the new shell
- `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`
  - clarify this page as runtime/configuration, not the main studio
- `apps/web/components/platform/BuildStudioConfigForm.tsx`
  - reinforce configuration-only messaging and add a clear route back to `/build`
- `apps/web/components/platform/AiTabNav.tsx`
  - remove the ambiguous “Build Studio” tab label from the AI operations subnav
- `apps/web/components/platform/WorkforceTabNav.tsx`
  - keep the workforce nav label aligned with the renamed configuration surface
- `apps/web/components/platform/platform-nav.ts`
  - update the canonical Platform family metadata so the Build Studio config route no longer reads like the primary studio
- `apps/web/components/platform/platform-nav.test.ts`
  - cover the renamed AI sub-item and route membership assumptions
- `tests/e2e/platform-qa-plan.md`
  - add Build Studio shell-native / configuration-separation regression cases

### New files to create

- `apps/web/components/shell/ShellPresentationMode.tsx`
  - client helper that sets/removes root CSS variables for immersive routes and keeps shell content metrics current on resize
- `apps/web/components/shell/ShellPresentationMode.test.tsx`
  - regression coverage for root CSS variable lifecycle and cleanup on unmount
- `apps/web/components/build/BuildStudio.test.tsx`
  - render-focused regression coverage for the shell-native Build Studio layout and empty/active states
- `apps/web/components/platform/BuildStudioConfigForm.test.tsx`
  - focused test for configuration-page language and “Open Build Studio” return affordance

### Existing files that may need small supporting edits in the same slice

- `apps/web/app/(shell)/platform/ai/page.tsx`
  - only if the AI operations overview copy directly references the old ambiguous Build Studio label
- `apps/web/components/platform/PlatformTabNav.tsx`
  - only if the rendered sub-item labels need support changes beyond `platform-nav.ts`

Do not broaden beyond these unless a failing test or build error proves another file is required.

---

## Chunk 1: Shell-Native Immersive Page Mode

### Task 1: Add regression coverage for shell presentation mode

**Files:**
- Create: `apps/web/components/shell/ShellPresentationMode.test.tsx`

- [ ] **Step 1: Write the failing test**

Create a jsdom render test that proves an immersive route helper:

- sets root CSS variables on mount
- removes them on unmount
- updates a shell content offset variable when `[data-shell-content='true']` is present

Use the same testing style as `apps/web/components/agent/agent-panel-layout.test.ts` and `apps/web/components/shell/AppRail.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter web exec vitest run components/shell/ShellPresentationMode.test.tsx
```

Expected:
- FAIL because the component does not exist yet

- [ ] **Step 3: Write the minimal test harness**

Mock only what is necessary. Stub `getBoundingClientRect()` on a fake `[data-shell-content='true']` element so the test can assert a deterministic content-top variable such as:

```ts
expect(document.documentElement.style.getPropertyValue("--shell-content-top")).toBe("112px");
```

- [ ] **Step 4: Re-run the test and confirm the intended failure**

Run:

```bash
pnpm --filter web exec vitest run components/shell/ShellPresentationMode.test.tsx
```

Expected:
- FAIL with “Cannot find module” or equivalent missing-component failure

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/shell/ShellPresentationMode.test.tsx
git commit -m "test(build): add shell presentation mode coverage"
```

### Task 2: Implement shell presentation mode and wire it into the Build route

**Files:**
- Create: `apps/web/components/shell/ShellPresentationMode.tsx`
- Modify: `apps/web/app/(shell)/layout.tsx`
- Modify: `apps/web/app/(shell)/build/layout.tsx`
- Test: `apps/web/components/shell/ShellPresentationMode.test.tsx`

- [ ] **Step 1: Implement `ShellPresentationMode.tsx`**

Create a client component that accepts explicit overrides such as:

```tsx
type Props = {
  frameMaxWidth?: string;
  contentMaxWidth?: string;
  pagePadding?: string;
  bottomGap?: string;
};
```

On mount:

- set root CSS variables on `document.documentElement`
- compute `--shell-content-top` by querying `[data-shell-content='true']`
- recompute on `resize`

On unmount:

- remove only the variables this helper owns

- [ ] **Step 2: Make shell layout consume the new variables**

Refactor `apps/web/app/(shell)/layout.tsx` so the shell uses CSS-variable fallbacks instead of hard-coded values:

- frame max width fallback: `1600px`
- content max width fallback: `80rem`
- page padding fallback: current `p-4 lg:p-6`
- content minimum height based on `100dvh - --shell-content-top - --shell-page-bottom-gap`

Use inline `style` only for the CSS variable expressions. Keep all colors in Tailwind/theme variables.

Example target shape:

```tsx
<div
  className="mx-auto w-full transition-[padding-right] duration-200"
  style={{
    maxWidth: "var(--shell-page-frame-max-width, 1600px)",
    paddingRight: "var(--agent-panel-reserved-width, 0px)",
  }}
>
```

- [ ] **Step 3: Activate the mode for the Build Studio route**

Update `apps/web/app/(shell)/build/layout.tsx` to render:

```tsx
<>
  <ShellPresentationMode
    frameMaxWidth="1600px"
    contentMaxWidth="none"
    pagePadding="0px"
    bottomGap="16px"
  />
  {children}
</>
```

Keep the current auth/permission gate intact.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
pnpm --filter web exec vitest run components/shell/ShellPresentationMode.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/shell/ShellPresentationMode.tsx apps/web/components/shell/ShellPresentationMode.test.tsx apps/web/app/(shell)/layout.tsx apps/web/app/(shell)/build/layout.tsx
git commit -m "feat(build): add shell-native immersive page mode"
```

---

## Chunk 2: Build Studio Workspace Layout Repair

### Task 3: Add Build Studio render regression coverage

**Files:**
- Create: `apps/web/components/build/BuildStudio.test.tsx`

- [ ] **Step 1: Write the failing tests**

Cover two scenarios:

1. **Empty state**
   - renders “Product Development Studio”
   - explains how to start a build
   - does **not** emit the old viewport-coupled `100vh` sizing string
2. **Active build state**
   - renders the selected build title/id
   - renders the workspace tablist
   - renders a stable studio shell test id such as `data-testid="build-studio-shell"`

Mock:

- `next/navigation`
- `@/lib/actions/build`
- `@/lib/actions/build-read`
- heavy child panels like `ProcessGraph`, `FeatureBriefPanel`, `ReviewPanel`, and `SandboxPreview`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter web exec vitest run components/build/BuildStudio.test.tsx
```

Expected:
- FAIL because the test file is new and/or the current component still contains the old viewport-coupled graph height

- [ ] **Step 3: Build the minimal fixture data**

Use one `FeatureBuildRow` in progress and one empty `builds` array fixture. Keep the mocked build object minimal but valid for the component props.

- [ ] **Step 4: Re-run the test and confirm the intended failure**

Run:

```bash
pnpm --filter web exec vitest run components/build/BuildStudio.test.tsx
```

Expected:
- FAIL on an assertion that captures the current fullscreen-era layout behavior

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/build/BuildStudio.test.tsx
git commit -m "test(build): add studio layout regression coverage"
```

### Task 4: Remove the fullscreen breakout and refactor the Build Studio layout

**Files:**
- Modify: `apps/web/app/(shell)/build/page.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`
- Test: `apps/web/components/build/BuildStudio.test.tsx`

- [ ] **Step 1: Remove the legacy fullscreen wrapper from `/build/page.tsx`**

Delete the old:

```tsx
<div className="fixed inset-0 top-[48px]">
```

Replace it with a shell-native wrapper such as:

```tsx
<section className="min-h-full">
  <BuildStudio ... />
</section>
```

The page should no longer assume it owns the viewport.

- [ ] **Step 2: Refactor `BuildStudio.tsx` around a shell-native studio frame**

Keep the split-pane model, but make it fit the shell:

- outer root becomes a bordered, rounded, theme-aware workspace surface
- sidebar width drops from `360px` desktop to a more proportional `300-320px` range
- graph/view region uses flex/container sizing instead of `calc(100vh - 200px)`
- empty state remains helpful but visually belongs to the studio frame
- active-build header and tabs read as workspace state, not app-level navigation

Also fix any touched text/background usage that still references non-standard tokens such as `--dpf-text-secondary`; use `--dpf-text` / `--dpf-muted` instead.

- [ ] **Step 3: Make the Build Studio tests pass**

Run:

```bash
pnpm --filter web exec vitest run components/build/BuildStudio.test.tsx
```

Expected:
- PASS

- [ ] **Step 4: Run the focused Build Studio regression set**

Run:

```bash
pnpm --filter web exec vitest run components/shell/ShellPresentationMode.test.tsx components/build/BuildStudio.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/build/page.tsx apps/web/components/build/BuildStudio.tsx apps/web/components/build/BuildStudio.test.tsx
git commit -m "feat(build): refactor studio to live inside the shell"
```

---

## Chunk 3: Route Clarity and Configuration Separation

### Task 5: Add route-label and config-page regression coverage

**Files:**
- Modify: `apps/web/components/platform/platform-nav.test.ts`
- Create: `apps/web/components/platform/BuildStudioConfigForm.test.tsx`

- [ ] **Step 1: Update the platform-nav tests for the renamed config destination**

Add assertions that the AI Operations family still matches `/platform/ai/build-studio`, but the sub-item label now reflects configuration/runtime intent rather than the primary studio.

Preferred assertion shape:

```ts
expect(aiFamily.subItems.some((item) => item.label === "Build Runtime")).toBe(true);
```

- [ ] **Step 2: Write the failing config-form test**

Add a render test for `BuildStudioConfigForm` that proves:

- the page communicates runtime/config intent
- there is a visible link or CTA back to `/build`

Mock the save action and render with minimal provider fixtures.

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
pnpm --filter web exec vitest run components/platform/platform-nav.test.ts components/platform/BuildStudioConfigForm.test.tsx
```

Expected:
- FAIL because the current labels/copy are still ambiguous and the config form lacks the return CTA

- [ ] **Step 4: Re-run to confirm the expected failure surface**

Run the same command again after tightening the assertions so they match the intended end state exactly.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/platform/platform-nav.test.ts apps/web/components/platform/BuildStudioConfigForm.test.tsx
git commit -m "test(platform): cover build runtime route clarity"
```

### Task 6: Implement the route and copy cleanup

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`
- Modify: `apps/web/components/platform/BuildStudioConfigForm.tsx`
- Modify: `apps/web/components/platform/AiTabNav.tsx`
- Modify: `apps/web/components/platform/WorkforceTabNav.tsx`
- Modify: `apps/web/components/platform/platform-nav.ts`
- Test: `apps/web/components/platform/platform-nav.test.ts`
- Test: `apps/web/components/platform/BuildStudioConfigForm.test.tsx`

- [ ] **Step 1: Rename the ambiguous nav labels**

Update the Platform-side labels from plain “Build Studio” to a configuration-oriented label such as `Build Runtime` or `Build Studio CLI`.

Apply this consistently in:

- `platform-nav.ts`
- `AiTabNav.tsx`
- `WorkforceTabNav.tsx`

- [ ] **Step 2: Clarify the configuration page copy**

Update `apps/web/app/(shell)/platform/ai/build-studio/page.tsx` so the title and subtitle clearly communicate:

- this page configures how builds run
- this is not the main place to create or supervise builds

Add a visible link back to `/build`, for example:

```tsx
<Link href="/build" className="...">
  Open Build Studio
</Link>
```

- [ ] **Step 3: Refine `BuildStudioConfigForm.tsx` while touching it**

Add a top-level “Open Build Studio” affordance and align touched surface styles with standard tokens:

- replace `var(--dpf-card)` with `var(--dpf-surface-1)` if you edit those sections
- keep borders on `var(--dpf-border)`
- keep copy on `var(--dpf-text)` / `var(--dpf-muted)`

Do **not** redesign the whole form; stay focused on configuration clarity.

- [ ] **Step 4: Run the focused Platform regression tests**

Run:

```bash
pnpm --filter web exec vitest run components/platform/platform-nav.test.ts components/platform/BuildStudioConfigForm.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/build-studio/page.tsx apps/web/components/platform/BuildStudioConfigForm.tsx apps/web/components/platform/AiTabNav.tsx apps/web/components/platform/WorkforceTabNav.tsx apps/web/components/platform/platform-nav.ts apps/web/components/platform/platform-nav.test.ts apps/web/components/platform/BuildStudioConfigForm.test.tsx
git commit -m "feat(platform): separate build runtime from the working studio"
```

---

## Chunk 4: QA Evidence and Final Verification

### Task 7: Update the platform QA plan for this regression surface

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Add Build Studio shell-native cases**

Append the next available Build Studio IDs under Phase 10:

- one case for `/build` staying visible and usable with the docked coworker open
- one case for `/platform/ai/build-studio` clearly behaving as configuration with a path back to `/build`

Use the existing table style and keep both steps/action and expected outcome concrete.

- [ ] **Step 2: Save the doc update**

Keep the cases short and executable in Playwright/manual smoke form.

- [ ] **Step 3: Commit the QA plan change**

```bash
git add tests/e2e/platform-qa-plan.md
git commit -m "test(qa): cover build studio shell-native navigation"
```

- [ ] **Step 4: Re-open the final verification command list**

Prepare the exact verification run before executing it so nothing is skipped.

- [ ] **Step 5: Keep the repo clean except for the implementation slice**

Confirm only the intended Build Studio / Platform / shell files are staged or modified for this refactor.

### Task 8: Run the final verification gate

**Files:**
- Verify: `apps/web/app/(shell)/layout.tsx`
- Verify: `apps/web/app/(shell)/build/layout.tsx`
- Verify: `apps/web/app/(shell)/build/page.tsx`
- Verify: `apps/web/components/build/BuildStudio.tsx`
- Verify: `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`
- Verify: `apps/web/components/platform/BuildStudioConfigForm.tsx`
- Verify: `apps/web/components/platform/AiTabNav.tsx`
- Verify: `apps/web/components/platform/WorkforceTabNav.tsx`
- Verify: `apps/web/components/platform/platform-nav.ts`
- Verify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Run the affected Vitest suite**

Run:

```bash
pnpm --filter web exec vitest run components/shell/ShellPresentationMode.test.tsx components/build/BuildStudio.test.tsx components/platform/platform-nav.test.ts components/platform/BuildStudioConfigForm.test.tsx
```

Expected:
- PASS

- [ ] **Step 2: Run the production build gate**

Run:

```bash
pnpm --filter web build
```

Expected:
- PASS with zero build errors

- [ ] **Step 3: Rebuild the live Docker portal**

Run:

```bash
docker compose up -d --build portal
```

Expected:
- portal container rebuilds and starts successfully

- [ ] **Step 4: Live-smoke the critical routes**

Verify in the running portal:

- `/build` with coworker closed
- `/build` with coworker open on desktop
- `/platform/ai/build-studio`
- one create/resume flow in Build Studio

Expected:
- Build Studio remains inside the shell
- content is not hidden under the app rail or docked coworker
- config page reads as configuration and links back to `/build`

- [ ] **Step 5: Commit any final verification-driven fixes**

If verification reveals issues, fix them immediately, re-run the affected checks, then commit with a targeted message such as:

```bash
git add <exact files>
git commit -m "fix(build): polish shell-native studio verification issues"
```

Only skip this step if no verification-driven fixes were necessary.

