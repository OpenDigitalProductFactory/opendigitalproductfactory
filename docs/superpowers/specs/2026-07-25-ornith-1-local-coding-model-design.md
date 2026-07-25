---
status: proposed
backlogItem: PENDING-MCP-FILING
epic: EP-BUILD-STUDIO
date: 2026-07-25
---

# Ornith-1.0 as a Local Coding Model Option — Research & Design

## Origin

Operator request: investigate `deepreinforce-ai/Ornith-1` (github.com/deepreinforce-ai/Ornith-1)
for applicability to DPF, then capture the research, file it to the backlog, and take one more
pass at a design + plan for evaluating it as a coding method — augmenting or possibly replacing
part of the existing local-model story, pending more fit data.

**MCP/DB availability note (read first):** this research and design was produced in a Claude Code
on the web / remote session with no reachable `dpf` MCP connector (no `.mcp.json` bearer token
resolved, `http://127.0.0.1:3000` not serving) and no reachable live Postgres (`DATABASE_URL` only
present in `.env.*.example` templates; no Docker daemon in this sandbox). Per AGENTS.md §6 and the
`dpf-writing-plans` skill guardrail ("No silent MCP bypass — unreachable MCP, a missing tool, or
insufficient token scope stops planning before source implementation"), this session does **not**
fabricate a `BacklogItem` row or a `record_plan_backlog_coverage` receipt. The exact BI content is
drafted below, ready to file from a session with live `dpf` MCP or DB access. Everything else in
this doc (research findings, design, phased plan) is real analysis grounded in the current repo.

## Research: what Ornith-1.0 is

Source: `https://github.com/deepreinforce-ai/Ornith-1` README (fetched 2026-07-25; **vendor's own
claims, not independently corroborated** — see Open Questions).

- **What:** a family of open-source LLMs post-trained specifically for *agentic coding* —
  autonomous software-engineering tasks, not general chat.
- **Sizes:** 9B-Dense, 31B-Dense, 35B-MoE, 397B-MoE.
- **Base models:** post-trained on Gemma 4 and Qwen 3.5.
- **Training approach:** described as a "self-improving framework" using reinforcement learning
  that optimizes both solution generation and the agent scaffolding around it.
- **Capabilities claimed:** chain-of-thought reasoning with thinking/output separation, native
  function calling / tool integration, 256K context window.
- **Serving:** vLLM, SGLang, Hugging Face Transformers; bf16, FP8, and GGUF precisions; exposes an
  OpenAI-compatible API.
- **Benchmarks claimed:** the 397B variant is positioned as competitive with larger proprietary
  models on Terminal-Bench 2.1, SWE-Bench, and NL2Repo.
- **License:** MIT, "globally accessible, and free from regional limitations" (per README —
  Open Questions below flags that the actual `LICENSE` file has not yet been read directly).
- **Intended deployment:** OpenHands, Hermes Agent, OpenCode integrations named explicitly.

## Why this is relevant to DPF

DPF already has a governed, shipped local-coding-model story that this would extend, not
originate:

- **`apps/web/lib/inference/local-model-policy.ts`** — `LOCAL_MODEL_TIERS`, the single source of
  truth for which local generation model a host runs, is **Qwen3-family only** today:
  `qwen3-coder-next` (80B MoE) → `qwen3.6:35B-A3B` → `qwen3-coder` (30B MoE, "the 24 GB-card sweet
  spot") → `qwen3:14B` → `qwen3:8B` → `qwen3:4B`. Every tier is sized in Q4-resident GB and
  selected by `recommendGenerationModelForHost()` against detected VRAM/RAM.
- **`apps/web/lib/integrate/opencode-dispatch.ts`** — `pickDefaultCodingModel()` already prefers
  *any* served model whose id matches `/coder|[-_]code\b|code[-_]/i` **before** it falls back to a
  Qwen3-specific regex, then to the first remaining chat model. A model served under a tag like
  `ornith-coder` would already win the existing preference order with **no code change**; a tag
  without "coder"/"code" in it would fall through to "any remaining chat model" (still usable, just
  unpreferenced).
- **`apps/web/lib/inference/ai-inference.ts`** — `extractTextualToolCalls()` already parses
  Gemma/Llama-style textual `<tool_call>...</tool_call>` markup for local models that don't emit
  OpenAI-native structured `tool_calls`. Ornith is post-trained on Gemma 4 + Qwen 3.5, so its
  native tool-call emission format needs to be checked against this parser, not assumed compatible.
- **`packages/db/src/agent-model-defaults.ts`** — every AI coworker declares a `minimumTier`
  (`basic`/`adequate`/`strong`), `budgetClass`, `minimumCapabilities` (e.g. `toolUse`), and
  `minimumContextTokens`. Slotting Ornith in as a routable model requires classifying it into this
  scheme so coworker-floor eligibility resolves correctly — this is a governance gate
  (`establish_coworker` conformance), not a config toggle.
- **`docs/architecture/local-llm-build-engine.md`** — the canonical local-AI-build strategy doc,
  currently framed entirely around `qwen3-coder` via Docker Model Runner (DMR) as the model behind
  the `opencode` Build Studio dispatch engine (`EP-BUILD-STUDIO`, `BI-01D6A51B`,
  `docs/superpowers/specs/2026-06-10-local-llm-build-agent-design.md`). That spec already
  benchmarked several *harness* alternatives (OpenCode, Aider, OpenHands, etc.) against Claude/Codex
  and set the pattern this doc follows for a *model* alternative: evaluate on evidence, admit at
  `preview` tier, promote only when eval history earns it. It also recorded the operating
  benchmark reality as of June 2026: consumer-hardware local tiers (30B-class) land around
  35–55% on SWE-bench Verified vs. ~80% for the best open-weight giants and ~88.6–95% for frontier
  Claude/current-frontier — the bar Ornith's claimed numbers should be read against.
- **Tool Evaluation Pipeline (EP-GOVERN-002)** — `ToolEvaluation.toolType` already has an
  `"ai_provider"` case (`docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md`),
  and `packages/db/data/approved_tools_registry.json` has a direct precedent entry shape to follow
  (the `opencode` npm-package entry: `status: "conditional"`, license finding, supply-chain finding,
  live-verified integration finding, `conditions[]`, `reEvaluateAfter`). A new Ornith entry would
  use the same shape with `toolType: "ai_provider"`.

## Design

### Framing: augment first, decide replace/keep-both/reject only from eval evidence

The operator explicitly does not want a premature replace-vs-augment call. That matches DPF's own
precedent: the 2026-06-10 opencode spec did not declare OpenCode superior to Claude/Codex — it
admitted it at `tier: "preview"` and required real eval evidence (`classifyOutcome()` results on
actual dispatched builds, optionally mini-SWE-agent benchmarking) before any tier promotion.
"Governance approves evidence, not provenance" (2026-06-10 spec, Capability tier section) is the
operative principle here too.

Concretely, Ornith should land as an **additional selectable local generation model**, not a
default-tier swap:

1. **`LOCAL_MODEL_TIERS` gains Ornith entries** at whichever sizes are realistically hostable
   (9B-Dense and 31B-Dense/35B-MoE map onto the existing 8B/14B and 30B/35B hardware bands; the
   397B-MoE is out of reach of any local install tier documented here, same as it would be for any
   model at that size — this is a *server-class* model, not a local one).
2. **No forced default change.** `recommendGenerationModelForHost()` keeps recommending the
   Qwen3 tiers unless/until eval evidence justifies changing the recommendation function's
   ordering. An operator can still explicitly select an Ornith tier via the Providers UX
   (`OllamaManagement.tsx`) once it is a known tier + pullable.
3. **Coder-preference tag check.** Confirm what tag Ornith is actually published under in whatever
   catalog DPF pulls from (Docker Model Runner `ai/...` catalog vs. manual GGUF import — see Open
   Questions). If the published tag doesn't already match opencode's `/coder|code/i` preference
   regex, that's a one-line, low-risk addition to `pickDefaultCodingModel()` — not a redesign.
4. **Model floor classification.** Once eval evidence exists, classify Ornith's tiers into the
   `minimumTier`/`minimumCapabilities`/`minimumContextTokens` scheme so it becomes eligible for
   coworker routing on the same terms as any other local model — this is what actually determines
   "augment" (coexists as a routable option) vs. staying inert in the catalog.
5. **Tool-call format.** Verify empirically whether Ornith emits OpenAI-native `tool_calls` or a
   textual marker format, and whether the existing `extractTextualToolCalls()` patterns
   (Gemma/Llama style) already cover it or need a new pattern. This gates whether it can drive the
   `opencode` agent loop at all, independent of raw benchmark quality.

### What "replace" would require, if the evidence supports it

Only after Phase 2 (below) produces head-to-head evidence on DPF's actual hardware tiers would a
"replace the Qwen3 default at tier N" change be justified — and even then, per the migration-safety
and fleet-wide doctrine in AGENTS.md §2, changing an install's *default* recommended model is a
behavior change that should ship as an operator-visible option first (already true here, since
`LOCAL_MODEL_TIERS` selection is host-driven, not silently mutated) before any change to
`recommendGenerationModelForHost()`'s ordering.

## Open questions / risks (unverified — do not treat as settled)

- **Benchmark provenance.** All performance claims are the vendor's own README; no independent
  SWE-bench/Terminal-Bench reproduction has been done by DPF. Treat as a hypothesis to test with
  DPF's own eval harness (mini-SWE-agent precedent from the 2026-06-10 spec), not a fact to route
  on.
- **Publisher provenance.** `deepreinforce-ai` is a new/unfamiliar org to this codebase; no history
  of prior DPF interaction. Standard tool-evaluation supply-chain scrutiny applies (who maintains
  it, release signing, weight provenance/checksums on Hugging Face).
- **License file, not just README.** The MIT claim should be verified against the actual `LICENSE`
  file in the repo/weights release, not the README's paraphrase, before any registry entry claims
  "MIT" as verified (mirrors the opencode registry entry's explicit license finding with an
  `evidence` URL).
- **Catalog availability.** Unconfirmed whether Ornith ships in Docker's `ai/...` model-runner
  catalog (the mechanism `LOCAL_MODEL_TIERS` pulls from today) or would require a manual GGUF
  import/`docker model package` step — this materially changes Phase 0 effort.
- **Tool-call format compatibility**, as above.
- **Quantization quality at the sizes DPF can actually host** (Q4/Q4_K-class, per
  `LocalModelTier.weightsGb` conventions) — vendor benchmarks are typically run at full/bf16
  precision, not the quantized weights an install would actually run.

## Out of scope for this design

- The 397B-MoE variant (server-class; no DPF local-install tier reaches it).
- Any change to the cloud-credentialed `claude`/`codex`/`grok` Build Studio dispatch engines.
- Automatic frontier-escalation routing (tracked separately under `EP-COST-001` per the 2026-06-10
  spec's Out of scope section).
- Declaring a replace/augment/reject verdict — that is exactly what Phase 2 below produces evidence
  for.

## Draft BacklogItem (file from a session with live `dpf` MCP/DB access)

```
type: product
workType: tool
source: user-request
epicLink: EP-BUILD-STUDIO
title: Evaluate Ornith-1.0 as an additional local Build Studio coding model
description: >
  Ornith-1.0 (deepreinforce-ai, MIT, OpenAI-compatible, agentic-coding-tuned,
  9B/31B/35B-MoE/397B-MoE) is a candidate additional entry in LOCAL_MODEL_TIERS
  alongside the current Qwen3-only tiers, feeding the opencode Build Studio
  dispatch engine (EP-BUILD-STUDIO / BI-01D6A51B). Run it through the Tool
  Evaluation Pipeline (EP-GOVERN-002, ai_provider) and DPF's existing local-model
  eval harness (mini-SWE-agent precedent) before deciding augment vs. replace vs.
  reject for any hardware tier. See design:
  docs/superpowers/specs/2026-07-25-ornith-1-local-coding-model-design.md and
  plan: docs/superpowers/plans/2026-07-25-ornith-1-local-coding-model-plan.md.
```
