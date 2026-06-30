# AI Coworker Proactivity Policy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available and explicitly authorized) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a governed Quiet / Balanced / Assertive proactivity setting for AI coworkers, visible beside the golden-triangle priority dock and resolved consistently for interactive, scheduled, Build Studio, field-dispatch, and monitoring work.

**Architecture:** Build a shared `apps/web/lib/proactivity` module first, then consume it from UI and runtime callers. V1 keeps system/archetype defaults in typed code and writes runtime evidence into existing metadata; persistent overrides are added only after an implementation sweep proves no suitable existing preference substrate exists. Proactivity changes timing, persistence, escalation, spend class, and explanation only; existing autonomy, HITL, grants, routing, and outbound governance remain authoritative.

**Backlog ownership:** This branch owns the first shared implementation slice of `BI-5B6F666F` (`Attention Surface — proactive AI Coworker custodian mode`) under `EP-ATTENTION-SURFACE`. `BI-ACB04A21` is already shipped as the Build Studio pilot/proof point under the closed `EP-BUILD-STUDIO-UX`; this plan must compose with that pilot and must not rebuild Build Studio-specific custodian UX. Build Studio work in this plan is limited to consuming or exposing the shared proactivity plan where an existing runtime/progress seam needs it.

**User outcome guardrail:** Every proactive intervention should be quiet until useful, explain "why now" in one plain-language line, show one recommended action, offer bounded alternatives such as snooze/show why, and hide internal IDs, queues, branches, and diagnostic jargon by default.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma 7, Vitest, lucide-react, DPF theme tokens, existing golden-triangle coworker dock, existing TAK `TaskRun.a2aMetadata`.

**Spec:** `docs/superpowers/specs/2026-06-29-ai-coworker-proactivity-policy-design.md`

**Deferred backlog:** `BI-424CFE7A` covers delegated coworker posture propagation: carry advisory proactivity and golden-triangle context from an initiating task into child coworker subtasks, with the receiving coworker's local policy/risk/quality requirements able to override. This is not part of V1.

**Current delivery state, 2026-06-30:** PR #2530 implements the user-aware runtime resolution slice for `BI-5B6F666F`. Approved proactivity changes are read from scoped `UserFact` preference records, dismissed changes are read from scoped cooldown facts, scheduled task execution now records the effective user-aware `ProactivityPlan`, and field-dispatch customer notification proposals have a server-only user-aware builder plus `AgentActionProposal` producer for the existing Attention Surface `agent-proposal` source. This composes with the shipped Build Studio pilot (`BI-ACB04A21`) by keeping the shared resolver as the primitive and avoiding a Build Studio-specific policy fork.

---

## File Structure

- Create `apps/web/lib/proactivity/proactivity-types.ts`: closed enums, plan/policy/input types, type guards.
- Create `apps/web/lib/proactivity/proactivity-copy.ts`: shared labels, descriptions, icon/color tokens, and accessible copy.
- Create `apps/web/lib/proactivity/proactivity-resolver.ts`: pure resolver that maps activity, archetype, role, risk, and governance hints to a `ProactivityPlan`.
- Create `apps/web/lib/proactivity/proactivity-resolver.test.ts`: resolver matrix tests.
- Create `apps/web/lib/proactivity/proactivity-copy.test.ts`: copy/icon/color guard tests.
- Create `apps/web/components/proactivity/ProactivityGaugeIcon.tsx`: compact gauge icon if stock Lucide cannot represent needle positions well enough.
- Create `apps/web/components/proactivity/ProactivityLevelControl.tsx`: compact dock control and expanded segmented picker.
- Create `apps/web/components/proactivity/ProactivityLevelControl.test.tsx`: interaction and accessible-label tests.
- Create `apps/web/lib/actions/proactivity.ts`: server actions for reading and writing the current user's agent-scoped proactivity preference via `UserFact`.
- Create `apps/web/lib/actions/proactivity.test.ts`: preference read/write tests for the manual dock setting.
- Modify `apps/web/components/golden-triangle/CoworkerPriorityDock.tsx`: render the proactivity chip beside the golden triangle and keep the dock collapsed by default.
- Modify `apps/web/components/golden-triangle/CoworkerPriorityDock.test.tsx`: assert dock layout, collapsed state, persisted proactivity loading/saving, and mobile-safe labels.
- Modify `apps/web/components/agent/CoworkerProfilePanel.tsx`: show effective proactivity explanation and advanced policy details using the same saved preference as the dock.
- Modify `apps/web/components/agent/CoworkerProfilePanel.test.tsx` or add one if no local test exists; assert saved preference consistency and no raw policy IDs.
- Modify `apps/web/lib/tak/autonomous-work-run.ts`: accept optional proactivity metadata and write it into `TaskRun.a2aMetadata.proactivity`.
- Modify `apps/web/lib/tak/scheduled-task-runs.ts`: accept proactivity metadata for scheduled runs if this helper owns the actual `TaskRun` create path.
- Modify `apps/web/lib/actions/agent-task-scheduler.ts`: resolve and pass scheduled-task proactivity plan without bypassing owner/tool/HITL checks.
- Modify `apps/web/lib/proactivity/proactivity-resolver.server.ts`: read acknowledged `UserFact` override and cooldown facts without importing Prisma into client-safe resolver code.
- Modify relevant Build Studio custodian/stall caller once identified in implementation: consume shared resolver, do not fork a Build Studio-only policy.
- Modify field-dispatch runtime caller once identified in implementation: consume shared resolver around runtime behavior, not pure validator functions.
- Optional migration: `packages/db/prisma/migrations/<timestamp>_proactivity_override/migration.sql` only if no existing preference/action-envelope substrate can store accepted overrides cleanly.

## Chunk 1: Shared Proactivity Resolver

### Task 1: Add Closed Types

**Files:**
- Create: `apps/web/lib/proactivity/proactivity-types.ts`
- Test: `apps/web/lib/proactivity/proactivity-resolver.test.ts`

- [ ] **Step 1: Write failing enum/type tests**

```ts
import { describe, expect, it } from "vitest";
import { PROACTIVITY_ACTIVITY_FAMILIES, PROACTIVITY_LEVELS, isProactivityLevel } from "./proactivity-types";

describe("proactivity types", () => {
  it("keeps the persisted level enum closed and stable", () => {
    expect(PROACTIVITY_LEVELS).toEqual(["quiet", "balanced", "assertive"]);
    expect(isProactivityLevel("balanced")).toBe(true);
    expect(isProactivityLevel("aggressive")).toBe(false);
    expect(isProactivityLevel("not-proactive")).toBe(false);
  });

  it("includes the first implementation activity families", () => {
    expect(PROACTIVITY_ACTIVITY_FAMILIES).toContain("field-dispatch-appointment");
    expect(PROACTIVITY_ACTIVITY_FAMILIES).toContain("build-studio-custodian");
    expect(PROACTIVITY_ACTIVITY_FAMILIES).toContain("tax-compliance");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm --filter web exec vitest run apps/web/lib/proactivity/proactivity-resolver.test.ts`

Expected: FAIL because `apps/web/lib/proactivity/proactivity-types.ts` does not exist.

- [ ] **Step 3: Implement closed types**

```ts
export const PROACTIVITY_LEVELS = ["quiet", "balanced", "assertive"] as const;
export type ProactivityLevel = (typeof PROACTIVITY_LEVELS)[number];

export const PROACTIVITY_ACTIVITY_FAMILIES = [
  "interactive-chat",
  "todo-follow-up",
  "scheduled-task",
  "field-dispatch-appointment",
  "build-studio-custodian",
  "technology-debt",
  "platform-health",
  "tax-compliance",
  "customer-communication",
  "finance-close",
  "security-incident",
] as const;
export type ProactivityActivityFamily = (typeof PROACTIVITY_ACTIVITY_FAMILIES)[number];

export type ProactivitySpendClass = "minimal" | "standard" | "elevated";
export type ProactivityChannelPolicy = "in-app-only" | "preferred-channel" | "urgent-channel" | "multi-channel";
export type ProactivityActionBoundary = "advise" | "propose" | "preauthorized";

export type ProactivityPlan = {
  resolvedLevel: ProactivityLevel;
  policyId: string;
  attentionWindowMinutes: number;
  followUpCadenceMinutes: number[];
  maxAttempts: number;
  spendClass: ProactivitySpendClass;
  channelPolicy: ProactivityChannelPolicy;
  escalationTarget: "attention-surface" | "owner" | "role" | "dispatcher" | "platform-operator";
  actionBoundary: ProactivityActionBoundary;
  explanation: string;
  evidenceRefs: Array<{ kind: string; id: string }>;
};

export function isProactivityLevel(value: unknown): value is ProactivityLevel {
  return typeof value === "string" && (PROACTIVITY_LEVELS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run apps/web/lib/proactivity/proactivity-resolver.test.ts`

Expected: PASS for type tests.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/proactivity/proactivity-types.ts apps/web/lib/proactivity/proactivity-resolver.test.ts
git commit -s -m "feat: add proactivity policy types"
```

### Task 2: Add Shared Copy And Symbol Metadata

**Files:**
- Create: `apps/web/lib/proactivity/proactivity-copy.ts`
- Test: `apps/web/lib/proactivity/proactivity-copy.test.ts`

- [ ] **Step 1: Write failing copy tests**

```ts
import { describe, expect, it } from "vitest";
import { PROACTIVITY_LEVEL_COPY, getProactivityLevelCopy } from "./proactivity-copy";

describe("proactivity copy", () => {
  it("uses labels and descriptions that do not imply broader authority", () => {
    expect(PROACTIVITY_LEVEL_COPY.assertive.label).toBe("Assertive");
    expect(PROACTIVITY_LEVEL_COPY.assertive.description).toContain("warn earlier");
    expect(PROACTIVITY_LEVEL_COPY.assertive.description).not.toMatch(/auto-approve|permission|authority/i);
  });

  it("pairs color with gauge treatment for every level", () => {
    expect(getProactivityLevelCopy("quiet").accent).toBe("green");
    expect(getProactivityLevelCopy("balanced").gaugeNeedle).toBe("center");
    expect(getProactivityLevelCopy("assertive").accent).toBe("red");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm --filter web exec vitest run apps/web/lib/proactivity/proactivity-copy.test.ts`

Expected: FAIL because copy module does not exist.

- [ ] **Step 3: Implement copy module**

```ts
import type { ProactivityLevel } from "./proactivity-types";

export const PROACTIVITY_LEVEL_COPY: Record<ProactivityLevel, {
  label: string;
  description: string;
  accent: "green" | "yellow" | "red";
  gaugeNeedle: "low" | "center" | "high";
  ariaLabel: string;
}> = {
  quiet: {
    label: "Quiet",
    description: "Wait for me unless something is urgent or already approved.",
    accent: "green",
    gaugeNeedle: "low",
    ariaLabel: "Proactivity quiet, minimum follow-up",
  },
  balanced: {
    label: "Balanced",
    description: "Follow up when timing, commitments, or risk make it useful.",
    accent: "yellow",
    gaugeNeedle: "center",
    ariaLabel: "Proactivity balanced, normal follow-up",
  },
  assertive: {
    label: "Assertive",
    description: "Stay on this, warn earlier, and escalate sooner when allowed.",
    accent: "red",
    gaugeNeedle: "high",
    ariaLabel: "Proactivity assertive, aggressive follow-up",
  },
};

export function getProactivityLevelCopy(level: ProactivityLevel) {
  return PROACTIVITY_LEVEL_COPY[level];
}
```

- [ ] **Step 4: Run copy and type tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/proactivity/proactivity-copy.test.ts apps/web/lib/proactivity/proactivity-resolver.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/proactivity/proactivity-copy.ts apps/web/lib/proactivity/proactivity-copy.test.ts
git commit -s -m "feat: add proactivity copy metadata"
```

### Task 3: Implement Pure Resolver

**Files:**
- Create: `apps/web/lib/proactivity/proactivity-resolver.ts`
- Test: `apps/web/lib/proactivity/proactivity-resolver.test.ts`

- [ ] **Step 1: Add failing resolver matrix tests**

```ts
import { resolveProactivityPlan } from "./proactivity-resolver";

describe("resolveProactivityPlan", () => {
  it("makes field-dispatch appointment delays assertive for slot-hours emergency work", () => {
    expect(resolveProactivityPlan({
      activityFamily: "field-dispatch-appointment",
      archetype: { demandSignature: "emergency-reactive", capacityUnit: "slot-hours", fieldDispatchRunningLate: true },
      riskBand: "medium",
    })).toMatchObject({
      resolvedLevel: "assertive",
      channelPolicy: "urgent-channel",
      escalationTarget: "dispatcher",
      actionBoundary: "propose",
    });
  });

  it("keeps todo follow-up balanced and bounded", () => {
    const plan = resolveProactivityPlan({ activityFamily: "todo-follow-up" });
    expect(plan.resolvedLevel).toBe("balanced");
    expect(plan.maxAttempts).toBeLessThanOrEqual(2);
  });

  it("escalates Build Studio blocked work without increasing authority", () => {
    expect(resolveProactivityPlan({
      activityFamily: "build-studio-custodian",
      statusSignal: "stalled",
    })).toMatchObject({ resolvedLevel: "assertive", actionBoundary: "propose" });
  });

  it("uses assertive reminders for tax deadlines but keeps action advisory or proposal-gated", () => {
    const plan = resolveProactivityPlan({
      activityFamily: "tax-compliance",
      deadlineWindowDays: 7,
      regulated: true,
    });
    expect(plan.resolvedLevel).toBe("assertive");
    expect(["advise", "propose"]).toContain(plan.actionBoundary);
  });
});
```

- [ ] **Step 2: Run the failing resolver tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/proactivity/proactivity-resolver.test.ts`

Expected: FAIL because `resolveProactivityPlan` does not exist.

- [ ] **Step 3: Implement minimal resolver**

Implementation notes:
- Keep resolver pure and deterministic.
- Accept only plain data; do not import Prisma, React, action modules, or field-dispatch validator internals.
- Include `policyId`, `explanation`, and `evidenceRefs` in every plan.
- Intersect regulated work and high risk with `actionBoundary: "advise"` or `"propose"`.

- [ ] **Step 4: Run resolver tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/proactivity/proactivity-resolver.test.ts apps/web/lib/proactivity/proactivity-copy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/proactivity/proactivity-resolver.ts apps/web/lib/proactivity/proactivity-resolver.test.ts
git commit -s -m "feat: resolve coworker proactivity plans"
```

## Chunk 2: Composer Dock UX

### Task 4: Build Proactivity Level Control

**Files:**
- Create: `apps/web/components/proactivity/ProactivityLevelControl.tsx`
- Create: `apps/web/components/proactivity/ProactivityGaugeIcon.tsx`
- Test: `apps/web/components/proactivity/ProactivityLevelControl.test.tsx`

- [ ] **Step 1: Write failing render and interaction tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProactivityLevelControl } from "./ProactivityLevelControl";

describe("ProactivityLevelControl", () => {
  it("renders compact gauge, label, and current level", () => {
    render(<ProactivityLevelControl value="balanced" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Proactivity balanced/i })).toBeInTheDocument();
    expect(screen.getByText("Proactivity")).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });

  it("lets the operator choose Assertive without relying on color alone", () => {
    const onChange = vi.fn();
    render(<ProactivityLevelControl value="balanced" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Proactivity balanced/i }));
    fireEvent.click(screen.getByRole("button", { name: /Assertive/i }));
    expect(onChange).toHaveBeenCalledWith("assertive");
  });
});
```

- [ ] **Step 2: Run failing component test**

Run: `pnpm --filter web exec vitest run apps/web/components/proactivity/ProactivityLevelControl.test.tsx`

Expected: FAIL because component files do not exist.

- [ ] **Step 3: Implement component**

Implementation notes:
- Use `button`, `aria-expanded`, and accessible names.
- Use `PROACTIVITY_LEVEL_COPY` for labels/descriptions.
- Use `lucide-react` `Gauge` or `CircleGauge` first.
- If custom needle positions are needed, implement `ProactivityGaugeIcon` with 14-16px dimensions, Lucide-like stroke, and `aria-hidden`.
- Use theme tokens and existing inline-style conventions in `CoworkerPriorityDock`; no hardcoded theme-breaking fills.
- Use green/yellow/red accents only as small arcs/dots/borders plus text.

- [ ] **Step 4: Run component test**

Run: `pnpm --filter web exec vitest run apps/web/components/proactivity/ProactivityLevelControl.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/components/proactivity apps/web/lib/proactivity
git commit -s -m "feat: add proactivity level control"
```

### Task 5: Place Control Beside Golden Triangle

**Files:**
- Modify: `apps/web/components/golden-triangle/CoworkerPriorityDock.tsx`
- Test: `apps/web/components/golden-triangle/CoworkerPriorityDock.test.tsx`

- [ ] **Step 1: Update failing dock tests**

Add assertions that the collapsed dock shows both critical settings:

```tsx
expect(screen.getByRole("button", { name: /Priority/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Proactivity balanced/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run failing dock tests**

Run: `pnpm --filter web exec vitest run apps/web/components/golden-triangle/CoworkerPriorityDock.test.tsx`

Expected: FAIL because proactivity is not rendered in the dock.

- [ ] **Step 3: Modify dock layout**

Implementation notes:
- Keep priority collapsed by default.
- Render a critical-settings strip with two siblings:
  - left: existing golden-triangle priority button
  - right: `ProactivityLevelControl`
- Do not move `GoldenTriangleControl` into the proactivity expansion.
- If one control is expanded, keep layout stable and avoid overlapping composer input.
- Initial V1 value can be `balanced` until persistence lands.

- [ ] **Step 4: Run dock and proactivity tests**

Run: `pnpm --filter web exec vitest run apps/web/components/golden-triangle/CoworkerPriorityDock.test.tsx apps/web/components/proactivity/ProactivityLevelControl.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/components/golden-triangle/CoworkerPriorityDock.tsx apps/web/components/golden-triangle/CoworkerPriorityDock.test.tsx apps/web/components/proactivity
git commit -s -m "feat: show proactivity beside coworker priority"
```

### Task 6: Add Profile Details

**Files:**
- Modify: `apps/web/components/agent/CoworkerProfilePanel.tsx`
- Test: `apps/web/components/agent/CoworkerProfilePanel.test.tsx` or nearest existing agent panel test.

- [ ] **Step 1: Write failing profile test**

Assert that the profile shows:
- current level,
- why selected,
- source,
- action boundary,
- spend class.

- [ ] **Step 2: Run failing profile test**

Run: `pnpm --filter web exec vitest run apps/web/components/agent/CoworkerProfilePanel.test.tsx`

Expected: FAIL until profile section exists. If no test harness exists, create a focused test with minimal mocked agent props.

- [ ] **Step 3: Implement profile section**

Implementation notes:
- Use shared copy from `proactivity-copy.ts`.
- Default to a balanced plan from resolver when no explicit plan prop is provided.
- Keep advanced policy details behind a compact disclosure if the existing profile pattern supports it.
- Do not add a new global dashboard.

- [ ] **Step 4: Run profile test**

Run: `pnpm --filter web exec vitest run apps/web/components/agent/CoworkerProfilePanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/components/agent/CoworkerProfilePanel.tsx apps/web/components/agent/CoworkerProfilePanel.test.tsx
git commit -s -m "feat: show coworker proactivity details"
```

## Chunk 3: Runtime Metadata And Scheduled Work

### Task 7: Thread Proactivity Into TaskRun Metadata

**Files:**
- Modify: `apps/web/lib/tak/autonomous-work-run.ts`
- Test: add or update nearest TAK test for `createAutonomousWorkRun`.

- [ ] **Step 1: Write failing metadata test**

Assert that calling `createAutonomousWorkRun({ metadata: { proactivity: plan } })` persists `a2aMetadata.proactivity` without overwriting trigger/sourceRef metadata.

- [ ] **Step 2: Run failing TAK test**

Run: `pnpm --filter web exec vitest run apps/web/lib/tak/autonomous-work-run.test.ts`

Expected: FAIL if no test exists or if assertions are not met. Create the test file if needed using the repo's existing Prisma mocking pattern.

- [ ] **Step 3: Implement typed proactivity metadata input**

Implementation notes:
- Prefer adding a typed optional `proactivity?: ProactivityPlan` to `AutonomousWorkRunInput`.
- Merge into `a2aMetadata` as `{ proactivity: input.proactivity }`.
- Preserve generic `metadata` for other callers, but prevent generic metadata from accidentally clobbering the resolved plan by applying explicit proactivity last.

- [ ] **Step 4: Run TAK test**

Run: `pnpm --filter web exec vitest run apps/web/lib/tak/autonomous-work-run.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/tak/autonomous-work-run.ts apps/web/lib/tak/autonomous-work-run.test.ts
git commit -s -m "feat: persist proactivity on task runs"
```

### Task 8: Resolve Scheduled Task Proactivity

**Files:**
- Modify: `apps/web/lib/actions/agent-task-scheduler.ts`
- Modify: `apps/web/lib/tak/scheduled-task-runs.ts`
- Test: `apps/web/lib/actions/agent-task-scheduler.test.ts`

- [ ] **Step 1: Write failing scheduled-task test**

Assert that `executeScheduledAgentTask()` resolves a `scheduled-task` proactivity plan and writes it to the created run metadata.

- [ ] **Step 2: Run failing scheduler test**

Run: `pnpm --filter web exec vitest run apps/web/lib/actions/agent-task-scheduler.test.ts`

Expected: FAIL until scheduler calls the resolver and passes the plan.

- [ ] **Step 3: Implement scheduled resolver call**

Implementation notes:
- Call `resolveProactivityPlan({ activityFamily: "scheduled-task", routeContext: task.routeContext, agentId: task.agentId })`.
- If the scheduled task title/prompt clearly maps to tax/compliance or technology-debt later, add a separate classifier only after tests. Do not do prompt parsing in this task.
- Pass the plan through `createTaskRunForScheduledTask` or the actual helper that creates the `TaskRun`.
- Do not bypass existing owner resolution, tool grants, HITL, or scheduled job status handling.

- [ ] **Step 4: Run scheduler tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/actions/agent-task-scheduler.test.ts apps/web/lib/tak/autonomous-work-run.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/actions/agent-task-scheduler.ts apps/web/lib/actions/agent-task-scheduler.test.ts apps/web/lib/tak/scheduled-task-runs.ts
git commit -s -m "feat: resolve proactivity for scheduled tasks"
```

## Chunk 4: Field Dispatch And Build Studio Consumption

### Task 9: Add Field Dispatch Runtime Fixture

**Files:**
- Modify: field-dispatch runtime caller identified during implementation.
- Do not modify: `packages/validators/src/field-dispatch-policy.ts` except for tests proving it remains pure.
- Test: nearest field-dispatch runtime test.

- [ ] **Step 1: Locate runtime caller**

Run: `rg -n "running-late|field-dispatch|FieldDispatchProfile|deriveFieldDispatchProfile|flag-attention|notify" apps packages -g "*.ts" -g "*.tsx"`

Expected: identify the runtime layer that consumes pure field-dispatch intents and schedules/proposes outbound actions.

- [ ] **Step 2: Write failing fixture**

Assert that a running-late appointment in a slot-hours/emergency-reactive field-dispatch archetype resolves `assertive`, uses `urgent-channel`, and keeps `actionBoundary` at `propose` unless a separate automation policy exists.

- [ ] **Step 3: Run failing field-dispatch test**

Run the nearest focused test found in Step 1 with `pnpm --filter web exec vitest run <path>`.

Expected: FAIL until runtime consumes `resolveProactivityPlan`.

- [ ] **Step 4: Implement runtime resolver call**

Implementation notes:
- Wrap runtime behavior only.
- Keep pure validator output unchanged.
- Add proactivity plan to outbound/action metadata or related runtime evidence.

- [ ] **Step 5: Run field-dispatch tests**

Run the focused test and `pnpm --filter web exec vitest run apps/web/lib/proactivity/proactivity-resolver.test.ts`.

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add <field-dispatch-runtime-files> apps/web/lib/proactivity/proactivity-resolver.test.ts
git commit -s -m "feat: apply proactivity to field dispatch delays"
```

### Task 10: Add Build Studio Custodian Fixture

**Files:**
- Modify: Build Studio stuck/custodian caller identified during implementation.
- Test: nearest Build Studio stall/custodian test.

**Boundary:** Do not duplicate the shipped Build Studio custodian mode from `BI-ACB04A21`. Treat it as pilot evidence. This task should only add shared `ProactivityPlan` composition where Build Studio already has a progress/stall/escalation seam, preserving its existing one-status/one-next-action UX.

- [ ] **Step 1: Locate Build Studio caller**

Run: `rg -n "custodian|stalled|blocked|missing progress|Build Studio|build-studio" apps/web/lib apps/web/components -g "*.ts" -g "*.tsx"`

Expected: identify the caller that should resolve `build-studio-custodian`.

- [ ] **Step 2: Write failing Build Studio fixture**

Assert:
- normal progress resolves `balanced`,
- blocked/stalled progress resolves `assertive`,
- spend remains bounded by right-sizing/cost governance,
- action boundary remains `propose`.

- [ ] **Step 3: Run failing Build Studio test**

Run the nearest focused test with `pnpm --filter web exec vitest run <path>`.

Expected: FAIL until shared resolver is consumed.

- [ ] **Step 4: Implement Build Studio resolver call**

Implementation notes:
- Consume shared `resolveProactivityPlan`; do not create a Build Studio-specific proactivity enum or duplicate thresholds.
- Record the plan where Build Studio task/progress evidence is already surfaced.
- Keep recovery actions under existing Build Studio phase rules.

- [ ] **Step 5: Run Build Studio and resolver tests**

Run focused Build Studio test plus `pnpm --filter web exec vitest run apps/web/lib/proactivity/proactivity-resolver.test.ts`.

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add <build-studio-files> apps/web/lib/proactivity/proactivity-resolver.test.ts
git commit -s -m "feat: apply proactivity to build custodian state"
```

## Chunk 5: Overrides And Acknowledgement

### Task 11: Decide Override Persistence

**Files:**
- Inspect: `packages/db/prisma/schema.prisma`
- Inspect: `apps/web/lib/actions/*`
- Optional create migration only if required.

- [ ] **Step 1: Search for suitable existing preference/proposal stores**

Run: `rg -n "Preference|Override|CoworkerActionEnvelope|ScheduledOutboundAction|autopilotPolicy|settings|acknowledgedBy|proposedBy" packages/db/prisma/schema.prisma apps/web/lib apps/web/components -g "*.ts" -g "*.tsx"`

Expected: clear decision whether existing substrate can store accepted proactivity overrides.

- [ ] **Step 2: Document decision in implementation notes**

If existing substrate is suitable, add a short code comment near the chosen adapter and no migration. If not suitable, create `ProactivityOverride` using the spec's narrow table.

- [ ] **Step 3: If migration is needed, create it with Prisma**

Run: `pnpm --filter @dpf/db exec prisma migrate dev --name proactivity_override`

Expected: migration file created under `packages/db/prisma/migrations/`.

- [ ] **Step 4: Commit persistence decision**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/web/lib
git commit -s -m "feat: persist proactivity overrides"
```

### Task 12: Add Coworker Proposal Envelope

**Files:**
- Modify: proposal/action-envelope code path found in Task 11.
- Test: nearest action-envelope test.

- [ ] **Step 1: Write failing proposal test**

Assert that a coworker can propose:
- current level,
- proposed level,
- scope,
- evidence,
- spend/notification impact,
- acknowledgement actions.

- [ ] **Step 2: Run failing proposal test**

Run focused test with `pnpm --filter web exec vitest run <path>`.

Expected: FAIL until proposal type and handlers exist.

- [ ] **Step 3: Implement proposal type and acknowledgement handling**

Implementation notes:
- Name action type `propose_proactivity_change` if a new type is required.
- Accepted proposals create the chosen override.
- Dismissed proposals cool down to avoid nagging.
- Every change records who proposed, who acknowledged, previous level, new level, scope, and rationale.

- [ ] **Step 4: Run proposal tests**

Run focused proposal tests plus resolver tests.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add <proposal-files> apps/web/lib/proactivity
git commit -s -m "feat: acknowledge proactivity changes"
```

## Chunk 6: Verification And Ship Readiness

### Task 13: Source-Local Verification

- [ ] **Step 1: Run resolver and copy tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/proactivity`

Expected: PASS.

- [ ] **Step 2: Run component tests**

Run: `pnpm --filter web exec vitest run apps/web/components/proactivity apps/web/components/golden-triangle/CoworkerPriorityDock.test.tsx apps/web/components/agent/CoworkerProfilePanel.test.tsx`

Expected: PASS. If a listed test file does not exist because the implementation used another nearby test, run that exact file and record the substitution.

- [ ] **Step 3: Run affected runtime tests**

Run focused scheduler, field-dispatch, Build Studio, and TAK tests added above.

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit verification-only fixes if needed**

Only commit if verification required code/test fixes:

```powershell
git add <fixed-files>
git commit -s -m "fix: stabilize proactivity verification"
```

### Task 14: Runtime-Bound Verification

- [ ] **Step 1: Acquire the canonical verification substrate**

Use the shared local-CI convergence sandbox or canonical local install per `AGENTS.md`. Do not mutate the main `dpf` portal directly with ad hoc compose rebuilds.

- [ ] **Step 2: Run production build**

Run: `pnpm --filter web build`

Expected: PASS with zero TypeScript/build errors.

- [ ] **Step 3: UX verification**

Use browser verification against the served app:
- Open a coworker panel.
- Confirm the golden-triangle dock still starts collapsed.
- Confirm Proactivity appears to the right of Priority.
- Switch Quiet, Balanced, Assertive.
- Confirm green/yellow/red accents render with labels.
- Confirm no overlap at desktop and mobile widths.
- Confirm profile details explain why the level was chosen.

- [ ] **Step 4: Runtime fixtures**

Exercise or simulate:
- running-late field appointment resolves assertive and proposes customer update,
- normal Build Studio work resolves balanced,
- blocked/stalled Build Studio work resolves assertive,
- scheduled task run writes `a2aMetadata.proactivity`.

- [ ] **Step 5: Migration apply if migration exists**

Run: `pnpm --filter @dpf/db exec prisma migrate dev`

Expected: applies cleanly. Skip and record "no migration added" if override persistence reused existing substrate.

### Task 15: Final Review And Push

- [ ] **Step 1: Run final status**

Run: `git status --short --branch`

Expected: clean working tree on topic branch.

- [ ] **Step 2: Review commit history**

Run: `git log --oneline --decorate -n 12`

Expected: small, scoped, signed commits.

- [ ] **Step 3: Push branch**

Run: `git push`

Expected: branch pushed to origin.

- [ ] **Step 4: Open PR only after gates are green**

Open a regular ready-for-review PR only after unit tests, typecheck, production build, UX verification, runtime fixtures, and migration gate are complete. Do not open a draft PR.

## Review Checkpoints

- Spec review: this Codex session did not spawn a reviewer because subagent spawning is gated unless the user explicitly asks for delegated agents. If delegated agents are authorized later, dispatch a spec-document-reviewer against `docs/superpowers/specs/2026-06-29-ai-coworker-proactivity-policy-design.md`.
- Plan review: after this plan is written, dispatch a plan-document-reviewer if subagents are explicitly authorized. Otherwise, run a self-review against the spec before implementation.
- Code review: after each chunk, request code review if subagents are authorized; otherwise use the current-session review checklist and focused tests before continuing.

## Implementation Notes

- Preserve the 20 percent refactoring budget from the spec: shared resolver, shared copy, no one-off threshold fields in Build Studio, scheduled tasks, or field dispatch.
- Keep `field-dispatch-policy.ts` pure. Proactivity belongs in runtime behavior around the intents.
- Keep `assertive` bounded: more persistence, earlier warnings, faster escalation, higher spend class when allowed; never broader authority.
- Do not implement delegated coworker posture propagation in this V1 plan. Subtasks should execute once legitimately delegated; future work (`BI-424CFE7A`) can pass advisory caller proactivity and golden-triangle posture into child tasks, with receiving coworker local policy taking precedence where risk or quality demands it.
- Use `lucide-react` before adding custom icon code. Add `ProactivityGaugeIcon` only if the stock icon cannot express the three needle positions clearly.
- Use theme tokens and accessible labels; green/yellow/red must not be the only signal.
