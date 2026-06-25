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

## Next packs

Per the spec, the highest-value next extractions are the largest cohesive clusters:
`backlog` + `build-evidence`, `work-capsules` + `runtime-coordination`, `sandbox`, then
`wiki/knowledge`. Each follows the same parity-first discipline and keeps the existing
MCP-route, grant-filter, and `mcp-governed-execute` tests green.
