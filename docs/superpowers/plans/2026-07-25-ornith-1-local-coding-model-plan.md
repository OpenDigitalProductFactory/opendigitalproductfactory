---
status: blocked-on-backlog-filing
backlogItem: PENDING-MCP-FILING
epic: EP-BUILD-STUDIO
spec: docs/superpowers/specs/2026-07-25-ornith-1-local-coding-model-design.md
date: 2026-07-25
---

# Ornith-1.0 Local Coding Model Evaluation — Implementation Plan

Phased so each phase lands as one PR with its own gates, mirroring the precedent set by
`docs/superpowers/plans/2026-06-10-local-llm-build-agent.md` (OpenCode admission). Spec holds the
rationale; this file holds the order of operations.

## Backlog coverage

**Not filed.** This plan was written in a remote session with no reachable `dpf` MCP connector and
no reachable live Postgres (see the spec's MCP/DB availability note). Per the `dpf-writing-plans`
skill guardrail — "No plan without a BI" / "No silent MCP bypass: unreachable MCP, a missing tool,
or insufficient token scope stops planning before source implementation" — this plan does not
fabricate a `record_plan_backlog_coverage` receipt. The exact `create_backlog_item` payload is
drafted at the end of the spec, ready to file from a session with live MCP or DB access; this
document itself is a source-control-only artifact until that BI exists.

**Next action for a session with `dpf` MCP access:** file the draft BI, link it to `EP-BUILD-STUDIO`
(existing epic — no new epic needed, confirmed no overlap conflict since `EP-BUILD-STUDIO` already
covers the sibling OpenCode-admission BI `BI-01D6A51B`), then run `record_plan_backlog_coverage`
against this plan path with a `decomposed` mapping: Phase 0 → the filed BI itself (tool admission is
not independently shippable product work); Phase 1 → one BI (eval harness run); Phase 2 → no code,
decision only; Phase 3 → filed only if Phase 2's evidence supports moving forward, as a new BI
scoped to whatever the evidence supports (add-as-option / promote-default / do-not-adopt writeup).

## Phase 0 — Tool admission & verification (no code)

1. Read the actual `LICENSE` file at the pinned Ornith-1.0 release (not just the README paraphrase)
   and confirm MIT, matching the rigor of the opencode registry entry's license finding.
2. Determine the pull path: check whether Ornith-1.0 ships in Docker's `ai/...` model-runner
   catalog (the mechanism `LOCAL_MODEL_TIERS` already pulls from) or requires a manual GGUF
   import / `docker model package` step. This materially changes install-story complexity — a
   catalog hit is near-zero-effort; a manual import path needs its own documented recipe before it
   can be a `LOCAL_MODEL_TIERS` entry (install scripts mirror that constant and cannot run
   arbitrary import commands blindly).
3. Confirm the tag(s) actually served (needed to know whether `pickDefaultCodingModel()`'s
   `/coder|code/i` regex already matches it, per the spec's Design section).
4. Run `/project:tool-evaluation` (EP-GOVERN-002, `toolType: "ai_provider"`) covering security,
   license, architecture fit, integration, supply-chain (publisher provenance for
   `deepreinforce-ai`), compliance. Record the result in
   `packages/db/data/approved_tools_registry.json`, following the `opencode` entry's shape:
   `status: "conditional"` pending Phase 1 eval evidence, explicit `conditions[]`
   (version/digest-pinned, local-endpoint-only, sandbox-only where applicable), `findings[]` with
   real `evidence` URLs, `reEvaluateAfter`.

Exit: registry row merged with real (not paraphrased) license/provenance/pull-path findings; exact
model tag(s) and pull mechanism documented.

## Phase 1 — Comparative evaluation (the evidence-gathering phase)

1. Pull the size tier(s) that map onto documented DPF hardware bands (9B-Dense ≈ current 8B/14B
   tiers; 31B-Dense / 35B-MoE ≈ current 30B/35B tiers) on the shared local-CI convergence sandbox or
   canonical local install per AGENTS.md §5 ("Where each gate runs") — not a from-scratch runtime in
   a topic worktree.
2. Verify tool-call emission format empirically: does it produce OpenAI-native `tool_calls`, or
   does `extractTextualToolCalls()`'s existing Gemma/Llama-style textual-marker patterns already
   parse it, or does it need a new pattern? Record the answer regardless of outcome — a model that
   needs a new textual-marker pattern is not disqualified, it's a scoped addition to
   `ai-inference.ts`.
3. Run the same benchmark harness DPF already anchors local-model claims to — the mini-SWE-agent
   precedent named in the 2026-06-10 opencode spec — head-to-head against the install's current
   default `qwen3-coder`-class tier, on identical hardware. Capture: task completion rate at the
   quantization DPF would actually ship (Q4/Q4_K-class per `LocalModelTier.weightsGb`
   conventions, not vendor-reported bf16 numbers), tool-call reliability, context utilization
   against `RECOMMENDED_BUILD_CONTEXT_TOKENS` / `MAX_LOCAL_CONTEXT_TOKENS`, and latency/throughput.
4. Optionally: one real end-to-end Build Studio dispatch via the `opencode` runner pointed at the
   pulled Ornith model on a contained BI, using `classifyOutcome()`'s existing
   `DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT` signal as the honest quality readout —
   same pattern as Phase 3 of the 2026-06-10 opencode plan.
5. Record evidence via the Build Studio evidence tools / `record_execution_evidence`, naming the
   substrate (per AGENTS.md §6, "Execution evidence is canonical-runtime evidence").

Exit: a written comparison (completion rate, tool-call reliability, context fit, latency) between
Ornith and the current Qwen3 default at matched hardware tiers, backed by real dispatch/eval runs,
not vendor claims.

## Phase 2 — Decision gate (no code)

Using Phase 1's evidence, decide one of:

- **Augment:** add Ornith tier(s) to `LOCAL_MODEL_TIERS` as an operator-selectable option alongside
  Qwen3, no change to the default recommendation ordering. Lowest-risk outcome; appropriate if
  Ornith is competitive but not clearly superior, or superior only on some task classes.
- **Promote to default at a specific tier:** change `recommendGenerationModelForHost()`'s ordering
  at that tier only, if evidence shows a clear, reproducible uplift over the current Qwen3 tier at
  matched hardware and quantization. Ship as an install-time recommendation change, not a forced
  migration of already-installed models (existing installs keep what they have; `OverCommitVerdict`
  / `recommendKeepGenerationModel()` logic already treats "coder in the name" as a keep-signal, so
  this needs care if Ornith's tag doesn't self-identify as a coder model).
- **Reject / defer:** if Phase 1 shows no meaningful uplift, or blocking issues (tool-call format
  incompatible without disproportionate new-pattern work, no viable pull path, license/provenance
  concern), record the finding in the registry (`status` moves to whatever EP-GOVERN-002 defines
  for a non-adopted evaluation) and stop. A documented "evaluated, not adopted, here's why" is a
  complete and valuable outcome — matches "governance approves evidence, not provenance."

This phase produces a decision record, not code. It should update the design spec's status field
and file whatever new BI(s) Phase 3 needs, if any.

## Phase 3 — Implementation (only if Phase 2 selects augment or promote)

Scoped once Phase 2 lands; sketch only, not committed work:

1. `local-model-policy.ts`: add `LOCAL_MODEL_TIER` entries with real measured `weightsGb` (Q4
   resident, on-box measured — per the module's existing precedent of citing actual RTX 4090
   measurements, not spec-sheet numbers).
2. `opencode-dispatch.ts`: extend `pickDefaultCodingModel()`'s regex only if the shipped tag
   doesn't already self-identify as a coder model (per Phase 0 finding #3).
3. `ai-inference.ts`: add a textual tool-call marker pattern only if Phase 1 finding #2 shows it's
   needed.
4. `agent-model-defaults.ts`-adjacent classification: assign `minimumTier` for coworker-floor
   eligibility once eval evidence supports a tier assignment.
5. Docs: update `docs/architecture/local-llm-build-engine.md` to describe the model as an
   alternative/addition, not just `qwen3-coder`.
6. Mirror install-script constants (`scripts/detect-hardware-host.ts`, `install-dpf.{ps1,sh}`) per
   the existing "keep these in sync" comment convention in `local-model-policy.ts`.

Exit: `pnpm --filter web exec vitest run` and `pnpm --filter web typecheck` green; UX verification
of the new model appearing/selectable in the Providers UX (`OllamaManagement.tsx`); production build
gate per AGENTS.md §5.

## Risks

- **Vendor benchmark inflation.** Mitigated entirely by Phase 1's requirement to re-measure on
  DPF's own harness at DPF's actual quantization, never trusting the README numbers directly.
- **New/unproven publisher.** Standard tool-evaluation supply-chain scrutiny (Phase 0) is the
  mitigation, same bar as any other adopted tool.
- **Catalog availability unknown.** If no `ai/...` catalog entry exists, Phase 0's pull-path
  determination could turn this into a much larger effort (documenting and shipping a manual GGUF
  import recipe) than a simple tier addition — flag this early rather than discovering it mid-Phase-1.
- **Fragmenting the local-model story.** Mitigated by keeping `LOCAL_MODEL_TIERS` as the single
  source of truth regardless of outcome — Ornith entries follow the exact same tier/selector
  mechanism as Qwen3, not a parallel code path.
