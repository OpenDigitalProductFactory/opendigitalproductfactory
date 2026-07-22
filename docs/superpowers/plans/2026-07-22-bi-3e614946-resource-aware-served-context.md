# BI-3E614946 — Resource-aware local served-context (VRAM-derived tuning param + visible on Platform > AI)

**Backlog item:** BI-3E614946 — "Local served-context window should be a resource-aware tuning parameter (VRAM-derived), not a static cap — and be visible on the admin surface"
**Type:** feature / build · **Date:** 2026-07-22
**Related:** BI-573A8EB3 (the routed-phase crash that masked this). Platform knowledge: Host Resource Profile / VRAM over-commit.

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## 1. Substrate audit (verified) — most of the engine already exists

- `recommendServedContextTokens(host: HostMemory, modelWeightsGb)` (`apps/web/lib/inference/local-model-policy.ts`) **already** computes served context from the VRAM/RAM budget minus weights minus `MODEL_HEADROOM_GB` (covers the co-resident embedder + overhead), clamped to `[RECOMMENDED_BUILD_CONTEXT_TOKENS, MAX_LOCAL_CONTEXT_TOKENS]`, rounded to 8k. This IS the resource-aware calc the BI asks for — it is fully unit-tested but **not wired into the live target**.
- `resolveServedContextTarget()` (`local-model-context-reconcile.ts`) returns the operator override (clamped to a **static** band) **else the flat `RECOMMENDED_BUILD_CONTEXT_TOKENS` (24,576)** — it ignores `recommendServedContextTokens`. That flat floor is the "static cap" the BI names.
- Runtime VRAM: `getOllamaHardwareInfo` returns `vramGb: null` (DMR has no per-model VRAM reporting) — which is *why* the resource-aware calc silently degraded to the floor. The real source is `PlatformConfig.host_profile`, persisted at install by `detect-hardware.ts`. Live value on this install: `{gpuVramGB: 24 (RTX 4090), ramGB: 63.7, selectedModel: "ai/qwen3-coder"}`. **Two shapes exist** (Windows flat `gpuVramGB`/`ramGB`; macOS/Linux nested `architecture`/`gpu.vramGB`/`ram.totalGB`) — the resolver must normalize both.
- Operator override: `LOCAL_SERVED_CONTEXT_CONFIG_KEY` exists; `applyLocalModelContext` (`apps/web/lib/actions/build-studio.ts`) is the setter, clamped to a **static** `MIN_CONTEXT_FLOOR`/`MAX_CONTEXT_CEILING` — not the resource-aware ceiling.
- Surface: `BuildStudioConfigForm` shows `servedContextTokens` from the endpoint check ("context Nk — auto-sized") and a raw token input. The resource ceiling and *why local is excluded from reasoning phases* are **not** shown.

**Hardware reality (encode, do not hide):** on this box `24 − 16 (30B weights) − 5 (headroom) = 3 GB` KV ≈ **24,576 tokens** — genuinely below the ~29k reasoning-phase envelope (observed `exceed_context_size_error: request 29362 exceeds 24576`). So resource-awareness does **not** magically make local eligible for reasoning on a 24 GB card running the 30B coder; it sizes honestly, avoids over-commit, and the surface must **flag the degrade** (cloud-only reasoning) so the operator can choose a smaller model or accept it. On a 48 GB card, or with an 8B model, the same calc yields ≥128k and local *is* eligible.

## 2. What to build (gaps only)

1. **Make the target resource-aware.** New `resolveHostMemoryProfile()` reads `PlatformConfig.host_profile` and normalizes both shapes → `HostMemory` + `selectedModel`. `resolveServedContextTarget()` default becomes `recommendServedContextTokens(host, estimateModelVramGb(model))` (which already returns the floor when the host is unknown — safe degrade) instead of the flat floor.
2. **Bound the override by the resource-aware ceiling.** The override clamps to `[floor, ceiling]` where `ceiling = recommendServedContextTokens(host, weights)` (host known) or `MAX_LOCAL_CONTEXT_TOKENS` (host unknown → trust the operator). `applyLocalModelContext` validates against the same ceiling — the "do NOT over-commit" guard.
3. **Reasoning-phase eligibility signal.** New `REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS` (30,720; covers the observed 29,362) + `isLocalServedContextEligibleForReasoning(served)`. This is the SPOF flag.
4. **Surface on Platform > AI.** Extend the served-context action to return `{ served, target, ceiling, reasoningEligible, host summary, modelId }`; `BuildStudioConfigForm` shows a plain-language line ("Local serves 24k; hardware ceiling 24k (RTX 4090, 24 GB); reasoning phases run in the cloud because they need ~30k") and bounds the input to the ceiling. `dpf-ux-fit-review` on the surface (progressive disclosure — one sentence, computed values, no raw token math demanded of a layman).

## 3. Phases

### Phase 1 — Pure engine (host-memory parse + reasoning eligibility)  *(ships independently)*
`apps/web/lib/inference/local-model-policy.ts`: add `parseHostMemory(raw): { host: HostMemory; selectedModel: string | null } | null` (both shapes), `REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS`, `isLocalServedContextEligibleForReasoning(served)`, and `computeServedContextCeiling(host, modelId)`.
**Verify:** `vitest` — parse both host_profile shapes incl. `vramGb:null`; eligibility boundary at the envelope; ceiling = floor on 24 GB/30B, ≥128k on 48 GB/30B and 24 GB/8B.

### Phase 2 — Wire resource-awareness into the target + override clamp  *(depends on Phase 1)*
`local-model-context-reconcile.ts`: `resolveHostMemoryProfile()` (prisma read), resource-aware default in `resolveServedContextTarget()`, override clamped to the resource-aware ceiling. `build-studio.ts` `applyLocalModelContext` validates against the ceiling.
**Verify:** `vitest` with mocked prisma — no override + known host → resource-aware default; override above ceiling → clamped; host unknown → floor default + operator override allowed to MAX.

### Phase 3 — Surface + UX-fit  *(depends on Phase 2)*
Extend the served-context action return; `BuildStudioConfigForm` read-only resource line + input bound + reasoning-degrade note. `dpf-ux-fit-review` + `UX-Fit-Decision:` trailer.
**Verify:** `vitest` on the action's pure assembly; UX exercise on the live Platform > AI runs on the canonical install after deploy (runtime-bound — not the worktree).

## 4. Risks & rollback

- **Wrong VRAM read → over/under-commit.** Mitigation: parser defends both shapes + null; unknown host degrades to the floor (never raises blindly); ceiling never exceeds `recommendServedContextTokens` (already VRAM-bounded). No auto-*raise* beyond what the host can serve.
- **Reconcile now reads host_profile every boot.** One extra cheap `PlatformConfig` read, best-effort (any error → floor). No new write in steady state.
- **Rollback:** revert the PR; `resolveServedContextTarget` returns to the flat floor. No migration (reads existing `PlatformConfig.host_profile`, writes the existing override key).

## 5. Definition of done
Build gate: unit tests (Phases 1–2, + action assembly), production build via sandbox/CI, no migration. UX-fit decision recorded. The surface makes the previously-invisible served-context limit + reasoning SPOF visible and the override over-commit-safe.

## 6. Backlog coverage
Single atomic BI (BI-3E614946); phases are sequencing (Phase 2 needs Phase 1's engine; Phase 3 surfaces Phase 2's values). One PR. Recorded via `record_plan_backlog_coverage` (`atomic`).
