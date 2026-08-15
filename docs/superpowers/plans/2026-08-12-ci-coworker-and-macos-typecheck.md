# Market Research coworker + macOS typecheck heap — 2026-08-12

One branch (`feat/ci-coworker-and-macos-typecheck`), two backlog items batched per
operator direction.

## BI-CD7706B5 (build bug) — macOS `tsc --noEmit` OOMs under Node 26.x

**Source of truth:** `apps/web/package.json` `typecheck` script; the pre-commit
hook and `scripts/local-ci-runner.mjs` both invoke it.

**Root cause:** the default V8 old-space heap is too small for the `apps/web`
project graph under Node 26.x on macOS, so `tsc --noEmit` aborts (`Abort trap: 6`)
— not a TypeScript error. Confirmed workaround: `--max-old-space-size=8192`.

**Fix:** a tiny cross-platform wrapper `scripts/run-tsc.mjs` resolves the
workspace `tsc` via Node's own module resolution (hoist-agnostic) and re-execs it
with `node --max-old-space-size=8192`. The `web` typecheck script calls it, so the
hook, pregate, and a manual `pnpm --filter web typecheck` all inherit the heap.
Chosen over an inline `NODE_OPTIONS=` prefix (breaks Windows cmd.exe) and over
adding `cross-env` (a new dependency). Verified: `env -u NODE_OPTIONS pnpm --filter
web typecheck` exits 0 with no abort.

## BI-6D10EB1F (feature) — Market Research Analyst coworker

**Source of truth:** the `dpf-establish-coworker` paved road and the
coworker-definition conformance gate
(`apps/web/lib/coworker-lifecycle/coworker-definition-conformance.test.ts`).

A new owner-facing competitive-intelligence coworker: researches a prospect or
segment's software stack and spend on the public web and synthesizes it against
the internal CRM into a grounded, cited brief tied to an opportunity. No such
coworker existed (Marketing Strategist is acquisition/campaign, not CI).

Established as a **draft** through the `establish_coworker` factory door, then the
full code-side definition landed here so it passes the conformance gate:

- `COWORKER_AGENT_SEEDS` + `HARDCODED_COWORKER_GRANTS` (`packages/db/src/workforce-seed.ts`) — grants `web_search`, `crm_read` (read-only pipeline), `document_write`, `registry_write` (author + attach a brief). No `sandbox_execute`: the Build-Studio scout/ideate research launchers are feature-scoped, not owner-facing.
- Route persona `/market-intelligence` (`apps/web/lib/tak/agent-routing.ts`) + sensitivity mirror (`route-context-map.ts`), both `confidential` (it reads CRM).
- Model floor `strong` / `quality_first` (`packages/db/src/agent-model-defaults.ts`) — market-research synthesis with a strict no-fabrication rule is quality-sensitive.
- Profession family `market-research` (`docs/professions/registry.json`).
- A minimal informational page (`apps/web/app/(shell)/market-intelligence/page.tsx`); the global coworker panel resolves the persona for interaction.

Certification is via the auto-generated derived read-probe (the coworker holds
deterministic read tools). After this merges and deploys, the nightly
`ops/coworker-certification` sweep certifies it, then it is promoted with
`establish_coworker action="promote"`.

## Design grounding

Both extend existing substrate — the `typecheck` script + the coworker paved-road
registries (seeds, grants, routing, model floors, professions). No new contract;
`scripts/run-tsc.mjs` and the `/market-intelligence` page are the only net-new
modules, each a thin adapter over existing mechanisms.
