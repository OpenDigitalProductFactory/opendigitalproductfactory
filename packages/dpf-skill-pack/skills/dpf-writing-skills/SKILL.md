---
name: dpf-writing-skills
description: "Use when writing a new DPF skill, editing a SKILL.md, changing a skill's assignTo or description, or reviewing a PR that touches the skill corpus."
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Edit Grep Glob Bash(node scripts/check-instruction-plane-size.mjs) Bash(git *)
category: platform
assignTo: ["documentation-specialist", "doc-specialist", "platform-engineer", "external-coding-agent", "build-specialist"]
capability: null
taskType: code_generation
triggerPattern: "write a skill|new skill|edit a skill|skill description|assignTo|skill frontmatter|skill review|add a skill|change a skill|skill corpus|instruction plane"
userInvocable: true
agentInvocable: false
allowedTools: ["Read", "Edit", "Grep", "Glob", "Bash"]
composesFrom: ["dpf-verify-substrate-first", "dpf-unslop"]
contextRequirements: ["the skill corpus on disk", "scripts/check-instruction-plane-size.mjs runnable"]
riskBand: medium
enforces:
  - kernel/principles/architecture-over-shortcuts
  - kernel/principles/single-source-of-truth
---

# DPF Writing Skills

> **Why this skill is user-invocable only.** Writing or revising a skill is a
> deliberate act, like `dpf-establish-coworker` or `dpf-add-archetype` — not
> something to pull into an unrelated turn. Marking it `agentInvocable: false`
> costs zero per-turn eligibility slots on the five roles it is assigned to.
> A skill that teaches this cost model and then charged 5 slots for ambient
> availability would be advice its own author did not take. Reach for it by
> name, or let `skills/universal/add-skill.skill.md` route you here.

A skill is not free text. Adding one, or widening one, spends two budgets that are already at their limits, and the platform enforces both mechanically. Write to the budget first and the prose second.

Everything below was measured on the live install, not assumed. The numbers are current as of 2026-08-23; re-measure rather than trusting this page if the corpus has moved.

## The two budgets

**1. Per-turn eligibility.** `apps/web/lib/skills/skill-relevance.ts` sets `DEFAULT_SKILL_SUMMARY_CAP = 12`. Every skill assigned to a coworker injects its one-line summary into that coworker's system prompt on **every turn**; past 12, the relevance ranker silently drops the rest. So each `assignTo` entry spends one of twelve slots for that coworker, permanently.

`assignTo: ["*"]` is not a convenience. `SKILL_WILDCARD_AGENT_IDS` expands it across **31 coworkers**, including personas that appear in no `assignTo` list at all — `dispatcher`, `finance-controller`, `security-engineer`, `legal-operations-counsel` and others carry the wildcard floor and almost nothing else. A single wildcard skill is 31 charges.

This went wrong once already: 14 dev-agent pack skills carried `["*"]`, real eligible sets ran 16-32 against a cap of 12, and **28 of 31 coworkers were over** — a marketing-specialist was paying a per-turn tax for `dpf-tdd` (BI-4B0C27D4). After rescoping, 4 remain over, all dev-facing roles that legitimately hold that many dev skills.

**2. Always-on bytes.** `scripts/instruction-plane-manifest.json` counts every pack skill's `name` + `description` in the always-on plane, and `scripts/check-instruction-plane-size.mjs` permits that total to **shrink only**. The plane sits at its baseline. A new pack skill therefore **fails CI on arrival** unless you recover the bytes first.

Recovering them is not a chore to resent — it is the same discipline the description rule below describes, applied to skills that already shipped.

## Description is a trigger, not documentation

The only job of `description` is to make the right agent load the file at the right moment. It is read on every turn by every agent that could use the skill; the body is read only when the skill is actually invoked.

So: pack the description with the words a caller would use, and put everything else in the body.

| Belongs in `description` | Belongs in the body |
|---|---|
| When to reach for this, in the caller's vocabulary | How the procedure works |
| Concrete triggers: surfaces, artifacts, symptoms | What it composes with (`composesFrom` already encodes this) |
| The boundary — when NOT to use it | Lineage: "replaces the retired X", "the DPF-native step" |

A clause that names another skill, describes internals, or explains provenance is costing always-on bytes on every turn to tell an agent something it does not need in order to decide. Ten such clauses were cut for 961 bytes in BI-21A0FE70; three more for 849 bytes to make room for this file.

## Two planes, two size budgets

| plane | path | typical body | audience |
|---|---|---|---|
| coworker | `skills/**/*.skill.md` | **~2 KB** | in-portal coworkers, often on a local model |
| dev-agent pack | `packages/dpf-skill-pack/skills/*/SKILL.md` | ~8.7 KB | Claude / Codex / Grok / Antigravity sessions |

Do not port a pack-sized procedure onto the coworker plane. Local priors in `packages/db/src/local-model-capabilities.ts` put Qwen at `contextRetention: 55` and Gemma at `45` — the weakest dimension in both. A long multi-phase skill on that tier is not followed and then abandoned; it is followed *partially*, silently, mid-procedure. Coworker-plane skills should be declarative and short.

The same reasoning shapes content, not just length. Prefer a bounded generation task over a multi-turn planning task: numbered questions with candidate answers beat an adaptive interview, and a formatter with named slots beats "compose a good hand-off".

## Both surfaces of a pack skill must agree

A pack SKILL.md carries two invocation vocabularies:

- **Surface A** — `disable-model-invocation`, `user-invocable`, `allowed-tools` (read by Claude Code / Codex / Grok)
- **Surface B** — `agentInvocable`, `userInvocable`, `allowedTools` (read by the in-portal seed loader)

`validateDpfPlatformSkillFrontmatter` rejects contradictions, and `normalizeSkillFrontmatterForSeed` derives `agentInvocable` from `disable-model-invocation` when it is absent. Set them deliberately and set them together. A skill only sensible on explicit invocation should say so — otherwise it competes for an eligibility slot on every unrelated turn. That field was uniform across 101 of 102 skills and therefore carried no information at all (BI-8AD9D018).

## Before you change an existing skill

Run `dpf-verify-substrate-first` against the skill you are about to touch, and specifically **grep the test suite for its name**. Skills carry contracts that are not visible in the file.

`BI-5E8E231E` requires four decision skills — `dpf-decision-via-kernel`, `dpf-retrieve-decision-context`, `dpf-compare-options`, `dpf-record-decision-outcome` — to stay `assignTo: ["*"]` so every persona inherits the WWMD/WWWD stack. Rescoping them broke CI and had to be reverted, because the option set that decision was made from never mentioned the constraint. A kernel ruling is only as good as the facts the caller gathered before framing it.

## Steps

1. **Decide the plane and the audience.** Which coworkers or which dev surfaces genuinely need this? "Everyone" is an answer that costs 31 slots; make it deliberately or not at all.
2. **Check the budget before writing.** `node scripts/check-instruction-plane-size.mjs`. If the plane is at baseline, recover bytes first — trim non-trigger clauses from existing descriptions and land that as part of the same change.
3. **Search for overlap and for contracts.** Existing skill with the same trigger vocabulary? Existing test asserting this skill's frontmatter?
4. **Write the description as a trigger.** Caller's words, concrete surfaces, the boundary. No lineage, no internals.
5. **Write the body to the plane's budget**, declarative on the coworker plane.
6. **Set both invocation surfaces deliberately**, and register the skill in `packages/dpf-skill-pack/capability-packs.json` if it belongs to a pack.
7. **Run the guards before pushing** — the instruction-plane ratchet, `seed-skills.test.ts`, and `skill-relevance.test.ts`.
8. **Apply `dpf-unslop`** to the description and body. This is text a person will read.

## The guards that will fail you

They are the contract, not an obstacle. Each exists because the rule above was broken once.

| guard | fails when |
|---|---|
| `check-instruction-plane-size.mjs` | pack `name`+`description` bytes grow at all |
| `seed-skills.test.ts` | a plane's invocation classification goes uniform; the two surfaces contradict |
| `skill-relevance.test.ts` | the wildcard set grows past its baseline, exceeds half the cap, or any role's eligible set grows |
| `check-prose-lint.ts` | authored copy readability regresses |

## Guardrails

- **Never widen `assignTo` to `["*"]` to avoid deciding.** It is the single most expensive edit available in this corpus.
- **Never add a pack skill without first recovering description bytes.** The plane is frozen; the ratchet is not negotiable.
- **Never lengthen a description to explain the skill.** If a reader needs it to understand the skill, it belongs in the body.
- **Never demote a skill to `agentInvocable: false` merely to fit under the cap.** That hides the cost rather than deciding it; rescope `assignTo` instead.
- **Re-measure rather than trusting the numbers on this page.** They were true on 2026-08-23 and the corpus moves.

## See also

- Substrate check before claiming a skill is missing: [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md)
- Editing the prose once the shape is right: [`dpf-unslop`](../dpf-unslop/SKILL.md)
- The coworker-plane authoring flow: `skills/universal/add-skill.skill.md`
