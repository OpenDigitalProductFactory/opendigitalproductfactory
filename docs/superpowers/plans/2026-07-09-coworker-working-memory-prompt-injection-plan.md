# Coworker working-memory prompt injection — plan (BI-15FE2F07)

- **Date:** 2026-07-09
- **Epic:** EP-CLAUDE-INSIDE-OUT (harness-parity Cluster 1, matrix row #3)
- **BI:** BI-15FE2F07 (Slice 2 of BI-F9025BA0)
- **Kernel altitude ledger:** DI-D1C96829E6BD (deliver-tractable-block-rest)

## Problem

BI-F9025BA0 Slice 1 (PR #2702) shipped the working-memory substrate:
`CoworkerMemoryNote`, `loadCoworkerNotes`, `formatNotesAsContext`, and a
self-scoped MCP door. But nothing injected those notes into the prompt — a
coworker could record and read its notes via the door, yet its own durable
memory never reached its system prompt. This slice closes that loop.

## Approach (substrate-first — the formatter already exists)

1. **Assembler** — `prompt-assembler.ts`: add `workingNotes?: string | null` to
   `PromptInput`; inject it into Block 5 (domain), directly below wiki recall.
   `formatNotesAsContext` already returns `null` when there are no notes, so the
   block is a **strict no-op** for coworkers without memory (the null and omitted
   cases produce an identical prompt).
2. **Caller** — `agent-coworker.ts`, unified branch (`if (useUnified)`): before
   `assembleSystemPrompt`, resolve the coworker cuid (`resolveCoworkerAgent`) and
   load + format its notes, passing `workingNotes`. **Fail-open** — wrapped in
   try/catch so a memory-load error can never break a reply.
3. **Tests** — assembler: notes land in Block 5 below wiki and before route data;
   null/omitted is a strict no-op (byte-identical prompt).

## Scope boundary

- **Unified path only.** The legacy path (`USE_UNIFIED_COWORKER=false`) assembles
  its prompt separately and is the retirement target of BI-45514C4E; wiring
  memory there would be throwaway. Once the unified default flips, every install
  inherits memory injection.

## Safety

- Additive optional field; no change to any existing block or caller behavior
  when `workingNotes` is absent.
- Fail-open load: notes never break a response.
- No schema change (Slice 1 already shipped the model + loaders).
