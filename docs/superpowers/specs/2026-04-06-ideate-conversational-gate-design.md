# Ideate Phase Conversational Gate

**Date:** 2026-04-06
**Status:** Draft
**Relates to:** Build Studio — ideate phase, agentic loop, PLATFORM_PREAMBLE

---

## Problem

When a user enters Build Studio and types a definitional or exploratory prompt ("help me define this feature", "what should this do", "let's think about X"), the AI Coworker immediately executes a 5-step research pipeline — codebase search, schema inspection, design system fetch, evidence saving, design doc review — silently, for up to 300 seconds, before saying a single word.

This is the wrong behaviour. The user asked a question; the agent launched a build.

### Root causes

| # | Location | Issue |
|---|----------|-------|
| 1 | `build-agent-prompts.ts:99` | Ideate prompt opens with `DO THIS NOW — no questions, no asking for clarification.` — no intent gate |
| 2 | `build-agent-prompts.ts:111` | `You MUST call at least 3 research tools before proceeding` — mandatory tool use regardless of whether the user has given enough information to act on |
| 3 | `agent-routing.ts:17` | `PLATFORM_PREAMBLE` says `DO NOT ASK CLARIFYING QUESTIONS` globally — applies even to ideation conversations |
| 4 | `agentic-loop.ts:114-154` | `shouldNudge()` CLARIFYING_QUESTION_PATTERN (`/^[^.!]*\?[\s]*$/`) is too strict — any response with a statement before a question triggers a tool-use nudge |

### Why it matters

- **User trust:** 300s of silence then a fully-formed design document feels like the agent ignored the user and went off to do its own thing. It may be wrong, too.
- **Quality:** Kicking off codebase research before understanding intent produces designs anchored on surface-level keyword matches rather than actual requirements.
- **Efficiency:** 100-iteration limit is hit because the agent burns iterations on research the user never asked for.

---

## Proposed Solution

Add a **conversational intent gate** to the ideate phase. Before doing any research or document generation, the agent determines whether it has enough to act or whether it should ask first.

### Principle

> **If the user's message is definitional, exploratory, or ambiguous — ask one good question. Only start the research pipeline when you know what to research.**

This is not about asking 5 rounds of questions. It is about one lightweight clarification check before committing to 300 seconds of tool execution.

---

## Design

### 1. Ideate prompt — add intent gate as Step 0

Replace the current opening of the ideate prompt with a two-mode structure:

**Mode A — Clarification needed** (user gave a vague or exploratory message):
- Respond conversationally with 1-2 targeted questions
- Do NOT call any tools
- Keep response under 4 sentences
- Example triggers: "help me define", "what should this do", "let's think about", "I want to add", "I just created", anything under ~15 words describing a feature

**Mode B — Ready to research** (user gave enough context to act):
- Execute existing Steps 1-5 as-is
- Example triggers: user has already answered clarification questions, or gave a detailed description (roles, data, workflow, integration points)

The gate logic lives in the prompt itself as explicit instructions to the model, not as code-level intent detection. The model is good at this classification.

**New ideate prompt opening (replaces lines 99-111):**

```
BEFORE DOING ANYTHING ELSE — assess whether you have enough to act.

CHECK: Does the user's message give you enough to design from? You need at minimum:
  - What problem this feature solves (or who uses it)
  - Roughly what it does (workflow, data, or integration it handles)

IF NOT ENOUGH (vague, exploratory, or ambiguous message):
  Ask ONE clarifying question. Max 2 sentences. Do not call any tools.
  Good question examples:
    "Who uses this — internal staff, external customers, or both?"
    "What triggers this — is it initiated by a user action or an external event?"
    "What does success look like — what can someone do after this feature exists that they can't do today?"
  Wait for the user's answer before proceeding.

IF ENOUGH (user gave context, answered your question, or said "just build it" / "make assumptions"):
  Proceed to Step 1 below.
```

### 2. PLATFORM_PREAMBLE — scope the no-clarification rule

The global `DO NOT ASK CLARIFYING QUESTIONS` instruction is correct for most routes (bug reports, quick fixes, settings changes) but wrong for Build Studio ideation.

**Change:** Add a carve-out explicitly exempting ideation:

```
- DO NOT ASK CLARIFYING QUESTIONS — except in Build Studio ideation (/build), where one 
  clarifying question is allowed and expected before starting design research.
```

### 3. `shouldNudge()` — relax the clarifying question pattern

Current pattern: `/^[^.!]*\?[\s]*$/` (entire response must be a bare question)

This rejects valid clarifying responses like:
- "Happy to help define this. Who is the primary user — internal staff or external customers?"
- "Let's get this right. What triggers the feature — a user action or an automated event?"

**Change:** Replace the pattern with a more permissive check: if the response contains a `?` and is under 250 characters, treat it as a clarifying response and suppress the nudge.

```typescript
// Before (too strict):
const isAskingClarification = text.length < 250 && CLARIFYING_QUESTION_PATTERN.test(text);

// After (permissive — any short response with a question mark):
const isAskingClarification = text.length < 250 && text.includes("?");
```

---

## Files to change

| File | Change |
|------|--------|
| `apps/web/lib/integrate/build-agent-prompts.ts` | Insert Step 0 intent gate at the top of the `ideate` prompt (before the current `DO THIS NOW` line) |
| `apps/web/lib/tak/agent-routing.ts` | Add Build Studio carve-out to the `DO NOT ASK CLARIFYING QUESTIONS` rule in `PLATFORM_PREAMBLE` |
| `apps/web/lib/tak/agentic-loop.ts` | Relax `shouldNudge()` clarifying question pattern |

---

## Acceptance criteria

1. A prompt like "help me define this feature" receives a clarifying question within 5 seconds — no tool calls.
2. A prompt like "I need a complaints workflow with 3 roles: submitter, reviewer, and approver, with email notifications on state change" proceeds directly to research pipeline.
3. After the user answers a clarifying question, the research pipeline starts automatically.
4. A user who says "just build it" or "make reasonable assumptions" bypasses the gate and goes straight to research.
5. `shouldNudge()` does not force tool use when the model's response contains a question.

---

## Out of scope

- Changing the research pipeline itself (Steps 1-5 are correct for when intent is known)
- Adding a formal "ideation mode" toggle in the UI
- Changing how notes are saved (`NOTES_INSTRUCTION` is fine as-is)
- Routing optimizations (separate workstream, already in progress)
