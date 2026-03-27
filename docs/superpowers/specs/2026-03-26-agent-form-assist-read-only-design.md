# EP-AGENT-VIS-001: Agent Page Visibility in Hands Off Mode

**Status:** Draft
**Date:** 2026-03-26
**Epic:** Agent Page Visibility
**Dependencies:** EP-LLM-LIVE-001 (agent coworker infrastructure), form assist adapter system

---

## Problem

When the agent coworker is in Hands Off mode and a user asks "what's currently in the status field?" or "why does this item show priority 3?", the agent cannot answer — it has no visibility of the page at all.

The current implementation gates all form/page context behind a single `elevatedAssistEnabled` flag:

```typescript
// AgentCoworkerPanel.tsx:198
const activeFormAssist = elevatedAssistEnabled ? getActiveFormAssist(pathname) : null;
```

Both reading (injecting current field values into the agent's context) and writing (extracting field update instructions from the response) are controlled by the same toggle. Enabling visibility requires enabling write permission, which is the opposite of what Hands Off is meant to convey.

**Hands Off should mean:** the agent can see the page but cannot change it.
**Hands On should mean:** the agent can see the page and can propose changes to fields.

---

## Goals

1. In Hands Off mode, the agent always has read access to field values on the current page when a form assist adapter is registered for that route.
2. In Hands Off mode, the agent never produces field update output — the response extraction path is not invoked.
3. In Hands On mode, behaviour is unchanged: agent sees fields and can propose updates.
4. The system prompt instruction differs between modes: read-only context says "you can see these fields but cannot modify them"; write mode says the existing fill instruction.
5. No user-facing UI changes — the Hands On / Hands Off toggle continues to mean exactly what it says to the user.

---

## Non-Goals

- Changing which routes have form assist adapters registered.
- Exposing additional page data beyond what `AgentFormAssistClientAdapter.getValues()` already returns.
- Adding a separate "visibility" toggle — the distinction is implicit in the Hands On / Hands Off state.

---

## Design

### 1. Always Build Read Context in `AgentCoworkerPanel`

```typescript
// Before (current)
const activeFormAssist = elevatedAssistEnabled ? getActiveFormAssist(pathname) : null;

// After
const activeFormAssist = getActiveFormAssist(pathname);  // always — null if no adapter registered
```

`formAssistContext` is then built from `activeFormAssist` unconditionally (when non-null), exactly as it is today when `elevatedAssistEnabled` is true.

A new boolean `formAssistReadOnly` is derived and passed to `sendMessage`:

```typescript
const formAssistReadOnly = activeFormAssist !== null && !elevatedAssistEnabled;
```

The `sendMessage` input gains this optional flag:

```typescript
formAssistReadOnly?: boolean;
```

### 2. Split Prompt Injection and Response Extraction in `agent-coworker.ts`

**Prompt injection (read context):** Runs whenever `formAssistContext` is present — regardless of `elevatedFormFillEnabled`.

```typescript
// Before
if (input.elevatedFormFillEnabled && input.formAssistContext) {
  promptSections.push("", buildFormAssistInstruction(input.formAssistContext));
}

// After
if (input.formAssistContext) {
  promptSections.push(
    "",
    buildFormAssistInstruction(input.formAssistContext, {
      readOnly: input.formAssistReadOnly ?? !input.elevatedFormFillEnabled,
    }),
  );
}
```

**Response extraction (write):** Runs only when `elevatedFormFillEnabled` is true — no change to this condition.

```typescript
// Unchanged condition — write path is still gated on elevatedFormFillEnabled
if (input.elevatedFormFillEnabled && input.formAssistContext) {
  const extracted = extractFormAssistResult(responseContent, input.formAssistContext);
  formAssistUpdate = extracted.fieldUpdates ?? undefined;
}
```

### 3. Update `buildFormAssistInstruction` to Accept `readOnly` Option

`buildFormAssistInstruction` in `agent-form-assist.ts` gains a second parameter:

```typescript
export function buildFormAssistInstruction(
  context: AgentFormAssistContext,
  options?: { readOnly?: boolean },
): string
```

**Read-only instruction (Hands Off):**

```
PAGE CONTEXT (read-only):
You can see the current state of the fields below. Use this to answer questions about what is on
the page. You cannot modify these fields — do not produce field update output.

Form: {formName}
Fields: {fieldList with current values}
```

**Write instruction (Hands On — existing behaviour):**

The existing instruction is unchanged. It already tells the agent it can propose field updates and emit the structured update block.

### 4. `applyFieldUpdates` Path Unchanged

`AgentCoworkerPanel` only calls `activeFormAssist.applyFieldUpdates()` when `formAssistUpdate` is present in the response. Since `formAssistUpdate` is only produced when `elevatedFormFillEnabled` is true (Step 2), no write actions reach the form in Hands Off mode. The adapter's `applyFieldUpdates` method is never called in Hands Off mode — no guard change needed there.

---

## Data Model

No schema changes. All changes are in client component state, the `sendMessage` input type, and prompt construction.

---

## Files Affected

**Modified:**

- `apps/web/components/agent/AgentCoworkerPanel.tsx` — remove `elevatedAssistEnabled` gate from `getActiveFormAssist` call; derive and pass `formAssistReadOnly` to `sendMessage`
- `apps/web/lib/actions/agent-coworker.ts` — split prompt injection from response extraction; add `formAssistReadOnly` to input type; pass `readOnly` option to `buildFormAssistInstruction`
- `apps/web/lib/agent-form-assist.ts` — add `options?: { readOnly?: boolean }` to `buildFormAssistInstruction`; implement read-only instruction variant

**No new files required.**

---

## Testing Strategy

- Unit test: `buildFormAssistInstruction(context, { readOnly: true })` — output contains "cannot modify" and does not contain the field update block instruction.
- Unit test: `buildFormAssistInstruction(context, { readOnly: false })` — existing write instruction unchanged.
- Integration test: `sendMessage` with `elevatedFormFillEnabled: false` and `formAssistContext` present — prompt includes read-only field context; response does not produce `formAssistUpdate`.
- Integration test: `sendMessage` with `elevatedFormFillEnabled: true` and `formAssistContext` present — prompt includes write instruction; `formAssistUpdate` extracted normally.
- Component test: `AgentCoworkerPanel` with Hands Off and a registered form assist adapter — `formAssistContext` passed to `sendMessage`; `formAssistReadOnly: true` passed; no `applyFieldUpdates` call on response.
- Component test: `AgentCoworkerPanel` with Hands On — existing behaviour unchanged.
- Component test: `AgentCoworkerPanel` on a route with no registered form assist adapter — no `formAssistContext` passed in either mode (no change from current).

---

## Related Epics

| Epic | Relationship |
| --- | --- |
| EP-LLM-LIVE-001 | Provides the agent coworker infrastructure being modified |
| EP-BRANDING-001 | `branding-form-assist.ts` is an example adapter that benefits from this fix |
