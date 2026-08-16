---
status: phase-2-measured-do-not-proceed
backlogItem: BI-68EED40A
epic: EP-BUILD-STUDIO
date: 2026-08-15
---

> **Outcome (2026-08-16): Phase 2 ran and the gate did NOT open.** Qwen3.8-27B shows no
> tool-selection advantage over either incumbent and is ~4x slower. Phases 4 and 5 are NOT
> executed. See "Phase 2 result" below. The plan is retained because Phase 3 (BI-C2EFF855) and the
> harness-runner work (BI-99A31531) remain valid independent of the tiering decision.

# Qwen3.8-27B as the Local Generation Model — Implementation Plan

Operator request (2026-08-15): "update the installation, and live running environment" to use
Qwen3.8-27B.

Phased so each phase lands as one PR with its own gates, following the precedent set by
[`2026-07-25-ornith-1-local-coding-model-plan.md`](2026-07-25-ornith-1-local-coding-model-plan.md)
(the sibling "should a new local model displace the Qwen3-only ladder" evaluation) and
[`2026-06-10-local-llm-build-agent.md`](2026-06-10-local-llm-build-agent.md) (OpenCode admission).
The backlog item holds the research findings; this file holds the order of operations.

## Backlog coverage

**Backlog item:** BI-68EED40A

- Parent: BI-68EED40A
- Decision: decomposed
- Receipt: cmsv6pq0d07v701rrxkmgdy4m
- Dependencies: Phase 3 and Phase 4 are independent of each other; Phase 5 depends on both. Phase 2 gates everything downstream — a negative measurement stops the ladder change.
- -> BI-C2EFF855
- -> BI-3CF78C8E

## The constraint that shapes this plan

AGENTS.md §1: *"The canonical runtime is the only source of runtime truth… the live install
advances only via `/ops/self-upgrade`"* and *"fix the seed, not the runtime."*

So "update the live running environment" decomposes into two different kinds of action:

- **Model availability** — pulling a GGUF into Docker Model Runner is a runtime resource action,
  reversible, and does not change platform behaviour on its own. Safe to do directly, and required
  in order to measure anything.
- **Model selection** — which model the platform *recommends and pulls at install* is source
  (`LOCAL_MODEL_TIERS` + three mirrors). It reaches the live install through PR → merge queue →
  `/ops/self-upgrade`. Never hand-patched.

This plan does the first immediately (Phase 1) and the second only after Phase 2 produces evidence.

## The evidence problem, stated plainly

Everything currently known about Qwen3.8-27B's quality is **vendor-reported** — Qwen's own model
card, their harness, and baselines they re-evaluated themselves. The numbers are striking
(QwenSWEBench 79.0 vs Qwen3.6-27B's 49.3; OSWorld 84.3 vs 63.9) and the 3.8-vs-3.6 comparison is at
least internally consistent, but AGENTS.md §1 is *"never fabricate — ground every claim in code,
specs, or DB state"* and §7 requires research to state what DPF adopts or rejects and why.

A bad default is a defect on **every** install (§1, *"a symptom on one install is usually a defect
for every install"*, applied forward). So the ladder change in Phase 4 is explicitly gated on
Phase 2 measurement, and Phase 2 has a defined failure exit.

## Phase 0 — Tool admission (no code)

The GGUF comes from HuggingFace, not Docker's curated `ai/` namespace. AGENTS.md §7 requires
external dependencies to go through the `tool-evaluation` skill.

1. Run `tool-evaluation` against `hf.co/ggml-org/Qwen3.8-27B-GGUF`. The publisher is llama.cpp's
   own org — first-party to the inference runtime DMR embeds, and the likeliest upstream for an
   eventual `ai/qwen3.8:27b` tag. Record that reasoning rather than assuming it.
2. Confirm the upstream licence directly (`Qwen/Qwen3.8-27B` states Apache 2.0) — read the LICENSE
   file, not the card paraphrase. This matters more than usual: an install default is redistributed
   to every install, and the operator's posture is OSS steward.
3. Record the decision. If the publisher fails evaluation, the fallback is to wait for the `ai/`
   namespace tag rather than substitute a lower-trust community quant.

**Exit:** a recorded admission decision. No code.

## Phase 1 — Make the model available on the canonical runtime

1. `docker model pull hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M` (19.0 GB).
2. Confirm DMR actually *serves* it — the architecture is new (hybrid Gated DeltaNet + gated
   attention, 64 layers), and a successful pull does not prove the embedded llama.cpp can run it.
   DMR's search index reports backend `llama.cpp` for this repo, which is suggestive, not proof.
3. Record served context, resident size, and tokens/sec at a realistic build context.

**Exit:** the model answers a chat completion through DMR's OpenAI-compatible endpoint. If it does
not, the whole plan stops here and the finding is that DMR cannot yet serve the architecture.

## Phase 2 — Measure, against the incumbent (the gate)

Use the harness that already exists — do not build a new one:

- `apps/web/lib/routing/tool-fidelity-harness.ts` — tool-calling fidelity, the axis that decides
  whether a model can carry a coworker at all.
- `apps/web/lib/routing/golden-tests.ts` / `eval-runner.ts` — routing-level behaviour.

Incumbent for comparison: `ai/qwen3-coder` (30B MoE, 3B active) — the model Qwen3.8-27B would
displace in the 24 GB-discrete / 32 GB-unified band. Both at the same served context.

Two things to watch specifically, because they are the known risks rather than generic ones:

- **Thinking mode is ON by default.** The platform's own capability priors already record that
  reasoning models "emit `<think>` monologue and tend to fabricate rather than emit a tool_call"
  (the `magistral` prior, toolFidelity 30). Measure with thinking on AND off; if fidelity depends on
  it, that is a configuration requirement, not a footnote. Feeds BI-3CF78C8E.
- **Vision needs a separate `mmproj` file.** Measure image capability only after the projector is
  loaded; otherwise the result says nothing. Feeds BI-C2EFF855.

**Exit — and this is a real gate:**
- Wins on tool fidelity → proceed to Phase 4.
- Loses, or wins only with thinking disabled in a way DPF cannot configure → stop. Record the
  finding, leave the ladder alone, keep the BI open against a future revision. This is a legitimate
  outcome, not a failure of the work.

## Phase 2 result (measured 2026-08-16)

Ran on Apple M5 Max / 128 GB via Docker Model Runner. 9 golden cases per point, thinking disabled,
0 errors. Phase 1 passed first: DMR serves the hybrid `qwen35` architecture, 26.90B params,
**17.66 GiB** resident (not the 19.0 GB the HuggingFace repo listing implied), 262,144 context.

Tool-selection accuracy:

| Attached tools | Qwen3.8-27B (dense) | Qwen3.6-35B-A3B (MoE) | Qwen3-Coder-30B (MoE, the incumbent) |
|---|---|---|---|
| 15 | 100.0% | 100.0% | 88.9% |
| 30 | 88.9% | 88.9% | 88.9% |
| 45 | 55.6% | 66.7% | 66.7% |
| mean latency | **10.3s** | 3.6s | **2.6s** |

**Verdict: do not tier.** No accuracy advantage at any surface size (every delta is one case out of
nine — inside the noise floor), and a ~4x latency penalty against the incumbent it would replace.

The latency gap is architectural, not tunable. Qwen3.8-27B is **dense** — all 27B parameters active
per token — while both incumbents are MoE with ~3B active. More total capability per parameter,
far more compute per token. For a coworker doing many turns, that is the dominant cost.

Two findings worth keeping regardless:

- **Thinking mode costs 46% latency and buys nothing here.** Identical accuracy and identical
  misses with `chat_template_kwargs: {enable_thinking: false}`; mean latency 10.9s -> 5.9s at the
  smaller surfaces. Feeds BI-3CF78C8E with measurement instead of argument.
- **`ai/qwen3-coder` pulls with a 4,096-token context** — confirming the warning in
  `local-model-policy.ts` — while Qwen3.8 arrives at 262,144.

### What this measurement does NOT settle

The harness scores single-turn tool SELECTION. The vendor's case for Qwen3.8 is long-horizon
agentic work (QwenSWEBench 79.0 vs 49.3, OSWorld 84.3 vs 63.9). Nothing here speaks to that claim
in either direction — it is silence, not refutation. If the agentic claim is the reason to adopt,
the eval that could adjudicate it does not exist yet and would need building.

### Measurement defect found and corrected mid-run

The first pass used a fabricated distractor tool name (`list_provider`, which does not exist in
DPF; the real tool is `add_provider`). Qwen3.8 was lured by it, producing an apparent 77.8% vs
88.9% gap at surface 30. With the corrected pool both models tie at 88.9% — the entire measured
difference was an artifact of the harness inputs. Recorded here because the first numbers were
reported before the defect was found.

## Phase 3 — Companion-artifact support (BI-C2EFF855)

Independent of the outcome of Phase 2 — this defect already affects Qwen3.6-27B today.

1. Extend `detectLocalModelVision()` in `packages/db/src/local-model-capabilities.ts` with
   Qwen3.6/3.8 mainline vocabulary. Constraints: must not match `qwen3-coder` or the embedders, and
   must stay ReDoS-safe (the module carries CodeQL `js/polynomial-redos` notes — plain substring
   tests, never `.*` between literals).
2. Give `LocalModelTier` optional companion-artifact fields (vision projector, MTP draft) and teach
   the tier selection to count their bytes against the memory budget.
3. Teach both installer paths (`install-dpf.sh` §8b, `install-dpf.ps1` §7) to fetch a declared
   companion artifact.
4. Tests in `packages/db/test/local-model-capabilities.test.ts` and the policy test suite.

## Phase 4 — The ladder change (BI-68EED40A), only if Phase 2 passed

`LOCAL_MODEL_TIERS` has **three mirrors** that drift silently. All four change together:

1. `apps/web/lib/inference/local-model-policy.ts` — canonical.
2. `scripts/detect-hardware-host.ts` — `SELECTION_TIERS` (explicitly marked KEEP IN SYNC).
3. `install-dpf.ps1` ~L1330-1348 — the PowerShell selection ladder.
4. `apps/web/components/platform/OllamaManagement.tsx` — the operator-facing tier display.

Sizing decision to make explicitly, with the measured numbers rather than in advance:

- Q4_K_M (19.0 GB) needs a 24 GB budget with `MODEL_HEADROOM_GB=5` — **zero margin on a 24 GB
  card.** Do not tier this quant for the discrete band.
- A ~16 GB quant (Q4_K_S / IQ4_XS) needs 21.1 GB and lands exactly in the current `ai/qwen3-coder`
  slot. If the discrete band is the target, this is the quant — but it comes from `unsloth`, not
  `ggml-org`, which re-opens Phase 0 for a second publisher.

Also verify against the new weights: `recommendServedContextTokens()`, and the over-commit guard
that exists precisely to catch mirror drift.

## Phase 5 — Advance the live install

Via `/ops/self-upgrade` only. Not a hand-built image, not a worktree server (§1). The pulled model
from Phase 1 is already resident, so the upgrade changes *selection*, not availability.

Confirm afterwards on the running portal that the coworker actually routes to it — structural
verification is not functional verification.

## Out of scope

- The 2.4T-A95B "Max" (1.31 TB) — not a local-install candidate on any hardware DPF targets.
- Raising `MAX_LOCAL_CONTEXT_TOKENS` (131,072) toward Qwen3.8's 262,144 native window. Real, but a
  separate concern with its own KV-cache budget implications — one concern per PR.
- Wiring `reasoning_effort` into the dormant Reasoning Economy substrate. Noted in BI-3CF78C8E as
  the natural follow-on; not this plan.
