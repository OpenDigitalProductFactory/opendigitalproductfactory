# EP-UX-BUILD: Build Studio UX Streamlining & Standards Integration

**Status:** Draft
**Date:** 2026-03-20
**Epic:** Build Studio UX Streamlining
**Scope:** UX evaluation skill for AI coworker, Build Studio usability standards integration, automated evidence chain for non-developer users, Dev toggle tiering
**Dependencies:** EP-UX-STANDARDS (Platform-Wide Usability Standards — implemented), EP-BUILD-001 (Build Studio — implemented)

---

## Problem Statement

The Build Studio enables non-developers to build digital products through a 5-phase pipeline (Ideate → Plan → Build → Review → Ship). However, the current implementation has three significant gaps:

1. **No UX evaluation capability.** The AI coworker knows what page the user is on and can fetch page data, but cannot evaluate the live page's UX quality — no accessibility analysis, no component inspection, no contrast checking. Users who say "this page feels wrong" get conversation, not analysis.

2. **UX standards absent from the build pipeline.** The coding agent receives zero UX context — no WCAG ratios, no semantic HTML guidance, no reference to the platform usability standards. All three review checklists (design, plan, code) have zero UX items. The Playwright test generator produces empty screenshot placeholders with no assertions. UX tests are optional in the phase gates.

3. **Too much technical burden on non-dev users.** The current flow asks users to review design documents, implementation plans, and acceptance criteria evaluations — artifacts that non-developers cannot meaningfully assess. The agent should produce all regulatory artifacts autonomously while keeping the user informed in plain language.

## Goals

1. AI coworker can evaluate any page's UX quality by reading component code AND interacting with the live page via Playwright
2. Build Studio coding agent, review checklists, and Playwright assertions all enforce platform usability standards
3. Non-dev users experience a streamlined flow: describe intent → confirm → validate visually → ship
4. Dev toggle gates technical depth: OFF = plain language, no code shown; ON = full artifacts, code access
5. UX tests become a required phase gate (Review → Ship)
6. Full regulatory evidence chain preserved regardless of user technical level
7. Every improvement identified by the UX evaluation skill creates a backlog item so nothing is forgotten

## Non-Goals

- Manual accessibility toggle or override for individual builds
- Custom UX rules per organization (platform standards are universal)
- AI-generated visual design mockups (agent evaluates and codes, doesn't design)
- Changes to the Build Studio's 5-phase structure
- Build Studio multi-user collaboration

---

## Design

### 1. UX Evaluation Skill

A new universal skill — "Evaluate this page" — available on every route via the AI coworker skills dropdown. It combines code analysis with live page interaction.

#### 1.1 Skill Registration

Add to the universal skills in `route-context-map.ts` (alongside "Analyze this page", "Do this for me", "Add a skill"):

```ts
{
  label: "Evaluate this page",
  description: "Check this page for usability issues — accessibility, contrast, layout, and UX patterns",
  capability: null,  // Available to all employees
  taskType: "analysis",
  prompt: "Evaluate the UX of this page. Read the component code to understand the implementation, then interact with the live page to check accessibility, contrast, focus management, and usability patterns. Present findings in plain language with actionable recommendations."
}
```

#### 1.2 New Tool: `evaluate_page`

A new MCP tool registered in `mcp-tools.ts` that runs Playwright against the current production page (not the sandbox). Input: the current route path. Output: a structured `PageEvaluation` result.

**What it captures:**
- Screenshot of the current page
- Accessibility audit via `@axe-core/playwright` (`AxeBuilder(page).analyze()`) — returns structured WCAG violations with severity, impact, element selectors, and WCAG rule references. This replaces the deprecated `page.accessibility.snapshot()` API (removed in Playwright 1.38+). Axe-core is the industry standard for automated accessibility testing and maps directly to our `UxFinding` type.
- Focus order — tabs through all interactive elements via `page.keyboard.press('Tab')`, records which have visible focus indicators by checking computed `outline` / `box-shadow` styles
- Contrast compliance — handled by axe-core's `color-contrast` rule, which checks all text/background pairs against WCAG 2.2 AA thresholds (4.5:1 normal text, 3:1 large text/UI). No custom sampling needed.
- CSS variable compliance — evaluates `getComputedStyle()` on visible text and background elements, flags any that resolve to hardcoded hex matching the platform's dark/light defaults (e.g., `#0f0f1a`, `#ffffff`) rather than inheriting from CSS variables. Also detects Tailwind classes (`text-white`, `bg-black`) by checking for exact computed color values that match these patterns.
- Responsive check — captures at 3 viewport widths (mobile 375px, tablet 768px, desktop 1280px)

**Performance:** Expected execution time is 10-20 seconds per evaluation (3 viewport captures + axe-core audit + focus traversal). The agent informs the user: "Evaluating this page — this takes about 15 seconds..." and reports progress. Timeout: 60 seconds. On timeout, returns partial results.

**Error handling:** If Playwright cannot launch (Docker not running, browser crash), the tool returns `{ error: "...", partialFindings: [] }` and the agent falls back to code-only analysis, informing the user: "I couldn't launch the browser to test the live page, but I can still review the code."

**What it returns:**

```ts
type PageEvaluation = {
  url: string;
  screenshot: string;          // base64 or file path
  axeViolations: AxeViolation[]; // from @axe-core/playwright
  findings: UxFinding[];
};

type UxFinding = {
  severity: "critical" | "important" | "minor";
  category: "contrast" | "accessibility" | "focus" | "semantic-html" | "color-only" | "css-compliance" | "responsive";
  element: string;             // CSS selector or description
  issue: string;               // Plain-language description
  recommendation: string;      // What to do about it
  wcagRef?: string;            // e.g. "1.4.3 Contrast (Minimum)"
};
```

**Capability:** No specific capability required (read-only analysis). Available in both advise and act modes.

**Scope:** This tool evaluates **production pages** for the UX evaluation skill. The Build Studio's existing `generate_ux_test` / `run_ux_test` tools continue to handle **sandbox pages**. The `evaluate_page` tool accepts a URL parameter but defaults to the current route — production URL for the coworker skill, sandbox URL if explicitly provided.

**Implementation:** Uses the existing Playwright MCP server (already configured in `.playwright-mcp/`). The tool launches a browser, navigates to the page URL, runs the analysis, and returns results. The browser session is ephemeral — created and destroyed per evaluation. Requires `@axe-core/playwright` as a dependency (added to `apps/web/package.json`).

#### 1.3 Code Analysis

Before running the live evaluation, the agent reads the page's component code using existing tools (`read_project_file`, `search_project_files`). This provides implementation context:

- Which CSS variables are used vs hardcoded colors
- Whether semantic HTML elements are used (`<nav>`, `<main>`, `<article>`) vs generic `<div>`s
- Whether ARIA attributes are present on interactive elements
- Whether form elements have labels

The agent compares the code analysis with the live evaluation to produce findings. Code tells what was intended; the live page tells what actually rendered.

#### 1.4 Assessment Output

The agent synthesizes findings into a plain-language assessment. For non-dev users, findings are presented as:

> "I found 3 issues on this page:
> 1. The search input doesn't have a visible focus ring when you tab to it — keyboard users can't see where they are
> 2. Two status badges use only color to show 'active' vs 'inactive' — they need text labels too
> 3. The 'Delete' button text is too low contrast against the red background"

For dev users (Dev toggle ON), findings also include component file paths, line numbers, and specific code changes needed.

#### 1.5 Actionable Output

Each finding flows into one of three paths:

1. **Backlog item** — Findings are grouped by category (contrast, accessibility, focus, etc.) into one backlog item per category. The item title is the category, the body contains all findings of that category. This prevents noise (15 CSS violations don't create 15 items). Before creating, the agent checks existing backlog items for duplicates. Linked to an appropriate epic if one exists.

2. **Build Studio handoff** — After presenting findings, the agent asks: "Want to build fixes for these now?" If yes, it assembles a `FeatureBrief` from the conversation (title, description, acceptance criteria derived from the findings) and navigates the user to Build Studio with the brief pre-filled.

3. **Quick fix** (Dev toggle ON only) — For simple CSS variable swaps or missing ARIA labels, the agent can apply fixes directly using codebase tools. This is gated by dev mode AND user confirmation.

#### 1.6 Dev Toggle Behavior

| Aspect | Dev OFF | Dev ON |
|--------|---------|--------|
| Findings presentation | Plain language only | Plain language + file:line references |
| Code visibility | Hidden | Component code shown |
| Quick fixes | Not offered | Offered with confirmation |
| Build Studio handoff | Always via backlog + brief | Can also apply directly |
| Technical detail | "The button text is hard to read" | "Button at `ComplaintsList.tsx:45` uses `text-white` on `bg-red-500` — contrast ratio 2.8:1, needs 4.5:1" |

### 2. Build Studio UX Standards Integration

Wire the platform usability standards into every phase of the Build Studio pipeline.

#### 2.1 Coding Agent Prompt Enrichment

In `coding-agent.ts`, `buildCodeGenPrompt()` currently provides the feature brief, acceptance criteria, and implementation plan — but zero UX guidance. Add a UX standards block to the prompt:

```
## UX Standards (mandatory)

Follow the platform usability standards (docs/platform-usability-standards.md):

- CSS Variables: Use var(--dpf-text), var(--dpf-muted), var(--dpf-surface-1), var(--dpf-surface-2),
  var(--dpf-bg), var(--dpf-border), var(--dpf-accent) for all colors. NEVER use text-white, text-black,
  bg-white, bg-black, or inline hex values. Exception: text-white on bg-[var(--dpf-accent)] buttons.
- Contrast: Text on backgrounds must meet 4.5:1 ratio. UI components (borders, focus rings) must meet 3:1.
- Semantic HTML: Use <nav>, <main>, <section>, <article>, <aside>, <header>, <footer> — not generic <div>s.
- ARIA: Interactive elements must have accessible names. Buttons need descriptive text (not just "Submit").
  Form inputs need associated <label> elements.
- Keyboard: All interactive elements must be reachable via Tab and activatable via Enter/Space.
  Focus indicators must be visible (2px solid var(--dpf-accent), offset 2px).
- Color: Never use color as the sole means of conveying information. Status indicators need text labels or icons.
- Form elements: Inherit baseline styles from @layer components in globals.css automatically.
```

#### 2.2 Build Phase Prompt Enrichment

In `build-agent-prompts.ts`, expand the Build phase's THEME-AWARE STYLING instruction to include semantic HTML, ARIA, keyboard navigation, and color-not-sole-conveyor rules. The current instruction only covers CSS variables.

#### 2.3 Review Checklist Enrichment

In `build-reviewers.ts`:

**Design review** — add checklist item 8:
```
8. Does the design consider accessibility? (semantic HTML structure, keyboard-navigable
   interactions, ARIA labels for non-text interactive elements, color not the sole conveyor
   of meaning)
```

**Code review** — add checklist items 6-7:
```
6. Does the code use CSS variables (var(--dpf-*)) for all colors — no text-white, bg-white,
   text-black, bg-black, or inline hex values? (Exception: text-white on accent-background buttons,
   semantic status colors from ThemeTokens.states)
7. Are interactive elements keyboard-accessible with visible focus indicators? Do form inputs
   have associated labels? Do buttons have descriptive accessible names?
```

#### 2.4 Playwright Assertion Generation

In `playwright-runner.ts`, replace the empty screenshot skeleton with real assertions. The `generateTestScript()` function currently produces:

```ts
await page.screenshot();
// Full assertions should be generated by the coding agent at runtime
```

Replace with generated assertions that verify:

1. **Accessibility audit** — Run `@axe-core/playwright` via `new AxeBuilder({ page }).analyze()`. Assert zero violations at "critical" and "serious" impact levels. This covers contrast, missing labels, ARIA roles, heading order, and color-only indicators in a single pass.
2. **Focus visibility** — Tab through all focusable elements via `page.keyboard.press('Tab')`, assert each has a visible focus indicator by checking computed `outline` or `box-shadow` styles
3. **CSS variable compliance** — Assert no inline `style` attributes contain hardcoded hex colors for token roles. Check computed colors on text/background elements against known hardcoded defaults.
4. **Acceptance criteria** — Each user-defined acceptance criterion becomes a `test.step()` with the criterion as the assertion description

The generated test runs automatically during the Review phase. Results appear in the Evidence Chain as "UX Acceptance Tests: 12/12 passed" — the user sees pass/fail, not raw test output.

#### 2.5 Phase Gate: UX Tests Required

In `feature-build-types.ts`, update the Review → Ship gate:

```ts
if (from === "review" && to === "ship") {
  // ... existing checks ...
  if (!evidence.uxTestResults)
    return { allowed: false, reason: "UX acceptance tests must be run before shipping." };
  const uxResults = evidence.uxTestResults as { passed: number; failed: number };
  if (uxResults.failed > 0)
    return { allowed: false, reason: `${uxResults.failed} UX test(s) failed. Fix before shipping.` };
  return { allowed: true };
}
```

This makes UX tests a hard gate — no build ships without automated UX verification.

**Backward compatibility:** Existing in-progress builds created before this change will not have `uxTestResults`. The gate checks `if (!evidence.uxTestResults)` — these builds can resolve the gate by running UX tests before shipping (the agent prompts for this). No builds are permanently blocked; they just need the test run added.

**Type safety:** Add `uxTestResults` to the `FeatureBuildRow` TypeScript type in `feature-build-types.ts`:

```ts
uxTestResults: { passed: number; failed: number; steps: UxTestStep[] } | null;
```

Currently this field is accessed via unsafe casting. Adding it to the type ensures compile-time safety for the phase gate check.

### 3. Automated Evidence Chain (Non-Dev User Flow)

The agent produces all regulatory artifacts autonomously. The user's role is intent confirmation and visual validation.

#### 3.1 Ideate Phase — User Describes, Agent Decides

User describes what they want in plain language. The agent:

1. Searches the codebase for related features
2. Writes the design document (problem statement, goals, approach, files affected)
3. Runs its own design review (the 8-item checklist, now including accessibility)
4. Presents a plain-language summary to the user:
   > "Here's what I'll build — a complaints tracking page with status filtering, linked to customer accounts. It'll have accessible forms, keyboard navigation, and meet our contrast standards. Sound right?"
5. User confirms intent. No technical questions asked.

**Dev toggle ON:** Agent also shows the design doc text and asks about data model or approach preferences.

**Evidence produced:** `designDoc` (full spec), `designReview` (pass with 8/8 checklist items).

#### 3.2 Plan Phase — Fully Automated

Agent generates the implementation plan from the design doc, runs its own plan review, and reports:

> "Implementation plan ready — 4 components, 2 database tables, 8 tests."

**Dev toggle ON:** Agent shows the full plan and accepts feedback on task structure.

**Evidence produced:** `buildPlan` (full plan), `planReview` (pass with 5/5 checklist items).

#### 3.3 Build Phase — Sandbox With Live Preview

Agent generates code in the sandbox following TDD. The user sees:

- Live preview iframe updating as components build
- Plain-language progress: "Building the complaints table... adding the status filter... running tests..."

No user action needed. Agent runs verification (tests + typecheck) automatically.

**Evidence produced:** `verificationOut` (test results + typecheck pass).

#### 3.4 Review Phase — Evidence Displayed, Not Interrogated

The Evidence Chain shows all items with pass/fail status:

1. Design Document — complete
2. Design Review — pass (8/8)
3. Implementation Plan — complete
4. Plan Review — pass (5/5)
5. Verification — pass (N tests, typecheck)
6. Acceptance Criteria — pass (N/N met)
7. **UX Acceptance Tests — pass (N/N assertions)**

Agent asks the user to validate visually:
> "Everything passes. Take a look at the preview — does this match what you had in mind?"

The user validates by looking at the rendered result, not by reading code or test output.

**Dev toggle ON:** User can inspect code diffs, review checklists, test output, and UX test details.

#### 3.5 Ship Phase — One Confirmation

> "All checks pass. Ready to ship this to production?"

User confirms. Agent registers the digital product, creates the epic and backlog items, ships to production.

**GRC compliance:** The build evidence chain satisfies the "UX Accessibility — Color & Theme Standards" policy automatically. The automated code review checks CSS variable compliance, the UX tests verify contrast and accessibility, and the evidence is stored in the `FeatureBuild` record. No separate policy acknowledgment step needed — the evidence IS the compliance artifact.

---

## Data Model

**No schema changes required.** All evidence fields already exist on `FeatureBuild` as `Json?` columns in Prisma:

- `designDoc`, `designReview` — already stored as JSON
- `buildPlan`, `planReview` — already stored as JSON
- `verificationOut` — already stored as JSON
- `acceptanceMet` — already stored as JSON array
- `uxTestResults` — already stored as `Json?` in Prisma schema (currently optional, becomes required by phase gate). The `FeatureBuildRow` TypeScript type needs `uxTestResults` added (currently accessed via unsafe casting).

**New dependency:** `@axe-core/playwright` added to `apps/web/package.json` for accessibility auditing.

The `PageEvaluation` and `UxFinding` types are used in-memory by the `evaluate_page` tool — not persisted to the database. Findings that become backlog items use the existing `BacklogItem` model.

## Files Affected

**UX Evaluation Skill (Subsystem 1):**
- Modify: `apps/web/lib/route-context-map.ts` — add "Evaluate this page" universal skill
- Modify: `apps/web/lib/mcp-tools.ts` — add `evaluate_page` tool definition
- Create: `apps/web/lib/page-evaluator.ts` — axe-core + Playwright page evaluation logic (accessibility audit, focus order, CSS compliance, responsive checks). Pure functions for finding aggregation and categorization should be unit-testable separately from Playwright integration.
- Modify: `apps/web/package.json` — add `@axe-core/playwright` dependency

**Build Studio Integration (Subsystem 2) + Automated Evidence Chain (Subsystem 3):**

Note: Subsystems 2 and 3 both modify `build-agent-prompts.ts` — subsystem 2 adds UX standards to the Build phase, subsystem 3 rewrites all phase prompts for autonomous operation. These must be implemented as a single coordinated change to avoid conflicts.

- Modify: `apps/web/lib/coding-agent.ts` — add UX standards block to `buildCodeGenPrompt()`
- Modify: `apps/web/lib/build-agent-prompts.ts` — expand Build phase THEME-AWARE STYLING (semantic HTML, ARIA, keyboard, color-not-sole-conveyor) AND update Ideate, Plan, Review, Ship phase prompts for autonomous plain-language operation with Dev toggle awareness
- Modify: `apps/web/lib/build-reviewers.ts` — add accessibility items to design review (item 8) and code review (items 6-7)
- Modify: `apps/web/lib/playwright-runner.ts` — replace screenshot skeleton with axe-core violations, focus visibility, ARIA completeness, CSS variable assertions
- Modify: `apps/web/lib/feature-build-types.ts` — add `uxTestResults` to `FeatureBuildRow` type, add UX test requirement to Review → Ship phase gate

## Testing Strategy

- **Unit tests:** `validateTokenContrast()` and contrast utilities already tested (235 tests from EP-UX-STANDARDS)
- **Page evaluator tests:** Test `evaluate_page` tool against a known test page with deliberate accessibility violations — assert findings match expected issues
- **Playwright assertion generation tests:** Verify `generateTestScript()` produces runnable assertions that catch contrast violations, missing ARIA labels, and hardcoded colors
- **Phase gate tests:** Verify Review → Ship rejects builds without UX test results, and rejects builds with failed UX tests
- **Review checklist tests:** Verify design review and code review prompts include UX items
- **Integration test:** End-to-end Build Studio run with a simple feature — verify all evidence chain artifacts are produced and UX tests pass

## Demo Story

A non-technical operations manager notices that the customer complaints page is hard to use — status badges blend together and the search field is hard to find. She opens the AI coworker and says "This page is confusing — the statuses all look the same."

The coworker says "Let me evaluate this page." It reads the component code, launches Playwright, and runs an accessibility analysis. It comes back with: "I found 3 issues: (1) Status badges use only color — they need text labels. (2) The search input has no visible focus ring. (3) Two heading levels are skipped (h2 → h5)."

Each finding becomes a backlog item. The coworker asks: "Want me to build fixes for these now?" She says yes. The coworker assembles a feature brief and launches Build Studio.

The Build Studio agent writes a design doc, generates a plan, builds the code in the sandbox with TDD, and runs UX acceptance tests — all automatically. The operations manager sees the live preview update and the Evidence Chain go green. She validates visually: "That looks much better — I can read the statuses now." She ships it.

The build record contains the full evidence chain: design doc, design review (8/8), plan, plan review (5/5), verification (12 tests pass), acceptance criteria (3/3 met), UX tests (8/8 assertions pass). The GRC accessibility policy is satisfied by the automated evidence. No technical questions were asked.
