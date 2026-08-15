# Scoped MCP Tool Packs

Status: standard, in migration (BI-ARCH-TOOLPACKS, EP-PLATFORM-CONSOLIDATION)
Spec: [`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`](../superpowers/specs/2026-06-25-platform-consolidation-spine-design.md) §6.2

`apps/web/lib/mcp-tools.ts` is a ~17k-line mega-module: it declares the entire
`PLATFORM_TOOLS` registry (251 tools) and dispatches every one through a single giant
`executeTool` switch. That single growing surface is a product risk, not just a style one —
the local-model path can only carry ~15 tools (`LOCAL_FALLBACK_MAX_TOOLS`), so an unscoped
registry that grows with every AI capability erodes the local economy.

The target is **domain-owned tool packs** that compose into the registry, with
`mcp-tools.ts` reduced to a thin composition layer over time.

`surface-pack.ts` is the cross-domain projection pack for the Authorized Surface Contract. Its six generic tools (`surface_list`, `surface_open`, `surface_snapshot`, `surface_query`, `surface_act`, and `surface_close`) stay together; domain packs continue to own the underlying business actions, and persistent surface actions dispatch back through the governed executor. This avoids both an unbounded page-specific tool inventory and a parallel execution path.

## The shape

A [`ToolPack`](../../apps/web/lib/mcp/tool-pack.ts) bundles the three things that used to
live in three places:

- **definitions** — the `ToolDefinition[]` (was inline in `mcp-tools.ts`),
- **handlers** — `name -> handler` (was a sibling module + a switch case),
- **grants** — agent-grant categories per tool (was only in `agent-grants.ts`).

[`composeToolPacks`](../../apps/web/lib/mcp/tool-registry.ts) merges packs into the flat
surfaces `mcp-tools.ts` consumes (the combined definition list + a `name -> handler`
lookup) and throws on a duplicate tool name across packs.

## Migration discipline (parity first)

Extraction is incremental and **parity-preserving** — never a behavior change:

1. **Definitions first.** A pack owns the definitions; `mcp-tools.ts` spreads
   `pack.definitions` into `PLATFORM_TOOLS`. The resulting array is identical, so tool
   discovery, grant filtering, phase/route exposure, and the local-fallback budget are
   unchanged.
2. **Dispatch next.** The `executeTool` switch migrates onto `registry.getHandler(name)`
   pack by pack. Until a pack's dispatch is migrated, its handlers stay wired in the switch.
3. **Authority travels with the handler (R3).** Grant gating still resolves through
   `agent-grants.ts` `TOOL_TO_GRANTS` (the single gating source). The pack mirrors those
   entries so the metadata lives with the pack, and `tool-registry.test.ts` asserts the two
   never drift. Tool definitions carry their own `requiredCapability`, so moving a
   definition into a pack moves its capability gate with it.

## First pack

[`deliberation-siem-pack`](../../apps/web/lib/mcp/packs/deliberation-siem-pack.ts) — the
Deliberation + SIEM tools were the cleanest first extraction (already self-contained
sibling modules with their own handlers). `mcp-tools.ts` now **fully** owns them through the
pack: their definitions compose into `PLATFORM_TOOLS` via the registry, and their dispatch
routes through `registry.getHandler(...)` (run right after the kernel gate, before the
switch) — the eight inline switch cases and their handler imports are gone. The behaviour is
identical: the kernel/commandment gate still runs first, the handlers are the same functions
called with the same arguments, and grant gating is unchanged. `tool-registry.test.ts`
proves the pack bundles exactly those definitions, a handler exists per definition, the
grant metadata matches `TOOL_TO_GRANTS`, and every pack tool is still present in the live
`PLATFORM_TOOLS`; `mcp-tools-{siem,deliberation}.test.ts` + `mcp-governed-execute.test.ts`
keep the dispatch path honest.

## Second pack — lazy handlers

[`runtime-coordination-pack`](../../apps/web/lib/mcp/packs/runtime-coordination-pack.ts)
proves the pattern handles **lazy** handlers. Unlike Deliberation/SIEM (static imports), the
runtime handlers live in a sibling module that the switch cases `await import(...)`-ed per
call. The pack preserves that: each handler is a thin wrapper that lazy-imports the module
only when the tool is invoked (passing the same arguments the switch case did, including the
mixed arities). Its five definitions were moved verbatim out of the inline `PLATFORM_TOOLS`
array (and the now-unused `RUNTIME_COORDINATION_TOOL_ENUMS` plumbing removed); they compose
back through the registry, dispatch through `registry.getHandler(...)`, and the five switch
cases are gone. `tool-registry.test.ts` + `mcp-tools-runtime-coordination.test.ts` prove
parity.
[`work-capsules-pack`](../../apps/web/lib/mcp/packs/work-capsules-pack.ts) (10 tools, mixed
arities) and [`workbooks-pack`](../../apps/web/lib/mcp/packs/workbooks-pack.ts) (5 tools)
followed on the same lazy pattern as the third and fourth packs — **every sibling-module
domain (static + lazy) is now extracted.**

## Fifth pack — first inline extraction

[`feedback-pack`](../../apps/web/lib/mcp/packs/feedback-pack.ts) is the first pack whose
handlers came from **inline** `case` bodies rather than a sibling handler module. It owns the
three platform-feedback tools — `report_quality_issue` (→ `createPlatformIssueReport`),
`escalate_feedback_upstream` (→ `escalateReportUpstream`), and `register_tech_debt`
(`createTechDebtItem` + a direct `prisma` write). Each handler lazy-imports its dependency and
reproduces the former switch case verbatim; the three definitions and switch cases (and the
now-unused helper imports) are gone from `mcp-tools.ts`.

`register_tech_debt` reads `context.agentId`, which the original pack-handler context
(`{ routeContext, threadId }`) didn't expose — even though the registry already forwards the
full runtime `ToolExecutionContext` to every handler. So `ToolPackHandler`'s context type was
widened to `{ routeContext?, threadId?, agentId? }` (a purely additive, type-only change). The
two thin-delegation tools plus the one prisma-writing tool prove the inline path across both
shapes before the larger clusters.

## Next packs

The remaining tools have **inline handler bodies with real logic** (not thin delegations) in
`mcp-tools.ts` — a larger extraction than the five packs done so far. The highest-value
clusters are `backlog` + `build-evidence`, `sandbox`, then `wiki/knowledge`: extract each
handler body into a domain module first, then pack it the same parity-first way, keeping the
existing MCP-route, grant-filter, and `mcp-governed-execute` tests green.

## Enforcement — the inline-case ratchet (BI-OPT-RATCHETS)

Migration discipline only holds if nothing can quietly add a **new** inline `case` while the
extraction is in flight. [`scripts/check-mcp-tool-pack.mjs`](../../scripts/check-mcp-tool-pack.mjs)
is that ratchet: it extracts the set of tool names dispatched by the top-level `case` arms of
`executeTool`'s `switch (toolName)` and compares it against the frozen
[`scripts/mcp-tool-pack-baseline.json`](../../scripts/mcp-tool-pack-baseline.json). The set may
only **shrink** — a new inline case fails CI (`MCP Tool Pack Guard` in `ci.yml`), so a new MCP
tool must register in a pack, not the switch. Extracting a tool removes its case; re-run
`node scripts/check-mcp-tool-pack.mjs --update` in the same PR to retighten the baseline. The
extractor is exported and reused by `tool-registry.test.ts` (the unit suite asserts the same
no-new-case invariant), so the guard and the test can never disagree. The baseline froze at the
231 inline cases that remained after the five packs above.

This composes with a companion **module-size ratchet** from the same BI
([`scripts/check-module-size.mjs`](../../scripts/check-module-size.mjs) + `Module Size Guard`):
new files are held to an 800-LOC ceiling (1000 hard cap) and the already-large files are frozen
in [`scripts/module-size-baseline.txt`](../../scripts/module-size-baseline.txt) and may only
shrink. No size guard existed before, which is how this very module grew past 15k LOC unnoticed —
the two ratchets together keep the consolidation gains from being silently undone.
