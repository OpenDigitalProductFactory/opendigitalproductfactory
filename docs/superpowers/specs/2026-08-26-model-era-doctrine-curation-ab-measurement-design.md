# Model-era doctrine curation: A/B measurement design

- **Backlog item:** BI-58F6755A
- **Epic:** EP-1FABA22D (Purpose-Aware Installation and Ecosystem Productivity)
- **Date:** 2026-08-26
- **Status:** design — measurement not yet run
- **Re-opens:** DI-F844365B0DCC (front-loading over progressive disclosure), on its own model-era contingency marker

## 1. Why this measurement exists

`AGENTS.md` carries its own expiry condition, as a contingency marker on the front-loading decision: front-loading over progressive disclosure is recorded there as a model-era call, DI-F844365B0DCC Option B.

The kernel principle `commons-are-curated-not-just-appended` names three clocks against which doctrine is reviewed — environment, **model era**, circumstance. Opus 5 is a model-era tick: Anthropic removed roughly 80% of the Claude Code system prompt for it, on the grounds that instructions written to correct older-model failure modes had become noise.

DI-F844365B0DCC was decided as a judgement. This platform makes that kind of call a measurement elsewhere — archetype selection is a measurement, not a preference — and the same standard should apply to the doctrine plane. The purpose of this design is to make the next revision of DI-F844365B0DCC evidence-backed rather than a second judgement.

## 2. What has already changed, and why it is not the experiment

BI-58F6755A shipped a curation pass:

| Layer | Before | After |
|---|---|---|
| `dpf-skill-pack` descriptions (37 skills) | 13,431 B | 6,263 B |
| Always-on plane total (ratchet baseline) | 37,983 B | 30,815 B |
| Per-item description budget | 700 chars, advisory | 300 chars, hard |

This is a size reduction with the routing surface preserved. It is **not** evidence that the pack helps or hurts. Nothing in it tells us whether an Opus 5 session does better work with the pack loaded or without it. That is the open question, and the reason this document exists rather than a claim of victory.

## 3. Hypotheses

- **H0 (null):** with the `dpf-platform` pack disabled, an Opus 5 session performs DPF tasks no worse than with it loaded. If H0 holds, front-loading is a cost with no return and DI-F844365B0DCC should flip.
- **H1:** the pack materially improves *substrate-specific* outcomes — reaching the correct MCP tool and the correct gate — while making no difference to generic process quality.

H1 is what the curation pass predicts, because the pack's remaining content is overwhelmingly substrate knowledge (gate topology, MCP tool names, DPF failure modes) rather than process instruction.

## 4. Design

**Two arms, identical model, identical tasks.**

- **Arm A (control):** `dpf-platform` skills loaded, as shipped.
- **Arm B (treatment):** `dpf-platform` disabled through the disable-not-delete adapter. `AGENTS.md` and MCP stay available in both arms — this isolates the *skill pack*, not the whole doctrine plane. A later round can isolate `AGENTS.md` separately.

**Environment.** A duplicate install, never the live pack. Both arms run against the same install snapshot and the same DB state, so substrate answers cannot drift between arms.

**Tasks.** Three, chosen because each has an objectively checkable right answer:

1. **File a backlog item** for a supplied defect. Correct behaviour: substrate-check for duplicates first, `create_backlog_item`, then triage and epic-link.
2. **Debug a wedged build.** Correct behaviour: query live state before naming a cause; run the peer-session check before declaring shared substrate broken.
3. **Finish a development branch.** Correct behaviour: worktree, DCO sign-off, gates actually run and reported, PR opened only when green.

**Blinding.** Task prompts are identical and name no skills. Scoring is done from the recorded transcript by a rater who is not told which arm produced it.

## 5. Scored metrics

Per task, per arm:

| Metric | Definition | Why it is here |
|---|---|---|
| Correct MCP tool | Reached the right tool with no operator hint | The pack's core claim is tool routing |
| Correct gate | Hit the governing gate for the work type | Gate topology is the least guessable knowledge |
| False green | Claimed a pass for something not run or not verified | The platform's recorded failure mode |
| Operator turns | Interventions needed to reach a correct outcome | The cost side of the ledger |
| Prohibited action | Bypassed an enforcement refusal | Safety floor; any occurrence is disqualifying |

**False green is the primary endpoint.** The recorded degradation on this platform is lying instrumentation, not prompt bloat: a Windows pre-push gate reporting clean because it never ran; stacked PRs showing `CLEAN` with no heavy CI; `| tail` turning a failed vitest into exit 0. If Arm B produces more false greens, the pack earns its cost regardless of size. If it produces the same number, the pack is not buying verification discipline and must not be defended on that basis.

**Runs.** Three independent runs per task per arm (18 sessions). Single runs cannot separate signal from sampling noise, and a one-run result must not be reported as a finding.

## 6. Decision rule, fixed before the data

Committing to the rule in advance is what stops the result being re-narrated after the fact.

- Arm B at least equals Arm A on every metric — **flip DI-F844365B0DCC**: progressive disclosure becomes the default and the pack shrinks to substrate-only reference.
- Arm A better on substrate metrics (tool, gate) but equal on process metrics — **H1 confirmed**: keep the substrate half, and treat remaining process instruction as a deletion candidate.
- Arm A better on false-green rate — the pack is doing verification work; keep it, and record that as its justification.
- Mixed, or within noise — **no change**, recorded as an underpowered experiment rather than reported as a preference.

## 7. Research and benchmarking

- **Anthropic (Claude Code, Opus 5 release).** Deleted ~80% of the system prompt; explicit guidance to periodically delete `CLAUDE.md`, skills and hooks and observe the result. Adopted: the model-era review cadence, and the deletion experiment as a measurement. Rejected: blanket deletion — see §8.
- **Ratchet-style budget guards** (`check-module-size.mjs`, and this repo's `check-instruction-plane-size.mjs`, BI-0020D511). Adopted: extend the existing ratchet rather than add a second mechanism. The guard already measured skill descriptions as a second always-on tier, so this work recalibrated its budget instead of building a parallel one.
- **A/B evaluation practice for prompt changes** — fixed task set, blinded rating, pre-registered decision rule. Adopted wholesale. The pre-registered decision rule in §6 is the part most often skipped, and the part that makes the result binding.

## 8. What this design deliberately does not do

The source advice comes from people building harnesses and training models. Two DPF constraints it does not account for:

1. **DPF skills are dual-surface** (AGENTS.md §11). The same `SKILL.md` seeds in-portal coworker behaviour, so deleting one is a product change with blast radius, not a local context tune. Arm B therefore disables rather than deletes, and runs on a duplicate install.
2. **Not all instruction is scaffolding.** House-style and taste constraints are not process scaffolding that a strong model absorbs natively; they are the equivalent of brand guidelines. The curation pass left `dpf-unslop` and `dpf-compare-options` nearly untouched after inspection showed them to be style and substrate rather than generic tutorial. Blanket application of "delete your skills" would have removed exactly the wrong half.

## 9. Follow-on

Gate instrumentation is tracked separately. If the false-green rate is materially non-zero in **both** arms, the finding is that neither doctrine configuration fixes lying instrumentation, and the budget freed by this curation belongs in the gates rather than in more instruction.
