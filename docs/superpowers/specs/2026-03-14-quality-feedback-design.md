# EP-QUALITY-001: Product Quality Feedback and Error Reporting — Design Spec

**Date:** 2026-03-14
**Goal:** Capture runtime errors, user-reported issues, and feedback through three resilient paths (AI-assisted, manual fallback, crash boundary). Route issues to the responsible digital product owner via the taxonomy. Client-side localStorage queue ensures nothing is lost even when the server is down.

---

## 1. Three Error Capture Paths

| Path | Trigger | Experience | Dependencies |
|------|---------|-----------|-------------|
| **AI-assisted** | User clicks feedback button OR runtime error auto-detected | AI co-worker opens, agent guides conversation, creates structured report | LLM provider active, panel functional |
| **Manual fallback** | AI providers unavailable OR user preference | Simple inline form (type dropdown, text area, submit). No LLM, no panel. | `/api/quality/report` endpoint only |
| **Crash boundary** | Page fails to render (unhandled exception) | Next.js `error.tsx` shows clean error page with embedded form | `/api/quality/report` endpoint only. No component dependencies. |

All three paths write to the same `PlatformIssueReport` model. The AI path produces richer context (agent extracts route, recent user actions, error stack, severity assessment). The manual/crash paths capture basics (route, user, timestamp, description).

**Note on naming:** The codebase already has a `PortfolioQualityIssue` model for automated portfolio data-quality issues from discovery attribution. The new `PlatformIssueReport` model serves a different purpose: user-reported bugs, runtime errors, and feedback. The names are deliberately distinct to avoid confusion.

### Client-Side Resilience

```
User action or error detected
  -> Try POST /api/quality/report
    -> Success: done
    -> Failure (network/server down):
      -> Queue to localStorage ("dpf-quality-queue")
        -> try/catch around setItem (localStorage may be full)
        -> validate JSON integrity on read (corrupt data -> discard)
      -> On next successful page load:
        -> Flush queued items to /api/quality/report
        -> Remove from queue on success
```

The localStorage queue is a JSON array of pending reports. A dedicated `<QueueFlusher />` client component rendered in the shell layout checks for queued items on mount and flushes them silently. (The shell layout itself is a server component and cannot use `useEffect` — the flusher is a separate client component.)

---

## 2. Schema: PlatformIssueReport

New Prisma model (**migration required**):

```prisma
model PlatformIssueReport {
  id               String   @id @default(cuid())
  reportId         String   @unique // "PIR-" + short random (human-readable)
  type             String   // "runtime_error" | "user_report" | "feedback"
  severity         String   @default("medium") // "critical" | "high" | "medium" | "low"
  status           String   @default("open")   // "open" | "acknowledged" | "resolved"
  title            String
  description      String?  @db.Text // allow longer descriptions
  routeContext     String?  // pathname where the issue occurred
  errorStack       String?  @db.Text // sanitized stack trace for runtime errors
  userAgent        String?  // browser info for debugging
  reportedById     String?  // userId — null for unauthenticated crash reports
  reportedBy       User?    @relation(fields: [reportedById], references: [id])
  digitalProductId String?  // auto-resolved from route via taxonomy (soft ref, no FK)
  portfolioId      String?  // auto-resolved from route (soft ref, no FK)
  agentId          String?  // which agent assisted (soft ref, no FK)
  source           String   @default("manual") // "manual" | "ai_assisted" | "auto_detected" | "crash_boundary"
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

The `User` model must also gain a reverse relation field: `issueReports PlatformIssueReport[]`.

**Design decisions:**
- `reportId` uses a human-readable format `PIR-XXXXX` (not a CUID) so users and agents can reference it conversationally ("I've filed this as PIR-A7F3K")
- No FK constraints on `digitalProductId`, `portfolioId`, or `agentId` — these are best-effort soft references. The slim endpoint must work even if resolution fails.
- `description` and `errorStack` use `@db.Text` for longer content

---

## 3. Slim API Endpoint: `/api/quality/report`

**File:** `apps/web/app/api/quality/report/route.ts`

A minimal POST endpoint that bypasses all middleware. No auth session lookup, no server components, no complex imports. Just parse the JSON body and write to Prisma.

**Protections (minimal but necessary):**
- Reject bodies larger than 64KB (`Content-Length` check)
- Truncate `title` to 500 chars, `description` to 10,000 chars, `errorStack` to 20,000 chars
- No rate limiting in v1 (add as backlog item for future hardening)

```typescript
export async function POST(request: Request) {
  try {
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > 65536) {
      return Response.json({ ok: false, error: "Too large" }, { status: 413 });
    }

    const body = await request.json();
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
        reportedById: body.userId ?? null,
        source: String(body.source ?? "manual").slice(0, 30),
        portfolioId: body.portfolioId ?? null,
        digitalProductId: body.digitalProductId ?? null,
      },
    });
    return Response.json({ ok: true, reportId });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
```

---

## 4. Server Action: `reportQualityIssue`

**File:** `apps/web/lib/actions/quality.ts`

Full-featured server action used by the AI-assisted path. Has auth context, route-to-owner resolution, and richer data.

```typescript
"use server"
export async function reportQualityIssue(input: {
  type: "runtime_error" | "user_report" | "feedback";
  title: string;
  description?: string;
  severity?: string;
  routeContext: string;
  errorStack?: string;
  source?: string;
}): Promise<{ reportId: string } | { error: string }>
```

**Route-to-owner resolution** maps route prefixes to portfolios:

| Route Prefix | Portfolio |
|-------------|-----------|
| `/portfolio` | Resolved from the slug in URL |
| `/ea` | foundational |
| `/ops` | manufacturing_and_delivery |
| `/inventory` | foundational |
| `/employee` | for_employees |
| `/customer` | products_and_services_sold |
| `/platform` | foundational |
| `/admin` | foundational |
| `/workspace` | null (general, no specific owner) |
| unmapped | null |

Best-effort — if resolution fails, the report is still created without attribution.

---

## 5. Feedback Button

**File:** `apps/web/components/feedback/FeedbackButton.tsx`

A small floating button fixed to the bottom-left corner. Semi-transparent pill matching the AI FAB styling.

**Visual:** "Feedback" text with speech bubble icon. Same `rgba` + `backdrop-filter` as the AI FAB.

**On click:**
1. Try to open the AI co-worker panel with a feedback prompt
2. Dispatch `CustomEvent("open-agent-feedback")` — the `AgentCoworkerShell` listens for this
3. **If the panel doesn't open within 500ms** (shell not hydrated, or no event listener registered): fall back to showing the inline `FeedbackForm` directly. This handles the hydration race condition — the button doesn't assume the shell is ready.
4. **If no LLM provider is active**: the shell opens but the agent uses canned response mode. The feedback still works — the form is the fallback.

---

## 6. Feedback Form (Failsafe + Crash Boundary)

**File:** `apps/web/components/feedback/FeedbackForm.tsx`

A simple, self-contained form. **Zero external component imports.** Uses only React and inline styles.

**Fields:**
- Type: dropdown — Bug / Suggestion / Question
- Description: text area
- Submit button

**Auto-populated (hidden):** route context (`window.location.pathname`), timestamp, user agent, userId (passed as prop, may be null)

**Submit flow:**
1. POST to `/api/quality/report`
2. On success: show "Thanks! The platform team has been notified. (Report: PIR-XXXXX)"
3. On failure: queue to localStorage, show "Saved — will be sent when connectivity is restored."

---

## 7. Crash Boundary

**File:** `apps/web/app/(shell)/error.tsx`

Next.js error boundary at the shell layout level. When a page completely fails:

- Shows a clean, branded error page using **only inline styles and direct CSS variable references** — no Tailwind, no component imports beyond the `FeedbackForm` (which itself has zero external dependencies)
- Heading: "Something went wrong"
- Subtext: "The platform team has been notified. You can also describe what happened below."
- Inlined feedback form (same fields as `FeedbackForm` but written directly in `error.tsx` with no imports — safest approach for a crash boundary)
- Auto-populates: error message, route, error stack (sanitized — no file paths or secrets)
- "Try again" button that calls `reset()` (Next.js error boundary reset)

**Auto-report on mount:** The error boundary fires a POST to `/api/quality/report` with `source: "crash_boundary"` on mount (fire-and-forget). Error is captured even if the user doesn't fill in the form. If the POST fails, it queues to localStorage.

**Important:** The form in `error.tsx` is **inlined, not imported from FeedbackForm.tsx**. This ensures the crash boundary works even if `FeedbackForm` itself has a bug. The `FeedbackForm` component is used by the `FeedbackButton` (normal operation), not by the crash boundary.

---

## 8. Agent Feedback Skill

Add a "Report an issue" skill to every agent in `ROUTE_AGENT_MAP`:

```typescript
{
  label: "Report an issue",
  description: "Report a bug, suggest an improvement, or ask a question",
  capability: null,
  prompt: "I'd like to report an issue or give feedback about this page.",
}
```

When the agent receives this prompt (or the feedback-triggered prompt), it responds conversationally:
- Asks what type: bug, suggestion, or question
- Asks for a description
- Asks for severity (for bugs)
- Confirms and creates the report via `reportQualityIssue` server action
- Responds: "Got it — I've filed this as PIR-XXXXX. The responsible team for this area will see it."

---

## 9. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/<timestamp>_platform_issue_report/migration.sql` | PlatformIssueReport table |
| `apps/web/app/api/quality/report/route.ts` | Slim POST endpoint (no auth, size limits, truncation) |
| `apps/web/lib/actions/quality.ts` | `reportQualityIssue` server action with auth + route resolution |
| `apps/web/lib/quality-queue.ts` | Client-side localStorage queue + flush logic (try/catch + JSON validation) |
| `apps/web/components/feedback/FeedbackButton.tsx` | Floating button, opens co-worker or fallback form |
| `apps/web/components/feedback/FeedbackForm.tsx` | Simple form — zero external dependencies (React + inline styles only) |
| `apps/web/components/feedback/QueueFlusher.tsx` | Client component that flushes localStorage queue on mount |
| `apps/web/app/(shell)/error.tsx` | Crash boundary with inlined form (no component imports) + auto-report |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `PlatformIssueReport` model; add `issueReports PlatformIssueReport[]` to `User` model |
| `apps/web/lib/agent-routing.ts` | Add "Report an issue" skill to every agent |
| `apps/web/components/agent/AgentCoworkerShell.tsx` | Listen for `open-agent-feedback` CustomEvent, open panel with feedback prompt |
| `apps/web/app/(shell)/layout.tsx` | Render `FeedbackButton` and `QueueFlusher` client components |

---

## 10. Testing Strategy

- **Unit test for slim endpoint**: POST valid body -> 200 + reportId, POST oversized body -> 413, POST when DB down -> 500
- **Unit test for localStorage queue**: queue item (verify stored), flush (verify removed), handle full storage (verify no throw), handle corrupt JSON (verify discard)
- **Unit test for route-to-owner resolution**: each route prefix maps to the correct portfolio, unmapped routes -> null
- **Unit test for feedback skill**: verify every agent has the "Report an issue" skill
- **Unit test for reportId format**: verify PIR-XXXXX pattern
- **Visual verification**: error boundary renders cleanly, feedback button opens correct path (AI or form), queue flushes on next load, crash boundary auto-reports
