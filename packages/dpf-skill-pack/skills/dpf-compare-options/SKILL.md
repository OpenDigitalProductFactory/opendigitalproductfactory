---
name: dpf-compare-options
description: "Use when DPF decision context is gathered and two to four options need WWMD/kernel scoring."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__principle_decide mcp__dpf__wiki_query
category: governance
assignTo: ["*"]
capability: null
taskType: deliberation
triggerPattern: "compare options|score options|which option|WWMD compare|kernel scoring|decision options"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__principle_decide", "mcp__dpf__wiki_query"]
composesFrom: ["dpf-retrieve-decision-context"]
contextRequirements: ["DPF MCP principle_decide reachable; options enumerated"]
riskBand: low
enforces:
  - kernel/principles/architecture-over-shortcuts
  - kernel/principles/research-before-implementing
---

# DPF Compare Options

Compare 2-4 architecturally distinct options with WWMD after the context has been gathered.

## When to use

- There are multiple viable implementation, workflow, UX, or governance options.
- The trade-off should be shaped by founder-kernel principles, not by agent preference.
- The result needs a recommendation and a clear reason for the operator.

> **Platform vs business decisions.** `principle_decide` scores against the **founder kernel** — that's the right lens for *platform/WWMD* options. For a *business/WWWD* option set ("which way should the **organization** go?"), the deciding doctrine is the org's **mission + WWWD corpus**, not the platform kernel: gather it with `dpf-retrieve-decision-context`, weigh the options against the org's own stance first, and only lean on `principle_decide`/kernel reasoning where the org corpus is silent. Don't let platform doctrine override a business call the org has a stated stance on.

## Enforces

- `kernel/principles/architecture-over-shortcuts`
- `kernel/principles/research-before-implementing`

## Steps

1. Confirm there are 2-4 real options. If there is only one, return to context retrieval or brainstorming.
2. Give each option a stable `id`, a concise `description`, and the strongest 3-5 principle-dimension feature scores you can justify.
3. Call `principle_decide` with the decision context, scored options, and the correct calling population.
4. Summarize the recommendation, confidence, top contributors, and flags in operator language.
5. Preserve the raw tool response as audit detail for Build Studio or review surfaces.
6. If confidence is low or a commandment conflict appears, route the decision to founder review instead of forcing a choice.

> **Optional HTML fan-out (opt-in presentation).** When the operator benefits from *seeing* the options side by side — each as a card headed by the trade-off it makes, with the scores in a table — a self-contained HTML artifact reads better than a prose list. This is the flagship "fan out N approaches, you pick" use case from the [html-artifacts-guide](../../../../docs/superpowers/html-artifacts-guide.md) (starter: [`_templates/spec.template.html`](../../../../docs/superpowers/_templates/spec.template.html)). Additive only — the default operator summary stays as-is; reach for HTML only when the visual comparison earns its keep.

## Guardrails

- Do not fabricate feature scores. If a score is uncertain, say why and use the semantic fallback only with strong descriptions.
- Do not expose raw `principle_decide`, MCP, or skill IDs in the default Build Studio view.
- Do not proceed on a commandment conflict. Reframe the options or escalate.

## Worked example

A verification decision has `shared-env`, `thread-server`, and `remote-ci-only` options. This skill scores them against capacity, repeatability, architecture, and operator simplicity, calls `principle_decide`, and returns "Recommended next action: use the shared environment" with audit detail behind the evidence view.
