# EP-QUALITY-001: Quality Feedback & Error Reporting — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three-path error/feedback capture (AI-assisted, manual fallback, crash boundary) with localStorage queue resilience and route-to-owner resolution.

**Architecture:** New `PlatformIssueReport` Prisma model. Slim POST endpoint (`/api/quality/report`) with no auth. Client-side `FeedbackForm` (zero dependencies) for failsafe. Crash boundary `error.tsx` with inlined form. `FeedbackButton` opens AI co-worker or falls back to form. "Report an issue" skill added to every agent. `QueueFlusher` client component flushes localStorage on mount.

**Tech Stack:** Next.js 14 App Router, Prisma 5, TypeScript (strict), React 18.

**Spec:** `docs/superpowers/specs/2026-03-14-quality-feedback-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/<ts>_platform_issue_report/migration.sql` | PlatformIssueReport table |
| `apps/web/app/api/quality/report/route.ts` | Slim POST endpoint (no auth, size limits) |
| `apps/web/lib/actions/quality.ts` | `reportQualityIssue` server action with route resolution |
| `apps/web/lib/quality-queue.ts` | Client-side localStorage queue + flush |
| `apps/web/components/feedback/FeedbackForm.tsx` | Simple form (zero external deps) |
| `apps/web/components/feedback/FeedbackButton.tsx` | Floating button, opens co-worker or form |
| `apps/web/components/feedback/QueueFlusher.tsx` | Client component: flush queue on mount |
| `apps/web/app/(shell)/error.tsx` | Crash boundary with inlined form + auto-report |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `PlatformIssueReport` model; add reverse relation to `User` |
| `apps/web/lib/agent-routing.ts` | Add "Report an issue" skill to every agent |
| `apps/web/components/agent/AgentCoworkerShell.tsx` | Listen for `open-agent-feedback` event |
| `apps/web/app/(shell)/layout.tsx` | Render `FeedbackButton` + `QueueFlusher` |

---

## Chunk 1: Schema + Slim Endpoint

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `PlatformIssueReport` model**

In `packages/db/prisma/schema.prisma`, add before the `// ─── Platform Configuration` section:

```prisma
// ─── Platform Issue Reporting ────────────────────────────────────────────────

model PlatformIssueReport {
  id               String   @id @default(cuid())
  reportId         String   @unique
  type             String   // "runtime_error" | "user_report" | "feedback"
  severity         String   @default("medium")
  status           String   @default("open")
  title            String
  description      String?  @db.Text
  routeContext     String?
  errorStack       String?  @db.Text
  userAgent        String?
  reportedById     String?
  reportedBy       User?    @relation(fields: [reportedById], references: [id])
  digitalProductId String?
  portfolioId      String?
  agentId          String?
  source           String   @default("manual")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

- [ ] **Step 2: Add reverse relation to User model**

In the `User` model, add after `requestedPasswordResetTokens`:
```prisma
  issueReports    PlatformIssueReport[]
```

- [ ] **Step 3: Generate and apply migration**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter @dpf/db exec npx prisma generate
cd d:/OpenDigitalProductFactory && pnpm --filter @dpf/db exec npx prisma migrate dev --name platform_issue_report
```

If migrate dev fails (shadow DB issue), apply manually and resolve.

- [ ] **Step 4: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add packages/db/prisma/ && git commit -m "feat(db): add PlatformIssueReport model for quality feedback"
```

---

### Task 2: Slim API Endpoint

**Files:**
- Create: `apps/web/app/api/quality/report/route.ts`

- [ ] **Step 1: Create the endpoint**

Create `apps/web/app/api/quality/report/route.ts`:

```typescript
import { prisma } from "@dpf/db";

export async function POST(request: Request) {
  try {
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > 65536) {
      return Response.json({ ok: false, error: "Too large" }, { status: 413 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const reportId = "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();

    await prisma.platformIssueReport.create({
      data: {
        reportId,
        type: String(body.type ?? "user_report").slice(0, 50),
        severity: String(body.severity ?? "medium").slice(0, 20),
        title: String(body.title ?? "Untitled report").slice(0, 500),
        description: body.description ? String(body.description).slice(0, 10000) : null,
        routeContext: body.routeContext ? String(body.routeContext).slice(0, 500) : null,
        errorStack: body.errorStack ? String(body.errorStack).slice(0, 20000) : null,
        userAgent: body.userAgent ? String(body.userAgent).slice(0, 500) : null,
        reportedById: typeof body.userId === "string" ? body.userId : null,
        source: String(body.source ?? "manual").slice(0, 30),
        portfolioId: typeof body.portfolioId === "string" ? body.portfolioId : null,
        digitalProductId: typeof body.digitalProductId === "string" ? body.digitalProductId : null,
      },
    });
    return Response.json({ ok: true, reportId });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/app/api/quality/report/route.ts && git commit -m "feat: add slim /api/quality/report endpoint (no auth, resilient)"
```

---

### Task 3: Server Action with Route Resolution

**Files:**
- Create: `apps/web/lib/actions/quality.ts`

- [ ] **Step 1: Create the server action**

Create `apps/web/lib/actions/quality.ts`:

```typescript
"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

const ROUTE_PORTFOLIO_MAP: Record<string, string> = {
  "/portfolio": "foundational",
  "/ea": "foundational",
  "/inventory": "foundational",
  "/platform": "foundational",
  "/admin": "foundational",
  "/ops": "manufacturing_and_delivery",
  "/employee": "for_employees",
  "/customer": "products_and_services_sold",
};

function resolvePortfolioSlug(routeContext: string): string | null {
  for (const [prefix, slug] of Object.entries(ROUTE_PORTFOLIO_MAP)) {
    if (routeContext === prefix || routeContext.startsWith(prefix + "/")) {
      return slug;
    }
  }
  return null;
}

export async function reportQualityIssue(input: {
  type: "runtime_error" | "user_report" | "feedback";
  title: string;
  description?: string;
  severity?: string;
  routeContext: string;
  errorStack?: string;
  source?: string;
}): Promise<{ reportId: string } | { error: string }> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const reportId = "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();

  // Best-effort route-to-owner resolution
  let portfolioId: string | null = null;
  const slug = resolvePortfolioSlug(input.routeContext);
  if (slug) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug },
      select: { id: true },
    });
    portfolioId = portfolio?.id ?? null;
  }

  try {
    await prisma.platformIssueReport.create({
      data: {
        reportId,
        type: input.type,
        severity: input.severity ?? "medium",
        title: input.title.slice(0, 500),
        description: input.description?.slice(0, 10000) ?? null,
        routeContext: input.routeContext,
        errorStack: input.errorStack?.slice(0, 20000) ?? null,
        reportedById: userId,
        source: input.source ?? "ai_assisted",
        portfolioId,
      },
    });
    return { reportId };
  } catch {
    return { error: "Failed to create report" };
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/actions/quality.ts && git commit -m "feat: add reportQualityIssue server action with route-to-owner resolution"
```

---

## Chunk 2: Client Components

### Task 4: localStorage Queue

**Files:**
- Create: `apps/web/lib/quality-queue.ts`

- [ ] **Step 1: Create the queue module**

Create `apps/web/lib/quality-queue.ts`:

```typescript
const QUEUE_KEY = "dpf-quality-queue";

type QueuedReport = {
  type: string;
  title: string;
  description?: string;
  severity?: string;
  routeContext?: string;
  errorStack?: string;
  source?: string;
  userAgent?: string;
  userId?: string;
  queuedAt: string;
};

export function queueReport(report: Omit<QueuedReport, "queuedAt">): void {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    let queue: QueuedReport[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) queue = parsed;
      } catch {
        // Corrupt data — discard
      }
    }
    queue.push({ ...report, queuedAt: new Date().toISOString() });
    // Keep max 50 queued reports
    if (queue.length > 50) queue = queue.slice(-50);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

export async function flushQueue(): Promise<number> {
  let flushed = 0;
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return 0;
    let queue: QueuedReport[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem(QUEUE_KEY);
        return 0;
      }
      queue = parsed;
    } catch {
      localStorage.removeItem(QUEUE_KEY);
      return 0;
    }

    const remaining: QueuedReport[] = [];
    for (const report of queue) {
      try {
        const res = await fetch("/api/quality/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report),
        });
        if (res.ok) {
          flushed++;
        } else {
          remaining.push(report);
        }
      } catch {
        remaining.push(report);
      }
    }

    if (remaining.length > 0) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    } else {
      localStorage.removeItem(QUEUE_KEY);
    }
  } catch {
    // Silent fail
  }
  return flushed;
}

export async function submitReport(report: Omit<QueuedReport, "queuedAt">): Promise<{ ok: boolean; reportId?: string }> {
  try {
    const res = await fetch("/api/quality/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...report,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; reportId?: string };
      return data;
    }
    queueReport(report);
    return { ok: false };
  } catch {
    queueReport(report);
    return { ok: false };
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/quality-queue.ts && git commit -m "feat: add client-side quality report queue with localStorage resilience"
```

---

### Task 5: FeedbackForm (Zero Dependencies)

**Files:**
- Create: `apps/web/components/feedback/FeedbackForm.tsx`

- [ ] **Step 1: Create the form component**

Create `apps/web/components/feedback/FeedbackForm.tsx`:

```typescript
"use client";

import { useState } from "react";
import { submitReport } from "@/lib/quality-queue";

type Props = {
  routeContext: string;
  userId?: string | null;
  errorMessage?: string;
  errorStack?: string;
  source?: string;
  onClose?: () => void;
};

export function FeedbackForm({ routeContext, userId, errorMessage, errorStack, source, onClose }: Props) {
  const [type, setType] = useState<string>(errorMessage ? "runtime_error" : "user_report");
  const [description, setDescription] = useState(errorMessage ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function handleSubmit() {
    const result = await submitReport({
      type,
      title: description.slice(0, 100) || "User report",
      description,
      severity: type === "runtime_error" ? "high" : "medium",
      routeContext,
      errorStack: errorStack ?? undefined,
      source: source ?? "manual",
      userId: userId ?? undefined,
    });
    if (result.ok && result.reportId) {
      setReportId(result.reportId);
    } else {
      setQueued(true);
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#e0e0ff", fontSize: 13 }}>
        {reportId
          ? `Thanks! Report ${reportId} filed. The platform team has been notified.`
          : "Saved — will be sent when connectivity is restored."}
        {onClose && (
          <button type="button" onClick={onClose} style={{ display: "block", margin: "12px auto 0", background: "none", border: "1px solid rgba(42,42,64,0.6)", borderRadius: 6, padding: "4px 12px", color: "#e0e0ff", fontSize: 12, cursor: "pointer" }}>
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 12, fontSize: 13, color: "#e0e0ff" }}>
      <div style={{ marginBottom: 8 }}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ width: "100%", background: "rgba(15,15,26,0.8)", border: "1px solid rgba(42,42,64,0.6)", borderRadius: 6, padding: "6px 8px", color: "#e0e0ff", fontSize: 12 }}
        >
          <option value="runtime_error">Bug Report</option>
          <option value="feedback">Suggestion</option>
          <option value="user_report">Question</option>
        </select>
      </div>
      <div style={{ marginBottom: 8 }}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what happened or what you'd like to see..."
          rows={4}
          style={{ width: "100%", background: "rgba(15,15,26,0.8)", border: "1px solid rgba(42,42,64,0.6)", borderRadius: 6, padding: "6px 8px", color: "#e0e0ff", fontSize: 12, resize: "vertical" }}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!description.trim()}
          style={{ flex: 1, background: "var(--dpf-accent)", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, color: "#fff", cursor: description.trim() ? "pointer" : "not-allowed", opacity: description.trim() ? 1 : 0.5 }}
        >
          Submit
        </button>
        {onClose && (
          <button type="button" onClick={onClose} style={{ background: "none", border: "1px solid rgba(42,42,64,0.6)", borderRadius: 6, padding: "6px 12px", fontSize: 12, color: "#e0e0ff", cursor: "pointer" }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/feedback/FeedbackForm.tsx && git commit -m "feat: add FeedbackForm component (zero external dependencies)"
```

---

### Task 6: FeedbackButton + QueueFlusher

**Files:**
- Create: `apps/web/components/feedback/FeedbackButton.tsx`
- Create: `apps/web/components/feedback/QueueFlusher.tsx`

- [ ] **Step 1: Create FeedbackButton**

Create `apps/web/components/feedback/FeedbackButton.tsx`:

```typescript
"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { FeedbackForm } from "./FeedbackForm";

type Props = {
  userId?: string | null;
};

export function FeedbackButton({ userId }: Props) {
  const pathname = usePathname();
  const [showForm, setShowForm] = useState(false);

  function handleClick() {
    // Try to open AI co-worker with feedback prompt
    const event = new CustomEvent("open-agent-feedback");
    document.dispatchEvent(event);

    // Fallback: if panel doesn't open (no listener, not hydrated, no provider),
    // show the simple form after a short delay
    setTimeout(() => {
      // Check if co-worker panel opened by looking for it in the DOM
      const panel = document.querySelector("[data-agent-panel]");
      if (!panel) {
        setShowForm(true);
      }
    }, 500);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Send feedback"
        style={{
          position: "fixed",
          left: 16,
          bottom: 16,
          padding: "6px 14px",
          borderRadius: 16,
          background: "rgba(136, 136, 160, 0.4)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          border: "1px solid rgba(136, 136, 160, 0.25)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          zIndex: 49,
          color: "rgba(224, 224, 255, 0.8)",
          fontSize: 11,
          fontWeight: 400,
        }}
      >
        Feedback
      </button>

      {showForm && (
        <div style={{
          position: "fixed",
          left: 16,
          bottom: 50,
          width: 300,
          background: "rgba(26, 26, 46, 0.9)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(42, 42, 64, 0.6)",
          borderRadius: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          zIndex: 50,
          overflow: "hidden",
        }}>
          <div style={{ padding: "10px 12px 0", fontSize: 12, fontWeight: 600, color: "#e0e0ff" }}>
            Send Feedback
          </div>
          <FeedbackForm
            routeContext={pathname}
            userId={userId}
            source="manual"
            onClose={() => setShowForm(false)}
          />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Create QueueFlusher**

Create `apps/web/components/feedback/QueueFlusher.tsx`:

```typescript
"use client";

import { useEffect } from "react";
import { flushQueue } from "@/lib/quality-queue";

export function QueueFlusher() {
  useEffect(() => {
    flushQueue().catch(() => {});
  }, []);
  return null;
}
```

- [ ] **Step 3: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/components/feedback/ && git commit -m "feat: add FeedbackButton, QueueFlusher for quality reporting"
```

---

## Chunk 3: Crash Boundary + Integration

### Task 7: Crash Boundary (error.tsx)

**Files:**
- Create: `apps/web/app/(shell)/error.tsx`

- [ ] **Step 1: Create the error boundary**

Create `apps/web/app/(shell)/error.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  // Auto-report on mount (fire-and-forget)
  useEffect(() => {
    const body = {
      type: "runtime_error",
      severity: "critical",
      title: error.message?.slice(0, 200) || "Page crash",
      description: error.message,
      routeContext: typeof window !== "undefined" ? window.location.pathname : null,
      errorStack: error.stack?.slice(0, 20000),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      source: "crash_boundary",
    };
    fetch("/api/quality/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // Queue to localStorage if fetch fails
      try {
        const key = "dpf-quality-queue";
        const raw = localStorage.getItem(key);
        const queue = raw ? JSON.parse(raw) : [];
        if (Array.isArray(queue)) {
          queue.push({ ...body, queuedAt: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(queue));
        }
      } catch { /* silent */ }
    });
  }, [error]);

  async function handleSubmit() {
    try {
      const res = await fetch("/api/quality/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "user_report",
          severity: "high",
          title: description.slice(0, 100) || "User report from error page",
          description,
          routeContext: typeof window !== "undefined" ? window.location.pathname : null,
          errorStack: error.stack?.slice(0, 20000),
          source: "crash_boundary",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setReportId(data.reportId);
      }
    } catch { /* silent */ }
    setSubmitted(true);
  }

  return (
    <div style={{
      minHeight: "60vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    }}>
      <div style={{
        maxWidth: 480,
        width: "100%",
        background: "rgba(26, 26, 46, 0.9)",
        border: "1px solid rgba(42, 42, 64, 0.6)",
        borderRadius: 16,
        padding: "32px 28px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>!</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "#e0e0ff", marginBottom: 8 }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginBottom: 20 }}>
          The platform team has been automatically notified.
          You can also describe what happened below.
        </p>

        {!submitted ? (
          <>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What were you doing when this happened? (optional)"
              rows={3}
              style={{
                width: "100%",
                background: "rgba(15,15,26,0.8)",
                border: "1px solid rgba(42,42,64,0.6)",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#e0e0ff",
                fontSize: 12,
                resize: "vertical",
                marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                type="button"
                onClick={handleSubmit}
                style={{
                  background: "var(--dpf-accent)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 20px",
                  fontSize: 13,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Send feedback
              </button>
              <button
                type="button"
                onClick={reset}
                style={{
                  background: "none",
                  border: "1px solid rgba(42,42,64,0.6)",
                  borderRadius: 8,
                  padding: "8px 20px",
                  fontSize: 13,
                  color: "#e0e0ff",
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
            {reportId
              ? `Thanks! Report ${reportId} filed.`
              : "Thanks for the feedback."}
            <button
              type="button"
              onClick={reset}
              style={{
                display: "block",
                margin: "16px auto 0",
                background: "var(--dpf-accent)",
                border: "none",
                borderRadius: 8,
                padding: "8px 20px",
                fontSize: 13,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add "apps/web/app/(shell)/error.tsx" && git commit -m "feat: add crash boundary with auto-report and inline feedback form"
```

---

### Task 8: Add "Report an issue" Skill to All Agents

**Files:**
- Modify: `apps/web/lib/agent-routing.ts`

- [ ] **Step 1: Add the feedback skill to every agent's skills array**

In `apps/web/lib/agent-routing.ts`, add this skill to the `skills` array of every entry in `ROUTE_AGENT_MAP` (all 9 agents):

```typescript
    { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
```

Add it as the last skill in each agent's array.

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/lib/agent-routing.ts && git commit -m "feat: add Report an issue skill to all route agents"
```

---

### Task 9: Wire into Shell Layout + AgentCoworkerShell

**Files:**
- Modify: `apps/web/app/(shell)/layout.tsx`
- Modify: `apps/web/components/agent/AgentCoworkerShell.tsx`

- [ ] **Step 1: Add FeedbackButton and QueueFlusher to shell layout**

In `apps/web/app/(shell)/layout.tsx`, add imports:
```typescript
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { QueueFlusher } from "@/components/feedback/QueueFlusher";
```

Then add after the `AgentCoworkerShell` render (before closing `</div>`):
```tsx
      <FeedbackButton userId={user.id} />
      <QueueFlusher />
```

- [ ] **Step 2: Add data-agent-panel attribute and feedback event listener to AgentCoworkerShell**

In `apps/web/components/agent/AgentCoworkerShell.tsx`, add a `data-agent-panel` attribute to the panel div so the `FeedbackButton` can detect it:

On the panel wrapper div (the one with `isOpen &&`), add `data-agent-panel="true"`.

Add a `useEffect` to listen for the `open-agent-feedback` event:
```typescript
  // Listen for feedback button
  useEffect(() => {
    function handleFeedback() {
      setIsOpen(true);
      localStorage.setItem(LS_KEY_OPEN, "true");
    }
    document.addEventListener("open-agent-feedback", handleFeedback);
    return () => document.removeEventListener("open-agent-feedback", handleFeedback);
  }, []);
```

- [ ] **Step 3: Verify types and run tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
cd d:/OpenDigitalProductFactory && pnpm test
```

- [ ] **Step 4: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add "apps/web/app/(shell)/layout.tsx" apps/web/components/agent/AgentCoworkerShell.tsx && git commit -m "feat: wire FeedbackButton and QueueFlusher into shell layout"
```

---

## Chunk 4: Verification

### Task 10: Final Verification

- [ ] **Step 1: Run all tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm test
```

- [ ] **Step 2: Type check**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Visual verification**

Start dev server and verify:
1. Feedback button visible at bottom-left
2. Click feedback → AI co-worker opens (if provider active) or simple form appears
3. Submit feedback → "PIR-XXXXX" report created
4. Navigate to a broken route / throw an error → crash boundary shows with form
5. Submit from crash boundary → report created
6. Kill the server, try feedback → queued to localStorage
7. Restart server, reload page → queued report flushed
