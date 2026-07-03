# Plan — Proactivity drives in-task initiative (BI-E35A8AA4)

Spec: [2026-07-03-proactivity-drives-in-task-initiative.md](../specs/2026-07-03-proactivity-drives-in-task-initiative.md)

## Phase 1 — Initiative block (pure)
- [x] `apps/web/lib/tak/initiative-block.ts` — `buildInitiativeBlock(level)` returning per-level directive; `null → balanced`.
- [ ] `apps/web/lib/tak/initiative-block.test.ts` — per-level distinctness, assertive bounds language, null===balanced.

## Phase 2 — Thread into prompt assembly
- [ ] `prompt-assembler.ts` — add `proactivityLevel?: ProactivityLevel | null` to `PromptInput`; push `buildInitiativeBlock(...)` into dynamic blocks after Authority (dynamic — after cache boundary).
- [ ] `prompt-assembler` test — assertive directive present when set; balanced fallback when omitted.

## Phase 3 — Wire both send paths (surface-uniform)
- [ ] `agent-coworker.ts sendMessage` — resolve `getCoworkerProactivityPreference(agent.agentId)` once.
- [ ] Unified path — pass `proactivityLevel` into `assembleSystemPrompt`.
- [ ] Legacy path — push `buildInitiativeBlock(level)` into `promptSections` beside the decision-routing block.

## Phase 4 — Verify
- [ ] Targeted vitest green (initiative-block, prompt-assembler, agent-coworker if touched).
- [ ] module-size guard.
- [ ] DCO PR; babysit CI.

## Ordering / risk
Pure block first (no deps), then assembler (type + injection), then call sites. Behavior bounded by existing authority/mode/no-fabrication rules; null→balanced means every coworker gets balanced guidance (intended, matches dock default). No schema/migration.
