---
status: active
---

# Agent task disclosure and recovery routing

Backlog: BI-3CC35D24. Workroom: WC-30A9A3AD.
Base: 7ff008013f16a82da0352df700c2153a17943a83.
Status: implementation admitted; verification and publication in progress.

## Existing design

Extends [instruction-plane split](../specs/2026-07-24-agent-instruction-plane-split-and-ratchet-design.md), [deferred tools](../specs/2026-06-20-mcp-tool-tier-deferred-loading-design.md), and [doctrine measurement](../specs/2026-08-26-model-era-doctrine-curation-ab-measurement-design.md).
The existing gate-context generator and stage briefs remain authoritative. No new tool registry, permission model, recovery updater or database table.

## Acceptance

- Agents receive a short canonical routing core that selects normal delivery versus recovery guidance before attempting unavailable platform gates, preserving authorization, DCO, protected merges and production-integrity controls.
- Existing emergency and gate-infrastructure-unavailable procedures are discoverable locally without MCP; normal queue contention remains distinct from infrastructure outage and actual permission denial.
- MCP initialization is compact and points to relevant organization context on demand; catalog, attached-context and billing measurements are explicitly distinguished.
- Natural-language tool discovery returns relevant authorized capabilities with bounded output and truthful guidance when relevant capabilities lack grants; it never widens authority.
- Automated regression scenarios cover normal delivery, broken self-upgrade, unavailable MCP/CI, permission denial, and stale break-fix occupancy; instruction and response budgets cover the composed boundary as well as source text.

## Reproduction

At the named base, two added source-local regressions fail: organization initialize context is 5469 characters versus the proposed 1000-character organization block budget; an upgrade query returns account handover, quality reporting and organization joining alongside the upgrade tools. Nine control assertions pass.
The live discovery investigation WC-BCA49BB2 also established that exact upgrade tools are denied by coworker grants while broad intent discovery gives unrelated alternatives. Authorization must remain unchanged.
The normal CI skill does not route the existing emergency exceptions at its queue decision. AGENTS.md contradicts implemented Codex catalog policy.

## Ordered repair

1. ROUTING: shorten the root entry instructions into safety invariants and task pointers. Preserve every rule anchor in its appropriate existing runbook or a focused domain reference, preserve code-asserted doctrine, and keep a local recovery pointer before coordination prerequisites. Distinguish unavailable infrastructure, ordinary contention and genuine permission refusal. Use the existing debugging skill's packaged reference for recovery details so a broken portal is not needed to read them.
2. DISCOVERY: make initialize organization context bounded identity/mission/locale and decision routes. Detailed business stance is resolved by the existing organization decision tool when relevant. Preserve install identity, credentials and teardown boundaries. Improve the existing intent selector with name weighting and a relevance floor; retain exact-name and authorized-pool behavior. Explain absent relevant capabilities without treating them as callable or widening grants.
3. MEASUREMENT: extend existing conformance/budget reporting to separate raw catalog bytes, initialization bytes and composed/repeated overhead; attached/cached/billed token counts remain unknown without host telemetry. Add scenario fixtures for normal work, broken upgrade, MCP/CI unavailable, actual denial and occupied expedite lane. Do not label deterministic routing fixtures as fresh-model behavioral success.
4. VERIFY: regression-first source tests, affected consumers, instruction size/coverage guards, skill validation and style guard; regenerate doc index and operating contract if affected. Then independent review, governed gate and protected PR publication. Real outage execution stays with BI-7A4E70E9; do not run destructive exercises on production.

## File and verification contract

CONTRACT-1: AGENTS.md and task-specific runbooks preserve authority and have a reachable recovery entry.
FLOW-1: request → task brief → only applicable tools/procedure → evidence or explicit blocked reason.
VERIFY-1: instruction-plane size and rule-coverage guards; recovery scenario tests.
CONTRACT-2: apps/web/lib/mcp/org-context-bundle.ts and initialize.ts expose bounded context with decision routing.
FLOW-2: initialize → identity/authority → business context only when the business decision is made.
VERIFY-2: org-context-bundle, initialize and initialize.identity Vitest suites.
CONTRACT-3: apps/web/lib/tak/tool-intent.ts and mcp/load-tools.ts preserve authorization and exact-name loading.
FLOW-3: intent → ranked relevant authorized tools → explicit missing authority when relevant.
VERIFY-3: tool-intent, tool-tier, load-tools, route and coworker-tool-budget Vitest suites.
CONTRACT-4: scripts/check-instruction-plane-size.mjs and existing MCP conformance diagnostics measure the composed disclosure boundary honestly.
VERIFY-4: node budget/conformance tests, web typecheck, source preflight, independent review and canonical gate.

The scope impact contract requires Design-Grounding-Decision, related-test resolution, style-drift verification, doc-index regeneration and operating-contract regeneration. Related-test lookup completed for all three source entries; colocated tests expand its results.

## Delivery boundary and dependencies

One review unit repairs the task-disclosure contract across its entry instructions, connection briefing, discovery and regression evidence. Its parts are internal sequencing: retaining the contradictory front door or permissive search would leave the same recovery misrouting observable. Revert the unit together if route selection regresses.

BI-7A4E70E9 owns independently executable offline restoration and its outage exercises; BI-09C52DD3 owns break-fix WIP/PIR behavior. This branch links to those contracts and does not duplicate their implementation.
No migrations; no new runtime. The approval/grant/merge checks are unchanged.

## Research & Benchmarking

- [Agent Skills](https://agentskills.io/specification): metadata → invoked instructions → on-demand references; use the existing pack.
- [Anthropic tool search](https://www.anthropic.com/engineering/advanced-tool-use): deferred schemas and programmatic result filtering; preserve host-native lazy attachment rather than equating catalog bytes with prompt tokens.
- [Cursor](https://cursor.com/blog/dynamic-context-discovery): dynamic context discovery; adopt measurement of actual context and task outcome, without adding another framework.
- [AWS](https://docs.aws.amazon.com/whitepapers/latest/availability-and-beyond-improving-resilience/fault-tolerance-and-fault-isolation.html) and [Google SRE](https://sre.google/workbook/incident-response/): independent recovery dependencies and exercised playbooks.

## Risk and rollback

Shortening may hide a rule; preserve anchors and test route scenarios, then measure fresh-host outcomes without claiming unit tests prove them. Ranking changes can suppress useful tools; exact-name access and existing selection tests must remain green. Organization context must retain scope routing and resolve stance through existing governed tools. Roll back through a PR reverting the disclosure unit; never remove grants or production protections.

## Backlog coverage

Atomic coverage recorded as cmurqgh1i2t6a01mrajtk6hg0 against the initial published plan. Research receipt initiative-4a6a2e3c-8c80-4808-83b9-f055cf0bd33d. Readiness admitted implementation after those records and acceptance criteria were present.

