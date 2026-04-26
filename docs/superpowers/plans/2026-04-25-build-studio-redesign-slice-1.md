# Build Studio Redesign — Slice 1: Shell Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new two-pane conversational Build Studio shell behind a `?v=2` URL parameter, with the package-delivery step tracker, header bar, conversation pane (transcript + composer + bundle's six base cards), and artifact pane scaffolding (tabs + Preview view) — all rendered against in-repo demo data so the redesign can be exercised in the browser end-to-end.

**Architecture:** Build new components under `apps/web/components/build-studio/` (new directory; the existing `components/build/` stays untouched in Slice 1). The new shell mounts at `/build?v=2` via a thin client switch in the existing page; production users still see the old shell at `/build`. Components are presentation-only React clients styled with Tailwind utilities against existing `--dpf-*` CSS variables; no server actions or schema changes in this slice. Data flows from typed fixtures in `lib/build-studio-demo.ts` so the UI is exercisable without touching the agent-event-bus or Inngest queue (those wire up in Slice 2).

**Tech Stack:** Next.js 16 App Router, React 19 client components, TypeScript, Tailwind CSS, shadcn/ui primitives, `lucide-react` icons, Vitest with React Testing Library, jsdom.

---

## Scope Guard

This plan implements **Slice 1** from `docs/superpowers/specs/2026-04-25-build-studio-redesign-design.md`.

**In scope (Slice 1):**

- Adding two missing CSS tokens (`--dpf-accent-soft`, `--dpf-border-strong`).
- New components in `apps/web/components/build-studio/`: `StepTracker`, `HeaderBar`, `ArtifactPane`, `ArtifactTabs`, `PreviewFrame`, `ConversationPane`, `Bubble`, `Composer`, six embedded card variants (`ChoiceCard`, `PlanSummaryCard`, `FilesTouchedCard`, `VerificationStripCard`, `DecisionCard`, `StepRefCard`), `Persona`, `UserMark`.
- Demo fixtures under `apps/web/lib/build-studio-demo.ts` mirroring the bundle's `data.jsx` shape, typed for TypeScript.
- A new `BuildStudioV2` client component that composes the above.
- A `?v=2` switch in `apps/web/app/(shell)/build/page.tsx` that renders `BuildStudioV2` when set; otherwise the existing `BuildStudio` renders unchanged.
- Vitest tests for each component covering render, key interactions, and theme-safe class usage.
- Manual smoke test in `pnpm dev` verifying the redesign lights up at `/build?v=2`.

**Explicitly out of scope (deferred to later slices):**

- **Slice 2** — three refinement card variants by name: `ParallelActivityCard` (live multi-agent surface), `ReviewerPanelCard` (multi-reviewer verdicts inline), `DeliberationCard` (consensus-after-disagreement). Plus persona-voice transformer wiring and real `agentEventBus` consumption.
- **Slice 3** — Walkthrough view (verification screenshots), What-changed view (plain-English schema delta), The-change view (diff drill-in with per-hunk reviewer pills).
- **Slice 4** — Approvals header pill full implementation: cross-build query, popover, approve/reject actions.
- **Slice 5** — Removal of old `/build/approvals` route; removal of legacy components in `apps/web/components/build/` after the new shell is feature-equivalent.

This plan does **not** touch any backend, Prisma schema, server actions, MCP tools, prompts, skills, Inngest functions, or routing logic outside the Build Studio page itself.

---

## Constraints

- The implementer must work on branch `feat/build-studio-redesign` (already created from `origin/main` in worktree `/d/DPF-build-studio-redesign`). Do not branch differently — the spec is already committed there.
- **No file under `apps/web/components/build/` may be modified in this slice.** The legacy shell stays intact; the new shell lands in a new directory and mounts behind `?v=2`. Slice 5 removes the legacy shell.
- All new components must be theme-aware via existing `--dpf-*` CSS variables. No hard-coded hex values.
- Tests run under Vitest with React Testing Library; respect existing project conventions (see `apps/web/components/build/PreviewUrlCard.test.tsx` for an in-repo pattern).
- `pnpm --filter web typecheck` and `pnpm --filter web vitest run apps/web/components/build-studio/` must pass before each commit.
- Production build runs as `cd apps/web && npx next build` per the sibling slice plan's Windows `.next/static/*.tmp` `ENOENT` workaround. Use that form, not `pnpm --filter web build`.
- DCO sign-off (`git commit -s`) is required on every commit. CI blocks merge without it.
- Prefer creating files over modifying when introducing new surface area; minimize collisions with the existing `components/build/` directory.
- Do not import any file from `docs/superpowers/specs/assets/build-studio-redesign/` — those are reference assets only. Implement against the existing shadcn/ui primitives, Tailwind, and `lucide-react`.
- Per CLAUDE.md: do not use `npx prisma` (this plan does not touch Prisma, but the rule is general).
- Manual smoke test in a real browser is required before declaring the slice complete (system prompt: "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete").

---

## Token Mapping (bundle → DPF)

| Bundle token         | DPF token (existing in `globals.css`) | Notes                                               |
| -------------------- | ------------------------------------- | --------------------------------------------------- |
| `--bg`               | `--dpf-bg`                            | Identical hex values, light + dark.                 |
| `--surface-1`        | `--dpf-surface-1`                     | Identical.                                          |
| `--surface-2`        | `--dpf-surface-2`                     | Identical.                                          |
| `--surface-3`        | `--dpf-surface-3`                     | Identical.                                          |
| `--text`             | `--dpf-text`                          | DPF light value `#1a1a2e` ≈ bundle `#14142b`. OK.   |
| `--text-2`           | `--dpf-text-secondary`                | Identical.                                          |
| `--muted`            | `--dpf-muted`                         | Identical.                                          |
| `--accent`           | `--dpf-accent`                        | Identical.                                          |
| `--accent-soft`      | `--dpf-accent-soft` (NEW)             | Add in Task 1.                                      |
| `--border`           | `--dpf-border`                        | DPF light value `#d4d4dc` ≈ bundle `#e2e2e8`. OK.   |
| `--border-strong`    | `--dpf-border-strong` (NEW)           | Add in Task 1.                                      |
| `--success`          | `--dpf-success`                       | Identical.                                          |
| `--warning`          | `--dpf-warning`                       | Identical.                                          |
| `--error`            | `--dpf-error`                         | Identical.                                          |
| `--info`             | `--dpf-info`                          | Identical.                                          |
| `--font-mono`        | font-mono Tailwind utility            | Use `font-mono` Tailwind class (already configured).|

For Tailwind in this slice, use arbitrary-value syntax against the variables (matching the existing pattern in `BuildActivityLog.tsx`): e.g. `bg-[var(--dpf-surface-1)]`, `text-[var(--dpf-text)]`, `border-[var(--dpf-border)]`.

---

## File Structure

### New files

- `apps/web/components/build-studio/BuildStudioV2.tsx`
  - Top-level client shell composing header, step tracker, conversation pane, and artifact pane.
- `apps/web/components/build-studio/StepTracker.tsx`
  - Five-step horizontal package-delivery tracker.
- `apps/web/components/build-studio/StepTracker.test.tsx`
  - Render + state coverage.
- `apps/web/components/build-studio/HeaderBar.tsx`
  - Build title, branch chip, approvals pill stub, theme toggle, primary action.
- `apps/web/components/build-studio/HeaderBar.test.tsx`
  - Render + theme toggle interaction coverage.
- `apps/web/components/build-studio/ArtifactPane.tsx`
  - Tabbed artifact host.
- `apps/web/components/build-studio/ArtifactTabs.tsx`
  - Segmented control (Preview / Walkthrough / What changed / The change).
- `apps/web/components/build-studio/ArtifactTabs.test.tsx`
  - Tab selection coverage.
- `apps/web/components/build-studio/PreviewFrame.tsx`
  - Sandbox URL display + iframe placeholder card.
- `apps/web/components/build-studio/PreviewFrame.test.tsx`
  - Render coverage with present and absent sandbox URL.
- `apps/web/components/build-studio/ConversationPane.tsx`
  - Vertical flex container of bubbles + composer.
- `apps/web/components/build-studio/Bubble.tsx`
  - One transcript turn — assistant or user.
- `apps/web/components/build-studio/Bubble.test.tsx`
  - Render coverage for both roles + needsAction wash + slide-up class.
- `apps/web/components/build-studio/Composer.tsx`
  - Auto-resizing textarea + Send / Suggest / Pause buttons.
- `apps/web/components/build-studio/Composer.test.tsx`
  - Submit-on-Cmd+Enter, Send-disabled-when-empty.
- `apps/web/components/build-studio/cards/ChoiceCard.tsx`
- `apps/web/components/build-studio/cards/ChoiceCard.test.tsx`
- `apps/web/components/build-studio/cards/PlanSummaryCard.tsx`
- `apps/web/components/build-studio/cards/PlanSummaryCard.test.tsx`
- `apps/web/components/build-studio/cards/FilesTouchedCard.tsx`
- `apps/web/components/build-studio/cards/FilesTouchedCard.test.tsx`
- `apps/web/components/build-studio/cards/VerificationStripCard.tsx`
- `apps/web/components/build-studio/cards/VerificationStripCard.test.tsx`
- `apps/web/components/build-studio/cards/DecisionCard.tsx`
- `apps/web/components/build-studio/cards/DecisionCard.test.tsx`
- `apps/web/components/build-studio/cards/StepRefCard.tsx`
- `apps/web/components/build-studio/cards/StepRefCard.test.tsx`
- `apps/web/components/build-studio/avatars/Persona.tsx`
- `apps/web/components/build-studio/avatars/UserMark.tsx`
- `apps/web/components/build-studio/types.ts`
  - Shared TypeScript types for `Step`, `Message`, `MessageCard`, `Choice`, `FileTouched`, `StoryStep`, `PendingApproval`, `Risk`.
- `apps/web/lib/build-studio-demo.ts`
  - Typed demo fixtures matching the bundle's `data.jsx` content. Single export per fixture.

### Modified files

- `apps/web/app/globals.css`
  - Add `--dpf-accent-soft` and `--dpf-border-strong` tokens for both light and dark modes.
- `apps/web/app/(shell)/build/page.tsx`
  - Detect `?v=2` URL parameter; when set, render `BuildStudioV2` instead of legacy `BuildStudio`. No other behavioral change.

---

## Demo Data Strategy

Slice 1 uses static, typed demo fixtures so the shell is exercisable before any backend wiring lands. The fixtures mirror the bundle's `data.jsx` content, one for one. Slice 2 replaces these consumers with live data from the agent-event-bus.

The fixtures live in a single file (`apps/web/lib/build-studio-demo.ts`) and export named values that map to the bundle:

| Bundle export        | Fixture export             |
| -------------------- | -------------------------- |
| `BUILD`              | `DEMO_BUILD`               |
| `STEPS`              | `DEMO_STEPS`               |
| `CONVERSATION`       | `DEMO_CONVERSATION`        |
| `FILES_TOUCHED`      | `DEMO_FILES_TOUCHED`       |
| `STORY_STEPS`        | `DEMO_STORY_STEPS`         |
| `SCHEMA_PLAIN`       | `DEMO_SCHEMA_PLAIN`        |
| `ACCEPTANCE`         | `DEMO_ACCEPTANCE`          |
| `PENDING_APPROVALS`  | `DEMO_PENDING_APPROVALS`   |
| `RISK`               | `DEMO_RISK`                |

Demo fixtures are runtime constants — no DB access — and stay in source until Slice 2 deletes them.

---

## Tasks

Each task follows the TDD/commit cadence. After each `git commit -s -m "..."` step, do not proceed to the next task until the commit succeeds and the working tree is clean.

### Task 1: Add missing design tokens

**Files:**

- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Locate the existing `--dpf-*` token block**

```bash
grep -n "dpf-bg" /d/DPF-build-studio-redesign/apps/web/app/globals.css
```

This returns the line numbers for both light (top) and dark (bottom) declarations.

- [ ] **Step 2: Add the two new tokens to the light declaration**

In `apps/web/app/globals.css`, find the `:root` block containing `--dpf-bg: #fafafa;` and add immediately after `--dpf-accent: #2563eb;`:

```css
  --dpf-accent-soft: color-mix(in srgb, var(--dpf-accent) 12%, var(--dpf-surface-1));
```

And immediately after `--dpf-border: #d4d4dc;`:

```css
  --dpf-border-strong: #c8c8d4;
```

- [ ] **Step 3: Add the two new tokens to the dark declaration**

In the same file, find the dark block (`@media (prefers-color-scheme: dark)` or `[data-theme="dark"]`, whichever the file uses) and add after `--dpf-accent: #7c8cf8;`:

```css
    --dpf-accent-soft: color-mix(in srgb, var(--dpf-accent) 18%, var(--dpf-surface-1));
```

And after `--dpf-border: #2a2a40;`:

```css
    --dpf-border-strong: #3a3a55;
```

- [ ] **Step 4: Run typecheck (CSS-only change shouldn't fail anything, but confirm)**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/app/globals.css
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): add accent-soft and border-strong tokens"
```

---

### Task 2: Define shared TypeScript types

**Files:**

- Create: `apps/web/components/build-studio/types.ts`

- [ ] **Step 1: Create the types file**

Create `apps/web/components/build-studio/types.ts` with the following exports:

```ts
export type StepState = "done" | "active" | "waiting" | "queued" | "failed";

export interface Step {
  id: "ideate" | "plan" | "build" | "review" | "ship";
  label: string;
  verb: string;
  state: StepState;
  when: string;
  progress?: number;
  total?: number;
}

// Card kinds that render INSIDE a Message bubble via `msg.cards[]`.
// NOTE: Choice cards do NOT appear here — they flow through `Message.choices`,
// not `Message.cards`. See the `Choice` type below.
export type CardKind =
  | "step-ref"
  | "plan-summary"
  | "files-touched"
  | "verification-strip"
  | "callout-decision";

export interface MessageCard {
  kind: CardKind;
  refStep?: Step["id"]; // populated when kind === "step-ref"
}

export interface Choice {
  id: string;
  label: string;
  picked: string;
  options: string[];
}

export interface Message {
  role: "user" | "assistant";
  time: string;
  text: string;
  needsAction?: boolean;
  choices?: Choice[];
  cards?: MessageCard[];
}

export type FileTouchedKind = "new" | "modified" | "deleted";

export interface FileTouched {
  name: string;
  detail: string;
  kind: FileTouchedKind;
}

export type StoryStepResult = "passed" | "running" | "failed" | "queued";

export interface StoryStep {
  idx: number;
  title: string;
  result: StoryStepResult;
  caption: string;
}

export interface SchemaChange {
  verb: string;
  what: string;
  detail: string;
}

export interface SchemaRisk {
  level: "low" | "medium" | "high";
  text: string;
}

export interface SchemaPlain {
  area: string;
  changes: SchemaChange[];
  risks: SchemaRisk[];
}

export interface Acceptance {
  id: string;
  text: string;
  met: boolean;
  note?: string;
}

export type RiskBand = "low" | "medium" | "high";

export interface PendingApproval {
  id: string;
  title: string;
  step: string;
  risk: RiskBand;
  age: string;
  current?: boolean;
}

export interface BuildSummary {
  title: string;
  subtitle: string;
  requestedBy: string;
  requestedAt: string;
  branch: string;
  buildId: string;
}

export type ArtifactView = "preview" | "verification" | "schema" | "diff";
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/types.ts
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): shared TypeScript types"
```

---

### Task 3: Demo data fixtures

**Files:**

- Create: `apps/web/lib/build-studio-demo.ts`

- [ ] **Step 1: Create the fixtures file**

Create `apps/web/lib/build-studio-demo.ts`. Translate every const from the bundle's `docs/superpowers/specs/assets/build-studio-redesign/design/data.jsx` (BUILD, STEPS, CONVERSATION, FILES_TOUCHED, STORY_STEPS, SCHEMA_PLAIN, ACCEPTANCE, PENDING_APPROVALS) into typed exports. Skip the `Icon`, `Persona`, `UserMark`, and `RISK` exports — those become components in later tasks. Keep wording verbatim from the bundle (the copy is intentional).

Schema:

```ts
import type {
  Acceptance,
  BuildSummary,
  FileTouched,
  Message,
  PendingApproval,
  SchemaPlain,
  Step,
  StoryStep,
} from "@/components/build-studio/types";

export const DEMO_BUILD: BuildSummary = { /* from BUILD in data.jsx */ };

export const DEMO_STEPS: Step[] = [ /* from STEPS in data.jsx */ ];

export const DEMO_CONVERSATION: Message[] = [ /* from CONVERSATION in data.jsx */ ];

export const DEMO_FILES_TOUCHED: FileTouched[] = [ /* from FILES_TOUCHED in data.jsx */ ];

export const DEMO_STORY_STEPS: StoryStep[] = [ /* from STORY_STEPS in data.jsx */ ];

export const DEMO_SCHEMA_PLAIN: SchemaPlain = { /* from SCHEMA_PLAIN in data.jsx */ };

export const DEMO_ACCEPTANCE: Acceptance[] = [ /* from ACCEPTANCE in data.jsx */ ];

export const DEMO_PENDING_APPROVALS: PendingApproval[] = [ /* from PENDING_APPROVALS in data.jsx */ ];
```

The implementer copies each value verbatim from `data.jsx`, adjusting only:
- JS object → TS const with type annotation.
- `picked: "60 seconds"` etc. — preserve exactly.
- `needsAction: true` — preserve.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter web typecheck
```

Expected: PASS — every type narrows correctly.

- [ ] **Step 3: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/lib/build-studio-demo.ts
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): demo data fixtures"
```

---

### Task 4: StepTracker component

**Files:**

- Create: `apps/web/components/build-studio/StepTracker.tsx`
- Create: `apps/web/components/build-studio/StepTracker.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/components/build-studio/StepTracker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepTracker } from "./StepTracker";
import { DEMO_STEPS } from "@/lib/build-studio-demo";

describe("StepTracker", () => {
  it("renders all five steps with their package-delivery labels", () => {
    render(<StepTracker steps={DEMO_STEPS} />);
    expect(screen.getByText("Understanding")).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Handover")).toBeInTheDocument();
  });

  it("shows progress fragment for the active step", () => {
    render(<StepTracker steps={DEMO_STEPS} />);
    expect(screen.getByText(/4 of 6/)).toBeInTheDocument();
  });

  it("renders the verb line in plain English (no jargon)", () => {
    render(<StepTracker steps={DEMO_STEPS} />);
    expect(screen.getByText(/We figured out what you want/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web vitest run apps/web/components/build-studio/StepTracker.test.tsx
```

Expected: FAIL — `StepTracker` does not exist yet.

- [ ] **Step 3: Implement StepTracker**

Create `apps/web/components/build-studio/StepTracker.tsx` as a client component matching the bundle's `step-tracker.jsx`. Translate inline `style={{...}}` to Tailwind utility classes plus `[var(--dpf-*)]` references. Use `lucide-react` `Check` icon for the done state. Include the active-step pulse ring as a Tailwind animation utility (`animate-pulse` is acceptable; otherwise add a small keyframe).

Reference: `docs/superpowers/specs/assets/build-studio-redesign/design/step-tracker.jsx`. Do not import that file; rebuild against shadcn primitives + Tailwind.

Component signature:

```tsx
"use client";
import type { Step } from "./types";

export function StepTracker({ steps }: { steps: Step[] }) {
  // Render the horizontal pill train. Each step:
  //   - 24×24 status circle with state-specific background and border
  //   - Done: filled with --dpf-success + check icon
  //   - Active: filled with --dpf-accent + index number + pulse ring
  //   - Waiting: amber-tinted background + index number
  //   - Queued: surface-1 + index in muted color
  //   - Label (13px, semibold) + verb line (11.5px, muted)
  //   - Connector line between steps: success-colored if previous step done, else border
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter web vitest run apps/web/components/build-studio/StepTracker.test.tsx
```

Expected: PASS, all three tests green.

- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/StepTracker.tsx apps/web/components/build-studio/StepTracker.test.tsx
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): StepTracker with package-delivery labels"
```

---

### Task 5: Persona and UserMark avatars

**Files:**

- Create: `apps/web/components/build-studio/avatars/Persona.tsx`
- Create: `apps/web/components/build-studio/avatars/UserMark.tsx`

These are pure presentation; tests roll up into the Bubble test.

- [ ] **Step 1: Implement `Persona`**

```tsx
"use client";

export function Persona({ size = 28 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className="grid place-items-center rounded-full font-bold text-[var(--dpf-bg)] shrink-0"
    >
      <span
        className="grid place-items-center rounded-full"
        style={{
          width: size,
          height: size,
          background:
            "linear-gradient(135deg, var(--dpf-accent) 0%, color-mix(in srgb, var(--dpf-accent) 60%, var(--dpf-text)) 100%)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.4) inset, 0 4px 10px color-mix(in srgb, var(--dpf-accent) 30%, transparent)",
        }}
      >
        D
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Implement `UserMark`**

```tsx
"use client";

export function UserMark({ size = 28, name = "Maya" }: { size?: number; name?: string }) {
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className="grid place-items-center rounded-full bg-[var(--dpf-surface-3)] text-[var(--dpf-text)] border border-[var(--dpf-border)] font-semibold shrink-0"
    >
      {name[0]}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/avatars/
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): Persona and UserMark avatars"
```

---

### Task 6: HeaderBar component

**Files:**

- Create: `apps/web/components/build-studio/HeaderBar.tsx`
- Create: `apps/web/components/build-studio/HeaderBar.test.tsx`

Approvals pill in this slice is a **stub**: it renders the right copy and accent but its onClick is a no-op. The popover lands in Slice 4.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeaderBar } from "./HeaderBar";
import { DEMO_BUILD } from "@/lib/build-studio-demo";

describe("HeaderBar", () => {
  it("renders build title, branch chip, and approvals pill", () => {
    render(<HeaderBar build={DEMO_BUILD} pendingApprovalCount={1} otherBuildApprovalCount={2} theme="dark" onToggleTheme={() => {}} />);
    expect(screen.getByText(DEMO_BUILD.title)).toBeInTheDocument();
    expect(screen.getByText(DEMO_BUILD.branch)).toBeInTheDocument();
    expect(screen.getByText(/1 thing waiting on you/)).toBeInTheDocument();
    expect(screen.getByText(/2 more across builds/)).toBeInTheDocument();
  });

  it("invokes onToggleTheme when theme button is clicked", () => {
    const onToggle = vi.fn();
    render(<HeaderBar build={DEMO_BUILD} pendingApprovalCount={0} otherBuildApprovalCount={0} theme="dark" onToggleTheme={onToggle} />);
    fireEvent.click(screen.getByLabelText(/toggle theme/i));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("hides approvals pill when there are zero pending approvals anywhere", () => {
    render(<HeaderBar build={DEMO_BUILD} pendingApprovalCount={0} otherBuildApprovalCount={0} theme="dark" onToggleTheme={() => {}} />);
    expect(screen.queryByText(/waiting on you/)).not.toBeInTheDocument();
  });

  it("pluralizes the approvals copy when the count is greater than one", () => {
    render(<HeaderBar build={DEMO_BUILD} pendingApprovalCount={2} otherBuildApprovalCount={0} theme="dark" onToggleTheme={() => {}} />);
    expect(screen.getByText(/2 things waiting on you/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
pnpm --filter web vitest run apps/web/components/build-studio/HeaderBar.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement HeaderBar**

Create `apps/web/components/build-studio/HeaderBar.tsx` with the signature:

```tsx
"use client";
import { Sun, Moon, Pause, AlertTriangle } from "lucide-react";
import type { BuildSummary } from "./types";

interface Props {
  build: BuildSummary;
  pendingApprovalCount: number;
  otherBuildApprovalCount: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function HeaderBar({ build, pendingApprovalCount, otherBuildApprovalCount, theme, onToggleTheme }: Props) {
  // 56px tall row. flex items-center, gap-3.5, padding 12px / 22px.
  // bg-[var(--dpf-surface-1)] border-b border-[var(--dpf-border)]
  // Left: 28px DPF mark (rounded-lg, bg-[var(--dpf-text)], text-[var(--dpf-bg)])
  //       label "Build Studio" (11px, semibold, muted)
  // Vertical divider 22px tall.
  // Title block: build.title (14.5px, font-bold, tracking-tight) + branch chip (mono, 11.5px,
  //   px-2 py-px bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md)
  //   + subline "Requested by {build.requestedBy} · {build.requestedAt}" (12px, muted)
  // Spacer.
  // Approvals pill (only when pendingApprovalCount > 0 || otherBuildApprovalCount > 0):
  //   amber tint, AlertTriangle icon in 18px circle.
  //   "{pendingApprovalCount} thing waiting on you" (or "things" pluralized)
  //   if otherBuildApprovalCount > 0: " · {otherBuildApprovalCount} more across builds"
  //   button with aria-label "Pending approvals", onClick is a no-op stub for Slice 1.
  // Theme toggle: ghost button with Sun (when dark) or Moon (when light), aria-label "Toggle theme".
  // Pause button: ghost icon-only, Pause icon.
  // Approve & ship: primary accent button, label "Approve & ship".
}
```

Visual fidelity reference: `docs/superpowers/specs/assets/build-studio-redesign/design/header.jsx`.

- [ ] **Step 4: Run test, verify pass**

```bash
pnpm --filter web vitest run apps/web/components/build-studio/HeaderBar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/HeaderBar.tsx apps/web/components/build-studio/HeaderBar.test.tsx
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): HeaderBar with stub approvals pill"
```

---

### Task 7: ArtifactTabs segmented control

**Files:**

- Create: `apps/web/components/build-studio/ArtifactTabs.tsx`
- Create: `apps/web/components/build-studio/ArtifactTabs.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactTabs } from "./ArtifactTabs";

describe("ArtifactTabs", () => {
  it("renders all four tab labels", () => {
    render(<ArtifactTabs value="preview" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /preview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /walkthrough/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /what changed/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /the change/i })).toBeInTheDocument();
  });

  it("invokes onChange with the right view id when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<ArtifactTabs value="preview" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /walkthrough/i }));
    expect(onChange).toHaveBeenCalledWith("verification");
  });

  it("marks the selected tab with aria-pressed true", () => {
    render(<ArtifactTabs value="schema" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /what changed/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /preview/i })).toHaveAttribute("aria-pressed", "false");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement ArtifactTabs**

```tsx
"use client";
import { Play, Image as ImageIcon, Table, ChevronRight } from "lucide-react";
import type { ArtifactView } from "./types";

interface Tab { id: ArtifactView; label: string; Icon: typeof Play }

const TABS: Tab[] = [
  { id: "preview",      label: "Preview",      Icon: Play },
  { id: "verification", label: "Walkthrough",  Icon: ImageIcon },
  { id: "schema",       label: "What changed", Icon: Table },
  { id: "diff",         label: "The change",   Icon: ChevronRight },
];

interface Props { value: ArtifactView; onChange: (v: ArtifactView) => void; }

export function ArtifactTabs({ value, onChange }: Props) {
  // Inline-flex segmented control: gap 0.5, padding 3px,
  //   bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-[10px].
  // Each tab button: px-2.5 py-1.5, gap 1.5, text-[12.5px], rounded-lg.
  // Selected: bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] font-semibold aria-pressed=true.
  // Unselected: bg-transparent border-transparent text-[var(--dpf-text-secondary)] font-medium aria-pressed=false.
  return (
    <div className="inline-flex gap-0.5 p-[3px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-[10px]" role="tablist">
      {TABS.map(({ id, label, Icon }) => {
        const sel = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={sel}
            onClick={() => onChange(id)}
            className={[
              "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] rounded-lg transition-colors",
              sel
                ? "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] font-semibold"
                : "border border-transparent text-[var(--dpf-text-secondary)] font-medium",
            ].join(" ")}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/ArtifactTabs.tsx apps/web/components/build-studio/ArtifactTabs.test.tsx
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): ArtifactTabs segmented control"
```

---

### Task 8: PreviewFrame

**Files:**

- Create: `apps/web/components/build-studio/PreviewFrame.tsx`
- Create: `apps/web/components/build-studio/PreviewFrame.test.tsx`

Slice 1 just renders a URL bar + a placeholder card with the bundle's mocked Settings/API Keys layout. Wiring to the real sandbox iframe is in Slice 2.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewFrame } from "./PreviewFrame";

describe("PreviewFrame", () => {
  it("renders the sandbox URL when provided", () => {
    render(<PreviewFrame sandboxUrl="sandbox.dpf.local/settings/api-keys" />);
    expect(screen.getByText(/sandbox.dpf.local/)).toBeInTheDocument();
    expect(screen.getByText(/live/i)).toBeInTheDocument();
  });

  it("renders the three mock API key rows from the bundle reference", () => {
    render(<PreviewFrame sandboxUrl="sandbox.dpf.local/settings/api-keys" />);
    expect(screen.getAllByTestId("preview-key-row")).toHaveLength(3);
    // The third row in the bundle is the rotated-out key in its grace window.
    expect(screen.getByText(/grace window/i)).toBeInTheDocument();
  });

  it("renders an empty state when no sandbox URL is supplied", () => {
    render(<PreviewFrame sandboxUrl={null} />);
    expect(screen.getByText(/no sandbox running yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement PreviewFrame**

```tsx
"use client";

interface Props { sandboxUrl: string | null }

export function PreviewFrame({ sandboxUrl }: Props) {
  if (!sandboxUrl) {
    return (
      <div className="h-full grid place-items-center p-6 text-[var(--dpf-text-secondary)] text-sm">
        No sandbox running yet — preview lights up once Building reaches the Checking phase.
      </div>
    );
  }
  // URL bar: mono 12px, padding 7×12, bg-[var(--dpf-surface-1)] border-[var(--dpf-border)] rounded-[10px].
  // "live" pulse chip on the right (success-tinted).
  // Inset card with mocked Settings → API Keys page. Render THREE key rows
  // (Production / CI-build / Old read-only key in grace window). Each row
  // carries `data-testid="preview-key-row"` so the row-count test can assert
  // structure without coupling to row text. The grace-window row uses the
  // amber pulsing chip pattern from the bundle. Visual reference:
  // assets/build-studio-redesign/design/artifact.jsx PreviewFrame.
  // Slice 2 replaces this static mock with `<iframe src={sandboxUrl} />`.
  return (
    <div className="h-full flex flex-col p-[22px] gap-3">
      <div className="flex items-center gap-2.5">
        <div className="flex-1 font-mono text-xs text-[var(--dpf-text-secondary)] py-1.5 px-3 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-[10px]">
          {sandboxUrl}
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-success)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--dpf-success)] animate-pulse" />
          live
        </span>
      </div>
      <div className="flex-1 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-[14px] overflow-hidden flex flex-col">
        {/* Mock Settings/API Keys content — see assets/.../artifact.jsx PreviewFrame for the
            three-row key list with grace-window state. Implementer copies the layout 1:1. */}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/PreviewFrame.tsx apps/web/components/build-studio/PreviewFrame.test.tsx
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): PreviewFrame with URL bar and mock canvas"
```

---

### Task 9: ArtifactPane host

**Files:**

- Create: `apps/web/components/build-studio/ArtifactPane.tsx`

ArtifactPane composes ArtifactTabs + the active view. Walkthrough / Schema / Diff views are stubs in Slice 1 — they render "Coming in Slice 3" placeholders so the tabs are clickable.

- [ ] **Step 1: Implement ArtifactPane**

```tsx
"use client";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { ArtifactTabs } from "./ArtifactTabs";
import { PreviewFrame } from "./PreviewFrame";
import type { ArtifactView } from "./types";

interface Props {
  view: ArtifactView;
  onViewChange: (v: ArtifactView) => void;
  sandboxUrl: string | null;
}

function StubView({ slice, name }: { slice: number; name: string }) {
  return (
    <div className="h-full grid place-items-center p-6 text-center text-[var(--dpf-text-secondary)] text-sm">
      <div>
        <div className="font-semibold text-[var(--dpf-text)] mb-1">{name}</div>
        Coming in Slice {slice}.
      </div>
    </div>
  );
}

export function ArtifactPane({ view, onViewChange, sandboxUrl }: Props) {
  return (
    <div className="flex flex-col h-full bg-[var(--dpf-surface-2)] border-l border-[var(--dpf-border)]">
      <div className="px-[22px] py-3 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] flex items-center gap-2.5">
        <ArtifactTabs value={view} onChange={onViewChange} />
        <span className="flex-1" />
        <button type="button" aria-label="More" className="p-1.5 rounded-lg text-[var(--dpf-text-secondary)] hover:bg-[var(--dpf-surface-2)]">
          <MoreHorizontal size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === "preview"      && <PreviewFrame sandboxUrl={sandboxUrl} />}
        {view === "verification" && <StubView slice={3} name="Walkthrough" />}
        {view === "schema"       && <StubView slice={3} name="What changed" />}
        {view === "diff"         && <StubView slice={3} name="The change" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**
- [ ] **Step 3: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/ArtifactPane.tsx
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): ArtifactPane with Preview live and other tabs stubbed"
```

---

### Task 10: ChoiceCard

**Files:**

- Create: `apps/web/components/build-studio/cards/ChoiceCard.tsx`
- Create: `apps/web/components/build-studio/cards/ChoiceCard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChoiceCard } from "./ChoiceCard";

const choice = {
  id: "grace",
  label: "Grace window for the old key",
  picked: "60 seconds",
  options: ["No grace — instant cut-off", "60 seconds", "5 minutes", "Custom…"],
};

describe("ChoiceCard", () => {
  it("renders the label and all options", () => {
    render(<ChoiceCard choice={choice} />);
    expect(screen.getByText(choice.label)).toBeInTheDocument();
    for (const o of choice.options) expect(screen.getByText(o)).toBeInTheDocument();
  });

  it("highlights the picked option with aria-pressed=true", () => {
    render(<ChoiceCard choice={choice} />);
    expect(screen.getByRole("button", { name: "60 seconds" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "5 minutes" })).toHaveAttribute("aria-pressed", "false");
  });

  it("changes selection on click", () => {
    render(<ChoiceCard choice={choice} />);
    fireEvent.click(screen.getByRole("button", { name: "5 minutes" }));
    expect(screen.getByRole("button", { name: "5 minutes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "60 seconds" })).toHaveAttribute("aria-pressed", "false");
  });
});
```

- [ ] **Step 2: Run, verify fail**
- [ ] **Step 3: Implement**

```tsx
"use client";
import { useState } from "react";
import type { Choice } from "../types";

export function ChoiceCard({ choice }: { choice: Choice }) {
  const [picked, setPicked] = useState(choice.picked);
  return (
    <div className="mt-2 p-3 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-xl">
      <div className="text-[13px] font-semibold text-[var(--dpf-text)] mb-2">{choice.label}</div>
      <div className="flex flex-wrap gap-1.5">
        {choice.options.map((o) => {
          const sel = picked === o;
          return (
            <button
              key={o}
              type="button"
              aria-pressed={sel}
              onClick={() => setPicked(o)}
              className={[
                "px-3 py-1.5 text-[12.5px] rounded-full transition-colors border",
                sel
                  ? "bg-[var(--dpf-text)] text-[var(--dpf-bg)] border-[var(--dpf-text)] font-semibold"
                  : "bg-[var(--dpf-surface-1)] text-[var(--dpf-text-secondary)] border-[var(--dpf-border)] font-medium",
              ].join(" ")}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/cards/ChoiceCard.tsx apps/web/components/build-studio/cards/ChoiceCard.test.tsx
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): ChoiceCard with single-select pills"
```

---

### Task 11: PlanSummaryCard

**Files:**

- Create: `apps/web/components/build-studio/cards/PlanSummaryCard.tsx`
- Create: `apps/web/components/build-studio/cards/PlanSummaryCard.test.tsx`

- [ ] **Step 1: Failing test** — assert all five plan items render and the "See the technical plan" footer button is present.
- [ ] **Step 2: Run, fail**
- [ ] **Step 3: Implement**

Plan items in Slice 1 are hard-coded from the bundle:

```ts
const PLAN_ITEMS = [
  "Add a way to expire & revoke keys safely",
  "Build the rotate action with a 60-second grace window",
  "Add tests covering the happy path and edge cases",
  "Wire it into the Settings → API Keys screen",
  "Record every rotation in the audit log",
];
```

In Slice 2 these come from a prop. Slice 1 keeps them inline.

Card shell: `bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-xl p-3.5`.
Header: small uppercase eyebrow "The plan".
Items: numbered circles (18×18, surface-3) + text.
Footer: outline button "See the technical plan" with `ChevronRight` icon. Button accepts `onDrill` prop.

- [ ] **Step 4: Run, pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/components/build-studio/cards/PlanSummaryCard.tsx apps/web/components/build-studio/cards/PlanSummaryCard.test.tsx
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): PlanSummaryCard"
```

---

### Task 12: FilesTouchedCard

**Files:**

- Create: `apps/web/components/build-studio/cards/FilesTouchedCard.tsx`
- Create: `apps/web/components/build-studio/cards/FilesTouchedCard.test.tsx`

- [ ] **Step 1: Failing test** — render, assert one row per file, assert `new` and `modified` badges appear.
- [ ] **Step 2: Run, fail**
- [ ] **Step 3: Implement** — props `{ files: FileTouched[]; onDrill: () => void }`. Render header "What I touched · {N} files", then rows with kind chip + name + detail. Kind chip color: success for `new`, warning for `modified`. Footer button "See the diff" calls `onDrill`.
- [ ] **Step 4: Run, pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): FilesTouchedCard"
```

---

### Task 13: VerificationStripCard

**Files:**

- Create: `apps/web/components/build-studio/cards/VerificationStripCard.tsx`
- Create: `apps/web/components/build-studio/cards/VerificationStripCard.test.tsx`

- [ ] **Step 1: Failing test** — assert "4 of 6 working" pill renders (counts derived from the steps prop), assert six step cells render, assert a `data-status` attribute on each cell matches the result.
- [ ] **Step 2: Run, fail**
- [ ] **Step 3: Implement** — props `{ steps: StoryStep[]; onDrill: () => void }`. Header eyebrow "Walking through the feature" + count pill on the right. 6-up grid (`grid-cols-6 gap-1.5`). Each cell aspect 1.4/1, surface-3 background, border colored by status, step number top-left. Running cells show shimmer overlay (use Tailwind `animate-pulse` with low opacity OR add a small custom shimmer keyframe in `globals.css` if needed). Passed cells overlay a Check icon at low opacity.
- [ ] **Step 4: Run, pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): VerificationStripCard"
```

---

### Task 14: DecisionCard

**Files:**

- Create: `apps/web/components/build-studio/cards/DecisionCard.tsx`
- Create: `apps/web/components/build-studio/cards/DecisionCard.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it("renders the warning eyebrow, body, and three actions", () => {
  const onApprove = vi.fn(), onReject = vi.fn(), onDrill = vi.fn();
  render(<DecisionCard body="OK to ship?" onApprove={onApprove} onRequestChanges={onReject} onDrill={onDrill} />);
  expect(screen.getByText(/needs your eye/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /approve & ship/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /approve & ship/i }));
  expect(onApprove).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, fail**
- [ ] **Step 3: Implement** — amber wash background (`bg-[color-mix(in_srgb,var(--dpf-warning)_10%,var(--dpf-surface-1))]`) + amber-tinted border, AlertTriangle icon, "NEEDS YOUR EYE" eyebrow, body prop, three buttons: primary "Approve & ship", outline "Request changes", ghost "See the change".
- [ ] **Step 4: Run, pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): DecisionCard"
```

---

### Task 15: StepRefCard

**Files:**

- Create: `apps/web/components/build-studio/cards/StepRefCard.tsx`
- Create: `apps/web/components/build-studio/cards/StepRefCard.test.tsx`

- [ ] **Step 1: Failing test** — assert "Started Planning" renders when `stepId="plan"` and the corresponding STEPS entry is found.
- [ ] **Step 2: Run, fail**
- [ ] **Step 3: Implement** — small pill with Package icon + "Started" muted prefix + step label. Takes `{ steps: Step[]; stepId: Step["id"] }` and looks up the label.
- [ ] **Step 4: Run, pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): StepRefCard"
```

---

### Task 16: Bubble (with avatar + slide-up animation)

**Files:**

- Create: `apps/web/components/build-studio/Bubble.tsx`
- Create: `apps/web/components/build-studio/Bubble.test.tsx`
- Modify: `apps/web/app/globals.css` (add `slide-up` keyframe + utility class)

- [ ] **Step 1: Add slide-up keyframe to globals.css**

Append:

```css
@keyframes dpf-slide-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.dpf-slide-up { animation: dpf-slide-up 320ms ease-out; }
```

- [ ] **Step 2: Failing test for Bubble**

```tsx
it("renders assistant role with persona and 'your build assistant' caption", () => {
  render(<Bubble msg={{ role: "assistant", time: "9:18am", text: "hi" }} steps={[]} onOpenArtifact={() => {}} />);
  expect(screen.getByText("DPF")).toBeInTheDocument();
  expect(screen.getByText(/your build assistant/i)).toBeInTheDocument();
  expect(screen.getByText("9:18am")).toBeInTheDocument();
  expect(screen.getByText("hi")).toBeInTheDocument();
});

it("renders user role with first-letter avatar and no assistant caption", () => {
  render(<Bubble msg={{ role: "user", time: "9:14am", text: "ship it" }} steps={[]} onOpenArtifact={() => {}} userName="Maya" />);
  expect(screen.queryByText(/build assistant/i)).not.toBeInTheDocument();
  expect(screen.getByText("Maya")).toBeInTheDocument();
});

it("flags needs-action via data attribute when msg.needsAction is true", () => {
  const { container } = render(<Bubble msg={{ role: "assistant", time: "now", text: "x", needsAction: true }} steps={[]} onOpenArtifact={() => {}} />);
  expect(container.firstChild).toHaveAttribute("data-needs-action", "true");
});

it("does NOT flag needs-action when msg.needsAction is absent", () => {
  const { container } = render(<Bubble msg={{ role: "assistant", time: "now", text: "x" }} steps={[]} onOpenArtifact={() => {}} />);
  expect(container.firstChild).not.toHaveAttribute("data-needs-action", "true");
});
```

- [ ] **Step 3: Run, fail**
- [ ] **Step 4: Implement Bubble**

Render avatar (Persona vs UserMark), name + optional caption + timestamp, body text, then iterate `msg.choices` and `msg.cards` calling the matching card components. `onOpenArtifact: (view: ArtifactView) => void` is passed to VerificationStripCard, FilesTouchedCard, DecisionCard, PlanSummaryCard.

Wash: when `msg.needsAction === true`, set `data-needs-action="true"` on the outer row element AND apply a subtle amber background class (`bg-[color-mix(in_srgb,var(--dpf-warning)_5%,transparent)]`). The data attribute is the test contract; the class is the visual.

Apply `dpf-slide-up` class to the row.

- [ ] **Step 5: Run, pass**
- [ ] **Step 6: Commit**

```bash
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): Bubble with slide-up animation and amber needs-action wash"
```

---

### Task 17: Composer

**Files:**

- Create: `apps/web/components/build-studio/Composer.tsx`
- Create: `apps/web/components/build-studio/Composer.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it("disables Send when textarea is empty", () => {
  render(<Composer onSend={() => {}} onPause={() => {}} onSuggest={() => {}} />);
  expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
});

it("calls onSend with the typed text on Cmd+Enter", () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} onPause={() => {}} onSuggest={() => {}} />);
  const ta = screen.getByPlaceholderText(/reply to dpf/i);
  fireEvent.change(ta, { target: { value: "ship it" } });
  fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
  expect(onSend).toHaveBeenCalledWith("ship it");
});

it("clears the textarea after Send is clicked", () => {
  render(<Composer onSend={() => {}} onPause={() => {}} onSuggest={() => {}} />);
  const ta = screen.getByPlaceholderText(/reply to dpf/i) as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  expect(ta.value).toBe("");
});
```

- [ ] **Step 2: Run, fail**
- [ ] **Step 3: Implement** — auto-resizing textarea (rows=2 initial, scroll on overflow), placeholder "Reply to DPF, or shape what to build next…", footer ghost buttons "Suggest a change" / "Pause build" on the left, primary "Send" with `Send` icon on the right. Cmd/Ctrl+Enter triggers send. Send disabled when empty.
- [ ] **Step 4: Run, pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): Composer with Cmd+Enter submit"
```

---

### Task 18: ConversationPane container

**Files:**

- Create: `apps/web/components/build-studio/ConversationPane.tsx`
- Create: `apps/web/components/build-studio/ConversationPane.test.tsx`

- [ ] **Step 1: Failing test** — render with `DEMO_CONVERSATION` and assert all eight messages from the demo render in order; assert composer is present at the bottom.
- [ ] **Step 2: Run, fail**
- [ ] **Step 3: Implement** — vertical flex; transcript scrolls (`overflow-auto`), composer pinned at bottom. Auto-scroll to the most recent `needsAction: true` bubble on mount. Wire `onOpenArtifact` through to each Bubble.

```tsx
"use client";
import { useEffect, useRef } from "react";
import type { ArtifactView, Message, Step } from "./types";
import { Bubble } from "./Bubble";
import { Composer } from "./Composer";

interface Props {
  messages: Message[];
  steps: Step[];
  userName: string;
  onSend: (text: string) => void;
  onPause: () => void;
  onSuggest: () => void;
  onOpenArtifact: (v: ArtifactView) => void;
}

export function ConversationPane({ messages, steps, userName, onSend, onPause, onSuggest, onOpenArtifact }: Props) {
  const actionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (actionRef.current) actionRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  return (
    <div className="flex flex-col h-full bg-[var(--dpf-bg)]">
      <div className="flex-1 overflow-auto pt-3.5 pb-2">
        {messages.map((m, i) => (
          <div key={i} ref={m.needsAction ? actionRef : undefined}>
            <Bubble msg={m} steps={steps} userName={userName} onOpenArtifact={onOpenArtifact} />
          </div>
        ))}
      </div>
      <Composer onSend={onSend} onPause={onPause} onSuggest={onSuggest} />
    </div>
  );
}
```

- [ ] **Step 4: Run, pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): ConversationPane"
```

---

### Task 19: BuildStudioV2 top-level shell

**Files:**

- Create: `apps/web/components/build-studio/BuildStudioV2.tsx`
- Create: `apps/web/components/build-studio/BuildStudioV2.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it("renders the header, step tracker, conversation pane, and artifact pane", () => {
  render(<BuildStudioV2 />);
  expect(screen.getByText(/Tenant API key rotation/)).toBeInTheDocument(); // header title
  expect(screen.getByText("Understanding")).toBeInTheDocument();           // step tracker
  expect(screen.getByText(/your build assistant/i)).toBeInTheDocument();   // conversation
  expect(screen.getByRole("button", { name: /preview/i })).toBeInTheDocument(); // artifact tabs
});

it("switches the artifact pane when a card drill button is clicked", async () => {
  render(<BuildStudioV2 />);
  // VerificationStripCard's "See screenshots" button drills to verification view.
  const btn = screen.getByRole("button", { name: /see screenshots/i });
  fireEvent.click(btn);
  // Use findByText (async) defensively — React 19 may schedule the state change
  // through a transition. findByText polls up to its default 1000ms timeout.
  expect(await screen.findByText(/coming in slice 3/i)).toBeInTheDocument();
  // And the previously-active Preview content is no longer rendered.
  expect(screen.queryByText(/sandbox.dpf.local/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, fail**
- [ ] **Step 3: Implement**

```tsx
"use client";
import { useState } from "react";
import {
  DEMO_BUILD,
  DEMO_CONVERSATION,
  DEMO_PENDING_APPROVALS,
  DEMO_STEPS,
} from "@/lib/build-studio-demo";
import type { ArtifactView } from "./types";
import { HeaderBar } from "./HeaderBar";
import { StepTracker } from "./StepTracker";
import { ConversationPane } from "./ConversationPane";
import { ArtifactPane } from "./ArtifactPane";

export function BuildStudioV2() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [view, setView] = useState<ArtifactView>("preview");
  const pendingForCurrent = DEMO_PENDING_APPROVALS.filter((a) => a.current).length;
  const otherBuildPending = DEMO_PENDING_APPROVALS.length - pendingForCurrent;
  return (
    <div
      className="grid h-screen overflow-hidden"
      style={{ gridTemplateRows: "auto auto 1fr" }}
      data-theme={theme}
    >
      <HeaderBar
        build={DEMO_BUILD}
        pendingApprovalCount={pendingForCurrent}
        otherBuildApprovalCount={otherBuildPending}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      <StepTracker steps={DEMO_STEPS} />
      <div
        className="grid min-h-0"
        style={{ gridTemplateColumns: "minmax(420px, 44%) 1fr" }}
      >
        <ConversationPane
          messages={DEMO_CONVERSATION}
          steps={DEMO_STEPS}
          userName={DEMO_BUILD.requestedBy}
          onSend={() => {}}
          onPause={() => {}}
          onSuggest={() => {}}
          onOpenArtifact={setView}
        />
        <ArtifactPane view={view} onViewChange={setView} sandboxUrl="sandbox.dpf.local/settings/api-keys" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, pass**
- [ ] **Step 5: Commit**

```bash
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): BuildStudioV2 top-level shell"
```

---

### Task 20: Wire `?v=2` URL switch on the existing /build page

**Files:**

- Modify: `apps/web/app/(shell)/build/page.tsx`

- [ ] **Step 1: Read the current page**

```bash
sed -n '1,40p' /d/DPF-build-studio-redesign/apps/web/app/\(shell\)/build/page.tsx
```

- [ ] **Step 2: Add the v=2 switch**

In `apps/web/app/(shell)/build/page.tsx`, accept `searchParams` per Next.js 16 conventions and conditionally render `BuildStudioV2`:

```tsx
import { BuildStudioV2 } from "@/components/build-studio/BuildStudioV2";

interface PageProps {
  searchParams: Promise<{ v?: string }>;
}

export default async function BuildPage({ searchParams }: PageProps) {
  const { v } = await searchParams;
  if (v === "2") {
    return <BuildStudioV2 />;
  }
  // ...existing implementation unchanged below
}
```

If the existing page already accepts searchParams, integrate the conditional inline; otherwise add the prop. **Do not change any existing render path.**

- [ ] **Step 3: Run typecheck and existing build-studio tests to confirm nothing regressed**

```bash
pnpm --filter web typecheck
pnpm --filter web vitest run apps/web/components/build/
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /d/DPF-build-studio-redesign add apps/web/app/\(shell\)/build/page.tsx
git -C /d/DPF-build-studio-redesign commit -s -m "feat(build-studio): mount v2 shell behind ?v=2 query param"
```

---

### Task 21: Run the full unit test suite

- [ ] **Step 1: Run every build-studio test**

```bash
pnpm --filter web vitest run apps/web/components/build-studio/
```

Expected: all green.

- [ ] **Step 2: Run typecheck across the workspace**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build (CI gate)**

```bash
cd /d/DPF-build-studio-redesign/apps/web && npx next build
```

Use this form rather than `pnpm --filter web build` — sibling slice plans flag a Windows `.next/static/*.tmp` `ENOENT` race that the direct `next build` invocation avoids. Expected: PASS.

If any of the three fails, do not move on — fix root cause, not symptom.

---

### Task 22: Manual smoke test in browser

This task is non-negotiable per the project's "test in browser before claiming done" rule.

- [ ] **Step 1: Start the dev server**

```bash
cd /d/DPF-build-studio-redesign && pnpm --filter web dev
```

Wait until "Ready" appears.

- [ ] **Step 2: Open the legacy shell to confirm no regression**

Browse to `http://localhost:3000/build`. Confirm the existing Build Studio renders unchanged.

- [ ] **Step 3: Open the new shell**

Browse to `http://localhost:3000/build?v=2`. Confirm:

- Header bar renders the build title "Tenant API key rotation" and branch chip `feat/api-key-rotation`.
- Approvals pill renders with "1 thing waiting on you · 2 more across builds" (DEMO data).
- Step tracker shows five steps, with **Building** done, **Checking** active and showing "4 of 6", **Handover** waiting.
- Conversation pane: all eight demo messages render in order. The `needsAction: true` decision callout is visible and the page auto-scrolls to it on mount.
- Composer textarea accepts input. Cmd+Enter submits (logs to console for now via the noop onSend).
- Theme toggle in the header flips light/dark.
- ArtifactTabs work: clicking Walkthrough / What changed / The change shows the "Coming in Slice 3" stub. Preview tab shows the URL bar and the live pulse chip.
- Clicking the VerificationStripCard's "See screenshots" footer button switches the right pane to Walkthrough.
- Clicking the FilesTouchedCard's "See the diff" footer button switches the right pane to The change.

- [ ] **Step 4: Capture screenshots**

Take screenshots of dark and light modes for the PR description. Save to `docs/superpowers/plans/assets/build-studio-redesign-slice-1/slice-1-dark.png` and `slice-1-light.png`. Keep these alongside the plan, not inside the read-only design bundle at `specs/assets/`.

- [ ] **Step 5: Stop the dev server.**

- [ ] **Step 6: Commit screenshots**

```bash
git -C /d/DPF-build-studio-redesign add docs/superpowers/plans/assets/build-studio-redesign-slice-1/
git -C /d/DPF-build-studio-redesign commit -s -m "docs(build-studio): slice 1 verification screenshots"
```

---

### Task 23: Push branch and open PR

- [ ] **Step 1: Push the branch**

```bash
git -C /d/DPF-build-studio-redesign push -u origin feat/build-studio-redesign
```

- [ ] **Step 2: Open PR**

```bash
gh -R OpenDigitalProductFactory/opendigitalproductfactory pr create \
  --base main \
  --head feat/build-studio-redesign \
  --title "feat(build-studio): redesign slice 1 — shell foundation behind ?v=2" \
  --body "$(cat <<'EOF'
## Summary
- Introduces the new conversational two-pane Build Studio shell behind `?v=2` so the redesign can be exercised in production without disturbing the legacy `/build` UX.
- Lands header bar, package-delivery step tracker, conversation pane (with bubbles, composer, and the bundle's six base cards), and artifact pane scaffolding (tabs + Preview view live, others stubbed).
- All wiring uses typed demo fixtures in `lib/build-studio-demo.ts`. Real `agentEventBus` integration and refinement cards (parallel-activity / reviewer-panel / deliberation) ship in slice 2. Walkthrough / What-changed / The-change views ship in slice 3. Approvals popover ships in slice 4. Legacy shell removal ships in slice 5.

Spec: `docs/superpowers/specs/2026-04-25-build-studio-redesign-design.md`
Plan: `docs/superpowers/plans/2026-04-25-build-studio-redesign-slice-1.md`

## Test plan
- [x] Vitest: `pnpm --filter web vitest run apps/web/components/build-studio/`
- [x] Typecheck: `pnpm --filter web typecheck`
- [x] Production build: `pnpm --filter web build`
- [x] Manual smoke at `/build?v=2` — legacy `/build` unchanged
- [x] Light + dark mode screenshots in `docs/superpowers/specs/assets/build-studio-redesign/screenshots/`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Confirm PR opened with green DCO check**

The DCO bot validates every commit carries a `Signed-off-by:` trailer. If it fails, every commit in the branch is missing the trailer — fix by re-committing with `-s`. CI also runs Typecheck and Production Build (both must pass to merge).

---

## Manual Verification Checklist (gate to declaring slice complete)

- [ ] All 23 tasks above checked off.
- [ ] `pnpm --filter web vitest run apps/web/components/build-studio/` passes (every component has at least one render test).
- [ ] `pnpm --filter web typecheck` passes.
- [ ] `pnpm --filter web build` passes.
- [ ] `/build` (legacy) renders unchanged in dev server.
- [ ] `/build?v=2` renders the new shell, theme toggle works, ArtifactTabs work, drill-in card buttons swap the right pane.
- [ ] Light + dark screenshots captured.
- [ ] PR opened against `main` with DCO check green.

## Out-of-band Risks (for the implementer to flag, not solve in slice 1)

1. **Auto-scroll-to-action behavior** — `scrollIntoView({ block: "center" })` may scroll the *outer* page when the conversation pane is short. If observed in manual testing, switch to `block: "nearest"` and document.
2. **Lucide icon size discrepancies** — `ChevronRight` is used as the "drill" icon affordance (per spec README). If it visually reads as navigation rather than drill-in, swap to `MoreHorizontal` and update tests.
3. **Bubble timestamp localization** — bundle data uses literal strings ("9:18am"). Slice 2's real wiring will need `Intl.DateTimeFormat` with the user's locale. Note the assumption.
4. **Theme persistence** — Slice 1 keeps theme in component state; flips reset on page reload. Persistence to `localStorage` (or to DPF's existing theme system, if any) is a Slice 2 concern.

## Slice handoff

After this slice ships, the next agent picks up with:

- `docs/superpowers/plans/2026-04-25-build-studio-redesign-slice-2.md` — refinement card variants + agent-event-bus wiring + persona voice transformer.
- `docs/superpowers/plans/2026-04-25-build-studio-redesign-slice-3.md` — Walkthrough + What-changed + The-change views.
- `docs/superpowers/plans/2026-04-25-build-studio-redesign-slice-4.md` — Approvals popover + cross-build query.
- `docs/superpowers/plans/2026-04-25-build-studio-redesign-slice-5.md` — Legacy shell removal + `?v=2` switch removal once new shell is feature-equivalent.

These plans do not exist yet; write them as the prior slice nears completion.
