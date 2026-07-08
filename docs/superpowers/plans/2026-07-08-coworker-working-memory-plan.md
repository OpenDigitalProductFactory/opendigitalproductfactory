# Per-coworker durable working memory — implementation plan

- **BI:** BI-F9025BA0 (EP-CLAUDE-INSIDE-OUT)
- **Date:** 2026-07-08
- **Status:** Slice 1 (this PR) — substrate + self-scoped door. Slice 2 (follow-up) — prompt injection.

## Problem

DPF has two memory layers already: the shared WWMD/WWWD wiki corpus (org-level) and the `UserFact` store (per-user, `apps/web/lib/tak/user-facts.ts`). A coworker has **no per-agent durable memory** — role-local techniques, workspace context, and cautions that a specialist learns but that do not belong in the shared org corpus. This is gap-matrix row #3 (refinement) in the Claude-inside-out parity spec: the external harness gives each agent an editable memory file; DPF's analog is missing.

## Design

Mirror the proven `UserFact` pattern (superseded-by-key), keyed per **coworker** instead of per user.

### Slice 1 — this PR (substrate + governed self-scoped door)

1. **Schema** — `CoworkerMemoryNote` (`packages/db/prisma/schema.prisma`): `agentId` (Agent.id cuid), `noteKind` (closed vocabulary), `noteKey`, `content`, `sourceRef?`, `createdBy?`, `createdAt`, `supersededAt?`, `supersededById?`. Two indexes: active-lookup `(agentId, supersededAt)` and supersede-lookup `(agentId, noteKind, noteKey)`. Additive migration `20260708001000_add_coworker_memory_note`.
2. **Core** — `apps/web/lib/tak/coworker-memory.ts`: `COWORKER_NOTE_KINDS` (technique|context|preference|caution|reference), `recordCoworkerNote` (validate kind + content; supersede-by-key; identical content = no-op), `loadCoworkerNotes` (active, newest-first, capped), `formatNotesAsContext` (prompt block; null when empty). Pure, prisma-mocked unit tests.
3. **MCP door** — `apps/web/lib/mcp/packs/coworker-memory-pack.ts`: `record_working_note` + `list_working_notes`, **self-scoped** via `context.agentId` (a coworker touches only its own memory; any caller-supplied agent is ignored; a non-agent caller is rejected). **Ungated**, mirroring `propose_improvement` — recording a note for oneself cannot exceed authority or affect anyone else. Registered in `TOOL_PACK_REGISTRY`; `tool-registry.test.ts` covers shape + no-drift + PLATFORM_TOOLS presence.

### Slice 2 — follow-up (prompt injection)

Add an optional `coworkerMemoryContext?: string | null` to the `assembleSystemPrompt` `PromptInput`, resolved by the caller from `loadCoworkerNotes(agentId)` + `formatNotesAsContext`, injected into Block 5 alongside the profession corpus. Strict no-op for any coworker without notes (zero behavior change until a note is recorded). Deferred here because it touches the coworker prompt hot path across both caller paths and warrants its own reviewed PR.

## Non-goals

- Automatic extraction of notes from conversation (unlike `UserFact`'s utility-inference extraction) — notes are recorded explicitly via the door, so the coworker controls what persists. Auto-extraction is a possible later slice.
- Cross-agent or org-visible notes — those belong in the WWWD corpus; confirmed durable learnings route there via `dpf-route-learning-to-commons`.

## Verification

- Unit: core (`coworker-memory.test.ts`), pack (`coworker-memory-pack.test.ts`), registry (`tool-registry.test.ts`).
- End-to-end (door): a coworker calls `record_working_note` then `list_working_notes` and reads its note back — provable without the Slice 2 prompt wiring.
