# Recruiting pipeline coworker surface (BI-E64D11AE)

- **BI:** BI-E64D11AE — *Absorb: surface the Greenhouse pipeline on the native recruiting surface*, epic EP-ECOSYSTEM-ABSORPTION-ARCH.
- **Design:** [docs/superpowers/specs/2026-08-05-greenhouse-ats-absorption-design.md](../specs/2026-08-05-greenhouse-ats-absorption-design.md) §4 Phase 2 (Absorb).
- **Builds on:** the merged absorb read-model (`getRecruitingPipeline`, #4067).

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd`, `dpf-local-merge-ci-before-push` plus the completion gate before any success claim, and `dpf-pr-with-dco`.

## Goal & boundary

Surface the unified recruiting funnel to the **AI workforce**: an HR-coworker MCP tool `get_recruiting_pipeline` over the merged dual-read read-model, so the operator can ask a coworker to show the pipeline across native + Greenhouse-sourced work as one funnel. Deliberately a **coworker/MCP surface, not a UI route** — a bespoke page route carries a disproportionate ratified-page-purpose + ux-fit-sweep gauntlet for a read list; the visual page is a separate, heavier batch. Read-only; no candidate PII beyond display name / status / stage.

## Design grounding

Extends the Absorb spec (§4 Phase 2) — the read-model was #4067; this is its coworker surface. Reuses the tool-pack registry + `agent-grants` gating source (grants mirror `TOOL_TO_GRANTS`, enforced by the drift test). No new contract; the AI-workforce surface is the platform-native way to expose a read model.

## Phases (atomic — one tool, one pack)

1. **`recruiting-pipeline-pack.ts`** — `get_recruiting_pipeline` (read-only, `view_employee`, grants `consumer_read`+`registry_read`) calling `getRecruitingPipeline`. *Verify:* definition shape + grant mirror, funnel-count summary, requisition filter, absent-arg default.
2. **Registration** — one import + one array entry in `pack-registry.ts`; the mirrored grant in `lib/tak/agent-grants.ts` (drift-test enforced).

## Risks & rollback

Read-only tool over a merged read-model; no schema/route/write. A new tool description may nudge the `/platform/audit/authority` route's word budget — re-baseline that one route via the `ux-route-sweep.yml -f update_baseline=true` workflow if the sweep flags it. Rollback = remove the pack + its registry/grant lines.

## Completion gate

`dpf-local-merge-ci-before-push` (or the recorded infra override) + `dpf-pr-with-dco`. 3 pack tests + the full 1339-test suite, tsc + all 24 guards clean locally.

## Backlog coverage

- **Decision:** `atomic` — one BI (BI-E64D11AE); the tool + its registration ship together.
- **Receipt:** `cmshowshl0vhu01prmepb7pao` (recorded 2026-08-06 against BI-E64D11AE).
- **Deliverables (none independently shippable):** recruiting-pipeline-pack → registration.
- **Deferred (heavier separate batch):** the visual recruiting-pipeline UI page (ratified page-purpose contract + ux-fit sweep).
