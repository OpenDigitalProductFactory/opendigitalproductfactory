---
title: Context economy
pageKind: heuristic
status: published
abstract: Every tool schema, description, and result the coordination plane exposes is paid for out of a finite context window on every call - expose progressively (load on demand), describe tersely, return bounded results, and treat context cost as a first-class integration budget rather than an afterthought.
sources:
  - mcp/architecture
  - mcp/intro
---

## The heuristic

> When integrating a capability onto the coordination plane, minimize what every caller pays for it: defer tool exposure until asked (progressive disclosure / load-on-demand), keep schemas and descriptions as small as the contract allows, bound every result, and measure the plane's context footprint as a budget with an owner.

## Why it matters

MCP's design puts tool definitions and results inside the model's context window — so an integration's cost is not only its runtime but the tokens it charges *every* turn of *every* agent that connects, whether or not the tool is used. The platform measured the failure mode: a client hitting its tool cap loaded 49 tools and called 0 — the catalog itself consumed the capacity the work needed. Context economy is also a fleet property: lean sovereign installs run small local models where the same catalog costs proportionally more of the window.

## When it applies

Any change that adds or reshapes tools, enlarges tool descriptions or schemas, adds per-turn context injection, or returns unbounded lists over MCP. Also when *evaluating* an external MCP server or connector: its catalog size and result discipline are adoption criteria, not cosmetics.

## How to apply

Prefer the platform's progressive-disclosure mechanics (deferred tool loading, `load_tools` on demand) over widening the always-on catalog. Give a new tool the smallest schema that carries the contract, and put reference detail in retrievable docs rather than the description. Bound results (`take`, truncation with a stated marker) — an unbounded read is both a context and a correctness defect. When scoring integration options, use `mcp-integration/context_economy`: the option that exposes less per call, all else equal, wins — and an option that needs to expose everything eagerly should explain why deferred loading cannot serve it.

## Related

- [[professions/mcp-integration/coordination-plane-concepts]] — the plane whose per-call cost this budgets.
- [[professions/mcp-integration/tool-name-contract-stability]] — stability and economy together define a well-shaped tool surface.
