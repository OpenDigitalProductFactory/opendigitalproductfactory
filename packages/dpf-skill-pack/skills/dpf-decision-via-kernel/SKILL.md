---
# Single fields shared by both surfaces
name: dpf-decision-via-kernel
description: "Use when an open DPF question has two or more architecturally-distinct options that need kernel scoring."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__principle_decide mcp__dpf__wiki_query

# DPF coworker fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["*"]
capability: null
taskType: deliberation
triggerPattern: "open question|trade-off|which approach|2-3 options|architectural decision|how should we"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__principle_decide", "mcp__dpf__wiki_query"]
composesFrom: ["dpf-brainstorming"]
contextRequirements: ["principle_decide MCP tool reachable"]
riskBand: low

# Kernel principle enforcement (informational, both surfaces)
enforces:
  - kernel/principles/structural-verification-is-not-functional
  - kernel/principles/architecture-over-shortcuts
  - kernel/principles/research-before-implementing
---

# DPF Decision via Kernel (WWMD)

When you face an open question with 2+ architecturally-distinct options inside the DPF codebase, **do not pick by gut**. Map each option to the closed `PRINCIPLE_DIMENSIONS` registry, call the `principle_decide` MCP tool, and surface the contribution ledger to the operator. This is "What Would Mark Do" (WWMD) as a tool, not a guess — and it sits in front of `dpf-brainstorming` whenever the brainstorm produces multiple viable options.

> **Surface boundary (WWMD vs WWWD).** This skill is the **platform-development (WWMD)** decision surface — it scores against the founder kernel and is for DPF contributors and Build Studio *platform* work. It is **not** the path for a customer's *business* decision: those route through the Decision Perspective Gate against the organization's **WWWD** profile, which enforces the non-inherit boundary (a customer profile does not inherit platform business judgment as authority). The two surfaces are being consolidated so the Gate is the single governed door (BI-E1FB2307). See [AGENTS.md §11](../../../../AGENTS.md) and `docs/user-guide/ai-workforce/decision-perspective.md`.
>
> **The org WWWD corpus is now populated at onboarding** (company mission + org-overlay `stance`/`principle` pages, seeded from the chosen archetype — BI-CC64ECE4). So "what would *we* do?" answers from the **organization's own doctrine first**: gather it with `dpf-retrieve-decision-context` (query `wiki_query` for org-overlay `stance`/`heuristic`/`principle` pages + the company mission) and let it govern. Fall back to this kernel/WWMD path **only when the org corpus is silent** on the question — never substitute Mark's platform doctrine for a business call the org has its own stance on.

## When to use

- Authoring a spec and `dpf-brainstorming` produced 2-3 candidate approaches.
- Reviewing a design doc with open questions in §X.
- Mid-implementation choice: refactor vs special-case, schema migration shape A vs B, tool surface async vs sync, eager vs lazy materialization.
- Operator asks "which way should we go on X?" with no obvious answer.

## When NOT to use

- The decision is purely empirical (perf benchmark, security audit, load test). Use evidence, not principles.
- The decision is operator-only (business strategy, naming, branding). Surface the trade-off; let the operator decide.
- The options are not yet enumerated. Brainstorm first (`dpf-brainstorming`), then return here.
- Single-option situations. The kernel doesn't add value when there's nothing to weigh.

## Read first

| Source | Path | What to extract |
|---|---|---|
| Dimension registry | [packages/db/src/wiki-taxonomy.ts](../../../../packages/db/src/wiki-taxonomy.ts) | The closed `PRINCIPLE_DIMENSIONS` list — every key in your feature vector must be in this list |
| Relevant principles | [docs/founder-kernel/wiki/principles/](../../../../docs/founder-kernel/wiki/principles/) | The kernel rules that govern this decision class (also queryable via `mcp__dpf__wiki_query` filtered on `pageKind='principle'`) |
| Context | The spec or design under deliberation | The actual question and what makes the options distinct |

## Enforces

- `kernel/principles/structural-verification-is-not-functional` — don't claim a decision is sound because the spec compiles; verify it survives kernel scrutiny.
- `kernel/principles/architecture-over-shortcuts` — the kernel weights long-term maintainability highly; quick fixes consistently lose.
- `kernel/principles/research-before-implementing` — kernel consultation IS the research step for decisions where principles apply.

## Steps

1. **Enumerate the options.** 2-4 options is the sweet spot; more than 4 dilutes the weighing. Each option needs a clear `id` (short slug) and a `description` (1-2 sentences naming what makes it distinct).

2. **Map each option to PRINCIPLE_DIMENSIONS.** Score **at least 3 axes per option** (MCDA coverage floor, BI-1D23EC26) — prefer 4–6 for discrimination. Score each option 0.0 to 1.0 on the question **"how much does this option EXHIBIT this axis?"** — a magnitude, *never* a goodness rating. You no longer need to read the registry file: the tool schema enumerates every valid key and says what a high score asserts on each.
   - **On a COST axis, higher is WORSE.** `blast_radius`, `human_cognitive_load`, `vendor_lock_in`, `business_disruption` are costs: the governing principle carries a *negative* weight, so a high score **penalises** the option. Scoring your preferred option `blast_radius: 0.9` because it is "safe" inverts the meaning and argues against it. Score the *reach*, not the safety.
   - This is the **structured-alignment** path. Even crude scores produce much stronger signal than the semantic fallback.
   - **`features: {}` is NOT a safe default — it usually produces a null result.** The semantic fallback only fires for a principle whose `dimensionVector` is empty. Commandments load from Postgres *with* full vectors, so they always take the structured path, and a commandment-dominated consult with no features scores **exactly zero on every principle** → `insufficientSignal: true`, `recommendation: null`. Measured: 16.7% of the first 156 recorded consults landed there. Reserve `features: {}` for the rare case where core/contextual principles carry the decision.
   - **Read `data.signalQuality.usable` before acting on `data.recommendation`.** `usable: false` means the kernel abstained, not that the options tied. `signalQuality.advisory` names the remediation.
   - Unknown feature keys are **rejected**, not ignored — a typo used to score silently as zero.
   - **Interface-surface changes are NOT eligible for the `features: {}` escape.** When an option adds or changes a button, fillable field, form, or route, you must score it — interface surface is governed by [`remove-avoidable-failure-opportunities`](../../../../docs/founder-kernel/wiki/principles/remove-avoidable-failure-opportunities.md) (§"Interface surface is failure surface"): a new control must *earn its surface*. Derive features the way [`apps/web/lib/decision/ui-surface-features.ts`](../../../../apps/web/lib/decision/ui-surface-features.ts) does — `human_cognitive_load` is a **cost** axis (negative-weighted since #1904), bought down by **justification/research**, **long-term reuse across multiple internal outcomes**, and **clarification value**. An unjustified new surface scores against the principle; a net **removal** scores favorably. "We might want it" is not justification — score it `low`, not no-op.

3. **Invoke `principle_decide`.** Always pass a **normalized** `callingSurface` so the Decision Governance log can attribute the consult by client (BI-D5ACBAE2). Free-form labels (`"Codex desktop"`, `"Codex"`, thread titles) fragment adoption metrics — use one of:

   | Surface | `callingSurface` value |
   |---|---|
   | Grok Build / Grok desktop | `grok-desktop` |
   | Claude Code / Claude desktop | `claude-desktop` |
   | Codex CLI / Codex desktop | `codex-desktop` |
   | Antigravity | `antigravity-desktop` |
   | Build Studio phase | `build-studio` |
   | In-portal coworker | `coworker` |

   Optional suffix for a thread: `grok-desktop:<short-slug>` (e.g. `grok-desktop:process-decision-gaps`). Never put the full question in `callingSurface`.

   ```
   mcp__dpf__principle_decide({
     context: "<one-sentence framing of the question>",
     options: [
       { id: "<slug>", description: "<distinctive text>", features: { <dim>: 0..1, ... } },
       { id: "<slug>", description: "<distinctive text>", features: { <dim>: 0..1, ... } }
     ],
     callingPopulation: "in_platform_coworker" | "external_coding_agent" | "human",
     callingSurface: "grok-desktop" | "claude-desktop" | "codex-desktop" | "antigravity-desktop" | "build-studio" | "coworker" | "<surface>:<slug>",
     ringScope: [ "<one of PRINCIPLE_RING_SCOPES>" ]  // optional, defaults to universal
   })
   ```

   For external coding agents (Grok/Claude/Codex/Antigravity) use `callingPopulation: "external_coding_agent"`.

4. **Read the contribution ledger.** The result contains `signalQuality` (**check this first**), `scores`, `flags`, `reasoning`, and **`ledger`** (persistence outcome).
   - **`signalQuality.usable: false`** → there is NO verdict. Do not read `recommendation` (it is `null`). Follow `signalQuality.advisory`.
   - **`signalQuality.autonomyEligible: true`** → quality gates passed (high confidence, ≥3 feature axes/option, weight sensitivity stable, no commandment conflict, strong structured coverage). **Only then** may an agent auto-proceed without operator ratification.
   - **`autonomyEligible: false` with usable recommendation** → advisory only. Surface the ledger + `autonomyBlockers` (e.g. `feature_coverage_weak`, `sensitivity_unstable`). Do not unattended-execute.
   - **Commandment conflict** → defer/escalate; never auto-bypass.
   - **`ledger.recorded`** → if `true`, keep `ledger.interactionId` (DI-*) and continue with [`dpf-record-decision-outcome`](../dpf-record-decision-outcome/SKILL.md). If `false`, name `ledger.reason` to the operator.
   - Math identity: scoring is **weighted-sum MCDA (WSM)**, not Saaty AHP eigenvectors. See `docs/superpowers/research/2026-08-10-decision-vector-science-and-corpus-adequacy.md`.

5. **Surface the ledger, not just the answer.** Report chosen option, top contributors, `autonomyEligible`, blockers, and the **DI id**. Operator ratifies when autonomy is not eligible. Then run `dpf-record-decision-outcome` so the workroom (if any) points at the same DI.
## Output template

```
**Kernel consultation result.**

- Question: <one sentence>
- Options considered: <id1>, <id2>, [<id3>]
- Recommendation: <winning id> (composite <score>, margin <margin>, confidence <high|low>)
- autonomyEligible: <true|false> blockers: <list or none>
- Top positive contributors: <principle name 1> (+<contribution>), <principle name 2> (+<contribution>)
- Top negative contributors: <principle name> (<contribution>)  (if any)
- Flags: <commandment conflict / feature coverage / sensitivity / weak structured / none>
- Ledger: recorded=<true|false> interactionId=<DI-… or reason>
- callingSurface: <normalized surface>
- Recommended next step: <auto-proceed | surface to operator | reframe options | defer>
```

If the kernel flips a default the agent had pre-decided, **say so explicitly** — that's the signal the consultation added value.

## Guardrails

- **Never embed the full math in response prose.** Render the chosen option + the top contributors; the MCP response is the audit trail.
- **Never invoke `principle_decide` with options you haven't enumerated.** "Should we do X?" with no alternative is a no-op — the kernel needs 2+ options to weigh.
- **Never invoke with empty features AND no `description`.** Pre-BI-3C1A6451 this produced silent all-zero alignment; post-fix the semantic fallback uses the description. An option with neither is a bug — return to step 1.
- **Never claim the kernel "agrees with you" if confidence is low.** A 0.05 margin between two options is noise.
- **Never bypass on a commandment conflict.** Commandments are hard rules. If one opposes the recommendation, the decision is not yours OR the kernel's to make alone — escalate.
- **Never auto-execute when `autonomyEligible` is false.** A recommendation alone is not permission for unattended action (BI-1D23EC26).
- **Never skip this skill on a multi-option platform decision** because "the hub looks empty" or "decisions aren't working". Empty-looking hubs are usually (a) looking at wiki DEC pages instead of `/coworker-decisions/decisions`, (b) free-form / missing `callingSurface`, or (c) agents never calling the tool. Call it; check `ledger.recorded`.
- **Never invent a free-form callingSurface.** Use the normalized table above so Grok/Claude/Codex adoption is comparable.
- **Grok / progressive MCP:** if `principle_decide` is not in the host tool list, `load_tools` then invoke via the host catalog. A stale host registry is not permission to decide by gut.

## Worked example (2026-05-24)

The Build Studio design-time decomposition spec ended with 7 open questions. The agent invoked this skill against question 4: *"Should FeatureBuild rows be created eagerly at decomposition time, or lazily on first build dispatch?"*

**Options enumerated:**
- `eager` — Create all FeatureBuild rows at decomposition; metadata-only, no sandbox claim yet.
- `lazy` — Create FeatureBuild rows on first build dispatch only; lighter DB state, more dispatch-time work.

**Features against PRINCIPLE_DIMENSIONS:**
- `eager`: `{ schema_grounding: 0.8, long_term_maintainability: 0.7, blast_radius: 0.3, speed_to_value: 0.6 }`
- `lazy`: `{ schema_grounding: 0.4, long_term_maintainability: 0.4, blast_radius: 0.6, speed_to_value: 0.7 }`

Note the cost axis: the *recommended* option carries the **lower** `blast_radius` (0.3 vs 0.6). That is the correct orientation — the score states how much of the estate the option reaches, not how safe it feels. Scoring the option you favour *high* on a cost axis argues against it.

**`principle_decide` returned:**
- Recommendation: `eager` (composite 0.62, margin 0.18, confidence high)
- Top positive contributors: Architecture Over Shortcuts (+0.40), Schema Grounding (+0.28)
- Flags: none
- The kernel **inverted the agent's pre-call default** (which had been `lazy` on speed-to-value reasoning). The contribution ledger showed Architecture Over Shortcuts pulled hard enough to flip the decision — a finding the operator confirmed.

The lesson: without the consultation, the agent would have shipped the lazy approach and incurred the maintainability cost later. This skill exists so that flip happens consistently, not by luck.

## See also

- Tool: [`mcp__dpf__principle_decide`](../../../../apps/web/lib/mcp-tools.ts) (principles-as-wiki-kind Phase 2 Task 2.7)
- Math: [`apps/web/lib/wiki/principle-decide.ts`](../../../../apps/web/lib/wiki/principle-decide.ts)
- Dimensions: [`packages/db/src/wiki-taxonomy.ts`](../../../../packages/db/src/wiki-taxonomy.ts) `PRINCIPLE_DIMENSIONS`
- Semantic-fallback bug fix that this skill depends on: BI-3C1A6451 (2026-05-24)
- Originating session: [`docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md`](../../../../docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md)
