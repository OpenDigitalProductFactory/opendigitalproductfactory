---
# Single fields shared by both surfaces
name: dpf-decision-via-kernel
description: "Use when working in the DPF codebase and facing an open question with 2+ architecturally-distinct options. Maps each option to the closed PRINCIPLE_DIMENSIONS registry, invokes the principle_decide MCP tool, surfaces the contribution ledger to the operator, and defers if a commandment conflict is flagged. Composes with dpf-brainstorming as the predecessor step. The DPF gate that sits in front of any decision the kernel can weigh."

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

> **Surface boundary (WWMD vs WWWD).** This skill is the **platform-development (WWMD)** decision surface — it scores against the founder kernel and is for DPF contributors and Build Studio *platform* work. It is **not** the path for a customer's *business* decision: those route through the Decision Perspective Gate against the organization's **WWWD** profile, which enforces the non-inherit boundary (a customer profile does not inherit platform business judgment as authority). The two surfaces are being consolidated so the Gate is the single governed door (BI-E1FB2307). See AGENTS.md §16 and `docs/user-guide/ai-workforce/decision-perspective.md`.

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

2. **Map each option to PRINCIPLE_DIMENSIONS.** Read the closed list and pick the 3-5 dimensions most relevant to the decision class. Score each option on each dimension from 0.0 to 1.0 — how strongly does this option deliver on this axis?
   - This is the **structured-alignment** path. Even crude scores produce much stronger signal than the semantic fallback.
   - If you genuinely cannot score the options against any dimension, supply `features: {}` and let the server-side semantic fallback fire (wired by BI-3C1A6451 on 2026-05-24 — it embeds your option `description` and the principle direction text). The fallback is weaker but non-degenerate.

3. **Invoke `principle_decide`.**

   ```
   mcp__dpf__principle_decide({
     context: "<one-sentence framing of the question>",
     options: [
       { id: "<slug>", description: "<distinctive text>", features: { <dim>: 0..1, ... } },
       { id: "<slug>", description: "<distinctive text>", features: { <dim>: 0..1, ... } }
     ],
     callingPopulation: "in_platform_coworker" | "external_coding_agent" | "human",
     ringScope: [ "<one of PRINCIPLE_RING_SCOPES>" ]  // optional, defaults to universal
   })
   ```

4. **Read the contribution ledger.** The result contains `scores` (per-option composite + per-principle contribution rows), `flags` (tie-margin confidence, semantic-fallback ratio, commandment-conflict signal), and `reasoning` (one-sentence human-readable summary).
   - **High confidence + no commandment conflict** → proceed with the recommendation.
   - **Low confidence (margin below tieMargin)** → surface to the operator with the ledger; the decision is close enough that human judgment beats math.
   - **Commandment conflict flag set** → defer. A commandment opposing the top-scored option means a hard-rule violation; either reframe the option or escalate.
   - **Weak structured coverage** (>40% semantic fallback) → consider returning to step 2 and supplying real features against more dimensions.

5. **Surface the ledger, not just the answer.** When reporting back to the operator, show: the chosen option, the top 2 contributing principles (positive and negative), and any flag that fired. The operator's role is to ratify (or override) the math, which requires seeing it.

## Output template

```
**Kernel consultation result.**

- Question: <one sentence>
- Options considered: <id1>, <id2>, [<id3>]
- Recommendation: <winning id> (composite <score>, margin <margin>, confidence <high|low>)
- Top positive contributors: <principle name 1> (+<contribution>), <principle name 2> (+<contribution>)
- Top negative contributors: <principle name> (<contribution>)  (if any)
- Flags: <commandment conflict / weak coverage / none>
- Recommended next step: <proceed | surface to operator | reframe options | defer>
```

If the kernel flips a default the agent had pre-decided, **say so explicitly** — that's the signal the consultation added value.

## Guardrails

- **Never embed the full math in response prose.** Render the chosen option + the top contributors; the MCP response is the audit trail.
- **Never invoke `principle_decide` with options you haven't enumerated.** "Should we do X?" with no alternative is a no-op — the kernel needs 2+ options to weigh.
- **Never invoke with empty features AND no `description`.** Pre-BI-3C1A6451 this produced silent all-zero alignment; post-fix the semantic fallback uses the description. An option with neither is a bug — return to step 1.
- **Never claim the kernel "agrees with you" if confidence is low.** A 0.05 margin between two options is noise.
- **Never bypass on a commandment conflict.** Commandments are hard rules. If one opposes the recommendation, the decision is not yours OR the kernel's to make alone — escalate.

## Worked example (2026-05-24)

The Build Studio design-time decomposition spec ended with 7 open questions. The agent invoked this skill against question 4: *"Should FeatureBuild rows be created eagerly at decomposition time, or lazily on first build dispatch?"*

**Options enumerated:**
- `eager` — Create all FeatureBuild rows at decomposition; metadata-only, no sandbox claim yet.
- `lazy` — Create FeatureBuild rows on first build dispatch only; lighter DB state, more dispatch-time work.

**Features against PRINCIPLE_DIMENSIONS:**
- `eager`: `{ schema_grounding: 0.8, long_term_maintainability: 0.7, blast_radius: 0.3, speed_to_value: 0.6 }`
- `lazy`: `{ schema_grounding: 0.4, long_term_maintainability: 0.4, blast_radius: 0.6, speed_to_value: 0.7 }`

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
