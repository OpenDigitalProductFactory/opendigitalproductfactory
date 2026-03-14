# EP-QUALITY-001: Product Quality Feedback and Error Reporting — Design Spec

**Date:** 2026-03-14
**Goal:** Capture runtime errors, user-reported issues, and feedback through three resilient paths (AI-assisted, manual fallback, crash boundary). Route issues to the responsible digital product owner via the taxonomy. Client-side localStorage queue ensures nothing is lost even when the server is down.

---

## 1. Three Error Capture Paths

| Path | Trigger | Experience | Dependencies |
|------|---------|-----------|-------------|
| **AI-assisted** | User clicks feedback button OR runtime error auto-detected | AI co-worker opens, agent guides conversation, creates structured QualityIssue | LLM provider active, panel functional |
| **Manual fallback** | AI providers unavailable OR user preference | Simple inline form (type dropdown, text area, submit). No LLM, no panel. | `/api/quality/report` endpoint only |
| **Crash boundary** | Page fails to render (unhandled exception) | Next.js `error.tsx` shows clean error page with embedded simple form | `/api/quality/report` endpoint only. No component dependencies. |

All three paths write to the same `QualityIssue` model. The AI path produces richer context (agent extracts route, recent user actions, error stack, severity assessment). The manual/crash paths capture basics (route, user, timestamp, description).

### Client-Side Resilience

```
User action or error detected
  → Try POST /api/quality/report
    → Success: done
    → Failure (network/server down):
      → Queue to localStorage ("dpf-quality-queue")
      → On next successful page load:
        → Flush queued items to /api/quality/report
        → Remove from queue on success
```

The localStorage queue is a JSON array of pending reports. A `useEffect` in the shell layout checks for queued items on mount and flushes them silently.

---

## 2. Schema: QualityIssue

New Prisma model (**migration required**):

```prisma
model QualityIssue {
  id               String   @id @default(cuid())
  issueId          String   @unique @default(cuid())
  type             String   // "runtime_error" | "user_report" | "feedback"
  severity         String   @default("medium") // "critical" | "high" | "medium" | "low"
  status           String   @default("open")   // "open" | "acknowledged" | "resolved"
  title            String
  description      String?
  routeContext     String?  // pathname where the issue occurred
  errorStack       String?  // sanitized stack trace for runtime errors
  userAgent        String?  // browser info for debugging
  reportedById     String?  // userId — null for unauthenticated crash reports
  reportedBy       User?    @relation(fields: [reportedById], references: [id])
  digitalProductId String?  // auto-resolved from route via taxonomy
  portfolioId      String?  // auto-resolved from route
  agentId          String?  // which agent assisted with the report
  source           String   @default("manual") // "manual" | "ai_assisted" | "auto_detected" | "crash_boundary"
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

No FK constraints on `digitalProductId` or `portfolioId` — these are best-effort resolution. The slim endpoint must work even if resolution fails.

---

## 3. Slim API Endpoint: `/api/quality/report`

**File:** `apps/web/app/api/quality/report/route.ts`

A minimal POST endpoint that bypasses all middleware. No auth session lookup, no server components, no complex imports. Just parse the JSON body and write to Prisma.

```typescript
// Slim endpoint — must work even when app is partially broken
export async function POST(request: Request) {
  try {
    const body = await request.json();
    await prisma.qualityIssue.create({
      data: {
        type: body.type ?? "user_report",
        severity: body.severity ?? "medium",
        title: body.title ?? "Untitled report",
        description: body.description ?? null,
        routeContext: body.routeContext ?? null,
        errorStack: body.errorStack ?? null,
        userAgent: body.userAgent ?? null,
        reportedById: body.userId ?? null,
        source: body.source ?? "manual",
        // Route-to-owner resolution is best-effort
        portfolioId: body.portfolioId ?? null,
        digitalProductId: body.digitalProductId ?? null,
      },
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
```

Key design decisions:
- No auth required — crash reports may come from unauthenticated or broken sessions
- No validation beyond basic JSON parsing — accepting any data is better than rejecting a valid error report
- Returns 200 `{ ok: true }` or 500 `{ ok: false }` — the client uses this to decide whether to queue

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
}): Promise<{ issueId: string } | { error: string }>
```

**Route-to-owner resolution:** Maps the route prefix to a portfolio using the same prefix logic as `ROUTE_AGENT_MAP`:
- `/portfolio/*` → look up the `foundational` or relevant portfolio
- `/ea/*` → foundational portfolio
- `/ops/*` → manufacturing_and_delivery portfolio
- etc.

Then looks up the portfolio's digital products to find the most relevant `digitalProductId`. This is best-effort — if resolution fails, the issue is still created without attribution.

---

## 5. Feedback Button

**File:** `apps/web/components/feedback/FeedbackButton.tsx`

A small floating button fixed to the bottom-left corner (opposite the AI FAB on the right). Semi-transparent pill matching the FAB styling.

**Visual:** `"Feedback"` text with a small speech bubble icon. Same `rgba` + `backdrop-filter` treatment as the AI FAB. Draggable vertically (same pattern as FAB).

**On click:**
1. Check if AI co-worker panel is available (is there a thread? is a provider active?)
2. **If yes:** Open the AI co-worker panel with a feedback prompt injected. The agent immediately asks: *"How can I help? You can report a bug, suggest an improvement, or ask a question about this page."*
3. **If no (failsafe):** Open an inline `FeedbackForm` component anchored to the button position.

**Communication with shell:** The `FeedbackButton` dispatches a `CustomEvent("open-agent-feedback")` that the `AgentCoworkerShell` listens for. The shell opens the panel and passes an `initialPrompt` to the panel, which auto-sends it as a system message to trigger the agent's feedback flow.

---

## 6. Feedback Form (Failsafe + Crash Boundary)

**File:** `apps/web/components/feedback/FeedbackForm.tsx`

A simple, self-contained form with zero dependencies on the agent panel, LLM, or complex components.

**Fields:**
- Type: dropdown — Bug / Suggestion / Question (maps to `runtime_error`, `feedback`, `user_report`)
- Description: text area
- Submit button

**Auto-populated (hidden):** route context, timestamp, user agent, userId (if available from a lightweight session check)

**Submit flow:**
1. POST to `/api/quality/report`
2. On success: show "Thanks! The platform team has been notified."
3. On failure: queue to localStorage, show "Saved — will be sent when connectivity is restored."

---

## 7. Crash Boundary

**File:** `apps/web/app/(shell)/error.tsx`

Next.js error boundary at the shell layout level. When a page completely fails:

- Shows a clean, branded error page using DPF dark theme CSS variables directly (inline styles, no Tailwind dependency, no component imports)
- Heading: "Something went wrong"
- Subtext: "The platform team has been notified. You can also describe what happened below."
- Embedded `FeedbackForm` (the simple one — no agent dependency)
- Auto-populates: error message, route, error stack (sanitized — no file paths or secrets)
- "Try again" button that calls `reset()` (Next.js error boundary reset)

The error boundary also auto-submits a `runtime_error` QualityIssue to the slim endpoint on mount (fire-and-forget), so the error is captured even if the user doesn't fill in the form.

---

## 8. Agent Feedback Skill

Add a "Report an issue" skill to every agent in `ROUTE_AGENT_MAP`:

```typescript
{
  label: "Report an issue",
  description: "Report a bug, suggest an improvement, or ask a question",
  capability: null, // available to everyone
  prompt: "I'd like to report an issue or give feedback about this page.",
}
```

When the agent receives this prompt (or the feedback-triggered prompt), it responds conversationally:
- Asks what type: bug, suggestion, or question
- Asks for a description
- Asks for severity (for bugs)
- Confirms and creates the QualityIssue via `reportQualityIssue` server action
- Responds: "Got it — I've filed this as [issueId]. The [owner role] for this area will see it."

This uses the existing LLM conversation + the future EP-AGENT-EXEC-001 tool-use pattern. For now (before EP-AGENT-EXEC-001), the agent guides the conversation and the user confirms, then a server action creates the issue.

---

## 9. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/<timestamp>_quality_issue/migration.sql` | QualityIssue table |
| `apps/web/app/api/quality/report/route.ts` | Slim POST endpoint (no auth, no middleware) |
| `apps/web/lib/actions/quality.ts` | `reportQualityIssue` server action with auth + route resolution |
| `apps/web/lib/quality-queue.ts` | Client-side localStorage queue + flush logic |
| `apps/web/components/feedback/FeedbackButton.tsx` | Floating button, opens co-worker or fallback form |
| `apps/web/components/feedback/FeedbackForm.tsx` | Simple form (failsafe + crash boundary) |
| `apps/web/app/(shell)/error.tsx` | Crash boundary with embedded form + auto-report |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `QualityIssue` model |
| `apps/web/lib/agent-routing.ts` | Add "Report an issue" skill to every agent |
| `apps/web/components/agent/AgentCoworkerShell.tsx` | Listen for `open-agent-feedback` event, pass `initialPrompt` |
| `apps/web/app/(shell)/layout.tsx` | Render `FeedbackButton`, add queue flush `useEffect` |

---

## 10. Testing Strategy

- **Unit test for slim endpoint**: POST valid body → 200, POST invalid → still 200 (accept everything), POST when DB down → 500
- **Unit test for localStorage queue**: queue item, verify stored, flush, verify removed
- **Unit test for route-to-owner resolution**: each route prefix maps to the correct portfolio
- **Unit test for feedback skill**: verify every agent has the "Report an issue" skill
- **Visual verification**: error boundary renders cleanly, feedback button opens correct path (AI or form), queue flushes on next load
