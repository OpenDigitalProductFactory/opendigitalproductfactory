# Tool-pack registry cascade-killer — make adding a pack conflict-free

_Status: implemented · EP-8DC217EB BET-4 · 2026-07-11_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §4 BET-4, §6 ratchet discipline · precedent: BI-3B0AD9CF (module-size baseline union-merge)_

## The friction

As BET-4 drains the `mcp-tools.ts` `executeTool` switch into scoped packs
domain-by-domain, every drain PR — and every *other* thread that adds a pack
(e.g. `demandScoringPack`) — appended its pack to the SAME single line:

```ts
const TOOL_PACK_REGISTRY = composeToolPacks([packA, packB, …, packZ]);
```

Two concurrent pack PRs therefore ALWAYS conflict on that line (observed live
across #2755/#2757/#2761/#2763/#2772 and the parallel demand-management work).
Resolution is a trivial keep-both union, but it is per-PR churn on the repo's
worst merge-hazard file, and it re-blocks a PR every time another lands first —
exactly the cascade the module-size baseline hit before BI-3B0AD9CF.

## The fix (same pattern as BI-3B0AD9CF)

Extract the registry into a dedicated **`apps/web/lib/mcp/pack-registry.ts`**,
formatted **one pack per line** (one `import { xPack } from "./packs/x-pack";`
line + one `xPack,` array line), and mark it **`merge=union`** in
`.gitattributes`. Now two branches that each add a pack merge cleanly with
git's built-in union driver — no shared line, no conflict.

`mcp-tools.ts` drops all 28 pack imports + the `composeToolPacks` import + the
inline registry, and instead does `import { TOOL_PACK_REGISTRY } from
"@/lib/mcp/pack-registry"` (still used verbatim at `...TOOL_PACK_REGISTRY.definitions`
and `TOOL_PACK_REGISTRY.getHandler`). Behaviour is identical — the same
`composeToolPacks([...])` result, in the same order.

## The ratchet

`pack-registry.test.ts` guards the union-mergeable invariant: no duplicate
import line, no duplicate array entry (a union merge that duplicated a pack, or
a human double-add, fails here rather than shipping a registry with duplicate
tools), imports ↔ array are in bijection, and no line carries two pack entries
(which would defeat union-mergeability).

## Effect

Adding a pack is now **2 union-mergeable lines** in one small file, touching
nothing in `mcp-tools.ts`. The remaining ~33 BET-4 domain drains — and any
future pack from any thread — no longer conflict on registration. This converts
the slow, conflict-heavy tail of BET-4 into a fast one, and is the §6
"ratchet so the friction cannot regrow" discipline applied to the new hotspot.
