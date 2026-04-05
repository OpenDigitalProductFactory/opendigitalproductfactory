# TAK Skills Observatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an admin observatory at `/platform/ai/skills` that exposes specialist internal capabilities, finishing passes, and skill execution to platform administrators — implementing TAK's inspectability principle.

**Architecture:** New tab in the existing AI platform nav (`AiTabNav`). Server component page fetches skill assignments, tool executions, and build activities. Three client panels: Skills Catalog (all skills across routes with internal/external classification), Specialist Finishing Passes (audit trail of quality gates from build activities), and Skill Execution Trace (when skills fired, what tools were called, outcomes). Uses existing DB models — no schema migration required for Phase 1.

**Tech Stack:** Next.js 16 App Router (server component page + client panels), Prisma queries on existing models (AgentSkillAssignment, ToolExecution, BuildActivity, Agent), Tailwind with DPF design tokens, no new dependencies.

---

## Context for Implementers

### TAK Principle
"Humans hold authority. Agents hold capability. The kernel mediates." The observatory is how humans **verify** the mediation is working. It answers: what skills exist, which are user-facing vs specialist-internal, what quality passes ran, and what the outcomes were.

### Progressive Disclosure
End users see 6 skills in the Build Studio dropdown. Admins see the full picture: 6 user-facing + 4 specialist-internal finishing passes + the universal skills + all route skills across the platform. The observatory is the admin lens.

### Existing Patterns to Follow
- **Page pattern:** `apps/web/app/(shell)/platform/ai/page.tsx` — server component, Prisma queries, passes data to client panels
- **Tab nav:** `apps/web/components/platform/AiTabNav.tsx` — add "Skills" tab
- **Client panels:** `apps/web/components/platform/ToolExecutionLogClient.tsx` — filterable table with expandable rows
- **Design tokens:** All colors via `var(--dpf-*)`, shadows via `shadow-dpf-*`, animations via `animate-*`

### Key Files Reference
| File | Purpose |
|------|---------|
| `apps/web/lib/tak/route-context-map.ts` | ROUTE_CONTEXT_MAP with skills per route + UNIVERSAL_SKILLS |
| `apps/web/lib/tak/agent-routing.ts` | ROUTE_AGENT_MAP with legacy skills |
| `apps/web/lib/integrate/specialist-prompts.ts` | SPECIALIST_PROMPTS with finishing passes, UX_ACCESSIBILITY_PROMPT |
| `apps/web/components/platform/AiTabNav.tsx` | Tab navigation for /platform/ai/* |
| `packages/db/prisma/schema.prisma` | AgentSkillAssignment, ToolExecution, BuildActivity models |

---

## Task 1: Add "Skills" Tab to AI Platform Nav

**Files:**
- Modify: `apps/web/components/platform/AiTabNav.tsx:6-14`

- [ ] **Step 1: Read AiTabNav.tsx** — confirm TABS array structure
- [ ] **Step 2: Add the Skills tab entry**

Add to the TABS array after "Authority":

```typescript
{ label: "Skills", href: "/platform/ai/skills" },
```

- [ ] **Step 3: Verify no TypeScript errors** — `pnpm exec tsc --noEmit`
- [ ] **Step 4: Commit** — `feat(tak): add Skills tab to AI platform nav`

---

## Task 2: Create Skills Data Fetcher

**Files:**
- Create: `apps/web/lib/actions/skills-observatory.ts`

- [ ] **Step 1: Write the data fetcher**

```typescript
// apps/web/lib/actions/skills-observatory.ts
"use server";

import { prisma } from "@dpf/db";
import { ROUTE_CONTEXT_MAP, UNIVERSAL_SKILLS } from "@/lib/tak/route-context-map";
import { SPECIALIST_TOOLS, SPECIALIST_AGENT_IDS } from "@/lib/integrate/specialist-prompts";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SkillEntry = {
  label: string;
  description: string;
  capability: string | null;
  prompt: string;
  taskType: string;
  route: string;
  audience: "user" | "universal" | "specialist-internal";
};

export type FinishingPassEntry = {
  id: string;
  buildId: string;
  tool: string;
  summary: string;
  createdAt: string;
  passType: string | null; // inferred from tool/summary
};

export type SkillExecutionEntry = {
  id: string;
  agentId: string;
  toolName: string;
  success: boolean;
  durationMs: number | null;
  routeContext: string | null;
  createdAt: string;
};

// ─── Fetchers ───────────────────────────────────────────────────────────────

/** Collects all skills from route context map + universal + specialist-internal. */
export async function getSkillsCatalog(): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];

  // Universal skills
  for (const s of UNIVERSAL_SKILLS) {
    skills.push({
      label: s.label,
      description: s.description,
      capability: s.capability,
      prompt: s.prompt,
      taskType: s.taskType ?? "conversation",
      route: "*",
      audience: "universal",
    });
  }

  // Route-specific user-facing skills
  for (const [route, ctx] of Object.entries(ROUTE_CONTEXT_MAP)) {
    for (const s of ctx.skills) {
      skills.push({
        label: s.label,
        description: s.description,
        capability: s.capability,
        prompt: s.prompt,
        taskType: s.taskType ?? "conversation",
        route,
        audience: "user",
      });
    }
  }

  // Specialist-internal finishing passes (from prompt definitions)
  const FINISHING_PASSES = [
    { label: "Design Token Compliance", description: "Scan for hardcoded hex colors, replace with var(--dpf-*) tokens", route: "/build" },
    { label: "Accessibility Pass", description: "Verify aria-labels, real buttons, focus rings, tab panel ARIA", route: "/build" },
    { label: "Loading & Empty States", description: "Ensure every async op has spinner/skeleton, empty lists have messages", route: "/build" },
    { label: "Responsive & Polish", description: "Check breakpoints, hover states, animations, touch targets", route: "/build" },
  ];
  for (const fp of FINISHING_PASSES) {
    skills.push({
      label: fp.label,
      description: fp.description,
      capability: null,
      prompt: "(specialist-internal — runs automatically during build phase)",
      taskType: "code_generation",
      route: fp.route,
      audience: "specialist-internal",
    });
  }

  return skills;
}

/** Fetches recent finishing pass activity from BuildActivity logs. */
export async function getFinishingPassActivity(limit = 50): Promise<FinishingPassEntry[]> {
  const activities = await prisma.buildActivity.findMany({
    where: {
      tool: { in: ["uxAccessibilityAudit", "runBuildPipeline", "generate_code"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      buildId: true,
      tool: true,
      summary: true,
      createdAt: true,
    },
  });

  return activities.map((a) => ({
    id: a.id,
    buildId: a.buildId,
    tool: a.tool,
    summary: a.summary,
    createdAt: a.createdAt.toISOString(),
    passType: inferPassType(a.tool, a.summary),
  }));
}

function inferPassType(tool: string, summary: string): string | null {
  if (tool === "uxAccessibilityAudit") return "accessibility";
  if (summary.includes("token") || summary.includes("color")) return "design-tokens";
  if (summary.includes("responsive") || summary.includes("breakpoint")) return "responsive";
  if (summary.includes("loading") || summary.includes("skeleton")) return "loading-states";
  return null;
}

/** Fetches recent tool executions by build specialists. */
export async function getSpecialistExecutions(limit = 100): Promise<SkillExecutionEntry[]> {
  const specialistIds = Object.values(SPECIALIST_AGENT_IDS);

  const executions = await prisma.toolExecution.findMany({
    where: { agentId: { in: specialistIds } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      agentId: true,
      toolName: true,
      success: true,
      durationMs: true,
      routeContext: true,
      createdAt: true,
    },
  });

  return executions.map((e) => ({
    id: e.id,
    agentId: e.agentId,
    toolName: e.toolName,
    success: e.success,
    durationMs: e.durationMs,
    routeContext: e.routeContext,
    createdAt: e.createdAt.toISOString(),
  }));
}

/** Summary stats for the observatory header. */
export async function getSkillsObservatoryStats() {
  const catalog = await getSkillsCatalog();
  const [toolExecCount, buildActivityCount] = await Promise.all([
    prisma.toolExecution.count({
      where: { agentId: { in: Object.values(SPECIALIST_AGENT_IDS) } },
    }),
    prisma.buildActivity.count(),
  ]);

  return {
    totalSkills: catalog.length,
    userFacing: catalog.filter((s) => s.audience === "user").length,
    universal: catalog.filter((s) => s.audience === "universal").length,
    specialistInternal: catalog.filter((s) => s.audience === "specialist-internal").length,
    routes: new Set(catalog.map((s) => s.route)).size,
    totalToolExecutions: toolExecCount,
    totalBuildActivities: buildActivityCount,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles** — `pnpm exec tsc --noEmit`
- [ ] **Step 3: Commit** — `feat(tak): skills observatory data fetchers`

---

## Task 3: Create Skills Catalog Panel (Client Component)

**Files:**
- Create: `apps/web/components/platform/SkillsObservatoryPanel.tsx`

- [ ] **Step 1: Write the panel component**

```typescript
// apps/web/components/platform/SkillsObservatoryPanel.tsx
"use client";

import { useState } from "react";
import type { SkillEntry, FinishingPassEntry, SkillExecutionEntry } from "@/lib/actions/skills-observatory";

type Props = {
  skills: SkillEntry[];
  finishingPasses: FinishingPassEntry[];
  specialistExecutions: SkillExecutionEntry[];
  stats: {
    totalSkills: number;
    userFacing: number;
    universal: number;
    specialistInternal: number;
    routes: number;
    totalToolExecutions: number;
    totalBuildActivities: number;
  };
};

type TabId = "catalog" | "passes" | "executions";

const AUDIENCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  user: { bg: "color-mix(in srgb, var(--dpf-success) 12%, transparent)", text: "var(--dpf-success)", label: "User-Facing" },
  universal: { bg: "color-mix(in srgb, var(--dpf-info) 12%, transparent)", text: "var(--dpf-info)", label: "Universal" },
  "specialist-internal": { bg: "color-mix(in srgb, var(--dpf-warning) 12%, transparent)", text: "var(--dpf-warning)", label: "Specialist" },
};

export function SkillsObservatoryPanel({ skills, finishingPasses, specialistExecutions, stats }: Props) {
  const [tab, setTab] = useState<TabId>("catalog");
  const [audienceFilter, setAudienceFilter] = useState<string | null>(null);
  const [routeFilter, setRouteFilter] = useState<string | null>(null);

  const routes = [...new Set(skills.map((s) => s.route))].sort();
  const filtered = skills.filter((s) => {
    if (audienceFilter && s.audience !== audienceFilter) return false;
    if (routeFilter && s.route !== routeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Skills" value={stats.totalSkills} />
        <StatCard label="User-Facing" value={stats.userFacing} accent="var(--dpf-success)" />
        <StatCard label="Specialist-Internal" value={stats.specialistInternal} accent="var(--dpf-warning)" />
        <StatCard label="Routes Covered" value={stats.routes} accent="var(--dpf-info)" />
      </div>

      {/* Tab selector */}
      <div role="tablist" aria-label="Observatory views" className="flex gap-1 border-b border-[var(--dpf-border)]">
        {([
          { id: "catalog" as TabId, label: "Skills Catalog", count: skills.length },
          { id: "passes" as TabId, label: "Finishing Passes", count: finishingPasses.length },
          { id: "executions" as TabId, label: "Specialist Executions", count: specialistExecutions.length },
        ]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const tabs: TabId[] = ["catalog", "passes", "executions"];
              const idx = tabs.indexOf(tab);
              if (e.key === "ArrowRight") setTab(tabs[(idx + 1) % tabs.length]!);
              if (e.key === "ArrowLeft") setTab(tabs[(idx - 1 + tabs.length) % tabs.length]!);
            }}
            className="px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
            style={{
              color: tab === t.id ? "var(--dpf-text)" : "var(--dpf-muted)",
              borderBottom: tab === t.id ? "2px solid var(--dpf-accent)" : "2px solid transparent",
            }}
          >
            {t.label} <span className="text-[var(--dpf-muted)] ml-1">({t.count})</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "catalog" && (
        <div className="space-y-3 animate-fade-in">
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <FilterButton label="All" active={!audienceFilter} onClick={() => setAudienceFilter(null)} />
            <FilterButton label="User-Facing" active={audienceFilter === "user"} onClick={() => setAudienceFilter("user")} />
            <FilterButton label="Universal" active={audienceFilter === "universal"} onClick={() => setAudienceFilter("universal")} />
            <FilterButton label="Specialist" active={audienceFilter === "specialist-internal"} onClick={() => setAudienceFilter("specialist-internal")} />
            <select
              value={routeFilter ?? ""}
              onChange={(e) => setRouteFilter(e.target.value || null)}
              className="text-xs px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)]"
              aria-label="Filter by route"
            >
              <option value="">All routes</option>
              {routes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Skills list */}
          {filtered.map((skill, i) => {
            const style = AUDIENCE_STYLES[skill.audience] ?? AUDIENCE_STYLES.user!;
            return (
              <SkillRow key={`${skill.route}-${skill.label}-${i}`} skill={skill} style={style} />
            );
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-[var(--dpf-muted)] text-center py-8">No skills match the current filters.</p>
          )}
        </div>
      )}

      {tab === "passes" && (
        <div className="space-y-2 animate-fade-in">
          {finishingPasses.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)] text-center py-8">No finishing pass activity recorded yet.</p>
          ) : (
            finishingPasses.map((fp) => (
              <div key={fp.id} className="flex items-start gap-2 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs">
                <span
                  className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                  style={{ background: fp.passType ? "var(--dpf-success)" : "var(--dpf-muted)" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--dpf-text)]">{fp.tool}</span>
                    {fp.passType && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--dpf-accent) 12%, transparent)", color: "var(--dpf-accent)" }}>
                        {fp.passType}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--dpf-muted)] ml-auto shrink-0">
                      {new Date(fp.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--dpf-text-secondary)] mt-0.5 leading-relaxed">{fp.summary}</p>
                  <span className="text-[10px] text-[var(--dpf-muted)]">Build: {fp.buildId}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "executions" && (
        <div className="space-y-2 animate-fade-in">
          {specialistExecutions.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)] text-center py-8">No specialist executions recorded yet.</p>
          ) : (
            specialistExecutions.map((ex) => (
              <div key={ex.id} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: ex.success ? "var(--dpf-success)" : "var(--dpf-error)" }}
                />
                <span className="text-xs font-medium text-[var(--dpf-text)] w-24 shrink-0">{ex.agentId}</span>
                <span className="text-xs text-[var(--dpf-text-secondary)] flex-1 truncate">{ex.toolName}</span>
                {ex.durationMs !== null && (
                  <span className="text-[10px] text-[var(--dpf-muted)]">{ex.durationMs}ms</span>
                )}
                <span className="text-[10px] text-[var(--dpf-muted)] shrink-0">
                  {new Date(ex.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="px-4 py-3 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs">
      <div className="text-xl font-bold" style={{ color: accent ?? "var(--dpf-text)" }}>{value}</div>
      <div className="text-xs text-[var(--dpf-muted)]">{label}</div>
    </div>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 text-xs rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]"
      style={{
        background: active ? "color-mix(in srgb, var(--dpf-accent) 15%, transparent)" : "transparent",
        borderColor: active ? "var(--dpf-accent)" : "var(--dpf-border)",
        color: active ? "var(--dpf-accent)" : "var(--dpf-muted)",
      }}
    >
      {label}
    </button>
  );
}

function SkillRow({ skill, style }: { skill: SkillEntry; style: { bg: string; text: string; label: string } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs animate-slide-up">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--dpf-surface-3)] transition-colors rounded"
        aria-expanded={expanded}
      >
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium"
          style={{ background: style.bg, color: style.text }}
        >
          {style.label}
        </span>
        <span className="text-xs font-medium text-[var(--dpf-text)] flex-1">{skill.label}</span>
        <span className="text-[10px] text-[var(--dpf-muted)] shrink-0">{skill.route}</span>
        <span className="text-[10px] text-[var(--dpf-muted)]">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pt-0 border-t border-[var(--dpf-border)] animate-fade-in">
          <p className="text-xs text-[var(--dpf-text-secondary)] mt-2">{skill.description}</p>
          {skill.capability && (
            <p className="text-[10px] text-[var(--dpf-muted)] mt-1">Requires: <span className="font-mono">{skill.capability}</span></p>
          )}
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">Task type: {skill.taskType}</p>
          <details className="mt-2">
            <summary className="text-[10px] text-[var(--dpf-muted)] cursor-pointer hover:text-[var(--dpf-text-secondary)]">View prompt</summary>
            <pre className="text-[10px] text-[var(--dpf-text-secondary)] whitespace-pre-wrap leading-relaxed mt-1 p-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] max-h-40 overflow-auto">
              {skill.prompt}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles** — `pnpm exec tsc --noEmit`
- [ ] **Step 3: Commit** — `feat(tak): skills observatory panel component`

---

## Task 4: Create Observatory Page

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/skills/page.tsx`

- [ ] **Step 1: Create the directory and page**

```typescript
// apps/web/app/(shell)/platform/ai/skills/page.tsx
import { AiTabNav } from "@/components/platform/AiTabNav";
import { SkillsObservatoryPanel } from "@/components/platform/SkillsObservatoryPanel";
import {
  getSkillsCatalog,
  getFinishingPassActivity,
  getSpecialistExecutions,
  getSkillsObservatoryStats,
} from "@/lib/actions/skills-observatory";

export default async function SkillsObservatoryPage() {
  const [skills, finishingPasses, executions, stats] = await Promise.all([
    getSkillsCatalog(),
    getFinishingPassActivity(),
    getSpecialistExecutions(),
    getSkillsObservatoryStats(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Workforce</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          TAK Skills Observatory — {stats.totalSkills} skills across {stats.routes} routes
        </p>
      </div>

      <AiTabNav />

      <SkillsObservatoryPanel
        skills={skills}
        finishingPasses={JSON.parse(JSON.stringify(finishingPasses))}
        specialistExecutions={JSON.parse(JSON.stringify(executions))}
        stats={stats}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify page loads** — navigate to `/platform/ai/skills`
- [ ] **Step 3: Verify TypeScript compiles** — `pnpm exec tsc --noEmit`
- [ ] **Step 4: Commit** — `feat(tak): skills observatory page at /platform/ai/skills`

---

## Task 5: Permission Gate the Page

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/skills/layout.tsx`

- [ ] **Step 1: Add layout with permission check**

```typescript
// apps/web/app/(shell)/platform/ai/skills/layout.tsx
import { getUserContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { notFound } from "next/navigation";

export default async function SkillsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUserContext();
  if (!user || !can(user, "view_admin")) return notFound();
  return <>{children}</>;
}
```

- [ ] **Step 2: Verify non-admin users get 404** — test with a non-admin role
- [ ] **Step 3: Commit** — `feat(tak): permission gate skills observatory to admin`

---

## Task 6: Final Verification and Commit

- [ ] **Step 1: Full TypeScript check** — `pnpm exec tsc --noEmit`
- [ ] **Step 2: Navigate to `/platform/ai/skills`** and verify:
  - Stats row shows correct counts
  - Skills Catalog tab lists all skills with audience badges
  - Audience filter buttons work
  - Route filter dropdown works
  - Expanding a skill shows description, capability, prompt
  - Specialist-internal skills show warning-colored badge
  - Finishing Passes tab shows build activity
  - Specialist Executions tab shows tool execution log
- [ ] **Step 3: Verify design token compliance** — no hardcoded hex colors, all `var(--dpf-*)`
- [ ] **Step 4: Final commit** — `feat(tak): TAK Skills Observatory — admin visibility into specialist capabilities`

---

## Future Phases (Not In This Plan)

### Phase 2: Real-Time Specialist Execution Tracking
- SSE subscription to agent event bus for live specialist progress
- "Currently executing" indicator per specialist
- Time elapsed, estimated completion

### Phase 3: Finishing Pass Structured Logging
- New `SpecialistFinishingPass` Prisma model (schema migration)
- Structured pass results (issues found, issues fixed, file paths)
- Pass-over-time trends and regression detection

### Phase 4: Capability Heatmap
- Matrix: Specialists x Task Types
- Cell color = instruction phase (learning/practicing/innate)
- Cell value = avg evaluation score
- Drill-down to AgentPerformance details

### Phase 5: Delegation Graph
- Force-directed graph of specialist delegation chains
- Edge weight = delegation frequency
- Bottleneck highlighting
