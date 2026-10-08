# TypeScript 7 native checker — implementation plan

**Backlog item:** BI-2B8D67A9 (medium, `delivery-medium@1.0.0`), Workroom WC-6B32B406, branch `chore/typescript-7-checker`.
**Research:** the item body's `## Research` section (receipt `initiative-52f8d7eb-3308-4815-822f-d2264c9ec5f4`).

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal

Make TypeScript 7 (`typescript@7.0.2`, the Go-native compiler) the type checker for every root-workspace `typecheck`, local-CI and GitHub CI run. TypeScript 6 stays the `typescript` dependency, because TS7 ships no classic compiler API and Next.js, ESLint, the code-graph extractors and two tests import it as a library.

## Acceptance criteria (quoted verbatim from BI-2B8D67A9)

- TS7 and TS6 report identical diagnostics on every workspace package at the switch commit (parity log attached as evidence).
- Measured before/after wall time and peak memory for `apps/web` typecheck on the dev host are recorded, against the 98 s / 7.3 GB baseline.
- Local-CI, pregate, and GitHub CI Typecheck run TS7; the `typescript` resource class is sized from measured TS7 memory.
- The TS compiler-API consumers listed above still build and pass on TypeScript 6.
- A compiler killed by a signal still yields exit 88, not a type-error verdict (BI-27D3DCCD behaviour preserved).

## Design

One entry point, two compilers. `scripts/run-tsc.mjs` already owns the heap, the program report (`DPF_TSC_PROGRAM_REPORT`) and the exit-88 contract, and every gate reaches the compiler through it or through a package `typecheck` script. Selection happens there:

- `typescript7` (root devDependency `npm:typescript@7.0.2`) is the default compiler, resolved from the repository root, not the caller's cwd.
- `DPF_TSC=6` selects the workspace's `typescript` (6.x), resolved from the caller's cwd as today. This is the reference path for parity checks and the advisory CI job.
- Bare `tsc` in package scripts is replaced by `node ../../scripts/run-tsc.mjs`, so packages cannot silently stay on TS6.

`apps/mobile` is a separate workspace with its own lockfile (`pnpm-workspace.yaml`: `!apps/mobile`) and is not part of the root typecheck. Out of scope.

## Steps

### REQ-1 Compiler selection in run-tsc.mjs (CON-1 entry-point contract)
- Add root devDependency `"typescript7": "npm:typescript@7.0.2"`; `pnpm install`; refresh the SBOM baseline if `check-sbom-drift` asks.
- `scripts/run-tsc.mjs`: resolve TS7 from the repo root by default, TS6 from cwd when `DPF_TSC=6`; print the selected compiler and version on stderr once; keep `--max-old-space-size` only for TS6 (TS7's `bin/tsc` is a thin ESM shim over the native binary).
- Unit test (new `scripts/run-tsc.test.mjs`, FLOW-1): the selection function returns TS7 by default and TS6 under `DPF_TSC=6`. A child killed by a signal still exits 88 (VER-5).

### REQ-2 Package scripts and the one config gap
- `packages/*`, `services/*` `typecheck`: `tsc` → `node ../../scripts/run-tsc.mjs` (db keeps `prisma generate &&`, and its second program keeps `-p tsconfig.scripts.json`).
- `services/edge-node/tsconfig.json:10`: `"moduleResolution": "Node"` → a TS7-supported value. Then prove TS6 and TS7 agree on it (VER-1).

### REQ-3 apps/web
- `typecheck` / `typecheck:tests` already go through run-tsc.mjs and switch with REQ-1.
- Verify `incremental: true` + `noEmit` still writes `tsconfig.tsbuildinfo` under TS7. The warm-start cache key includes `pnpm-lock.yaml`, so the first run after the switch is cold by construction.
- Measure TS6 vs TS7 wall time and peak memory for both web programs under host-resource admission (VER-2).

### REQ-4 Gates and sizing (CON-2 resource contract)
- `apps/web/lib/nonprod/host-resource-profiles.json`: set `typescript.expectedMemoryMiB` from the measured TS7 peak plus headroom (VER-3).
- `scripts/sbom/check-typecheck-baseline.mjs`: read the TS7 program report. TS7's `--extendedDiagnostics` prints `Lines:` instead of the `Lines of …` breakdown, and its lib files live under `@typescript/typescript-<platform>/lib`. Classify them as library, and re-measure the baseline if the totals move.
- `.github/workflows/ci.yml`: Typecheck jobs inherit TS7 through `pnpm typecheck`. Add a non-required `typecheck-ts6-reference` job (`DPF_TSC=6`, `continue-on-error`) as the advisory reference.
- `packages/dpf-skill-pack/hooks/raw-tool-guard.mjs`: update the "8 GB heap" guidance text.
- `scripts/local-ci-typecheck-runner.mjs`: the diagnostic parser (`error TS\d+`) is format-compatible. Add a test fixture with TS7 output (VER-3).

### REQ-5 Library consumers stay on TS6
- No change to `apps/web/lib/build/code-graph/extractors/*`, `emit.test.ts`, `inventory-entity-canonical-read-completeness.test.ts`, `packages/repo-guard-runtime`. Run their tests (VER-4).

## Verification

- **VER-1** Parity script over every root-workspace program at the switch commit: TS6 (`DPF_TSC=6`) vs TS7, sorted diagnostic sets equal. Log attached to the PR.
- **VER-2** apps/web production and test programs: TS6 vs TS7 wall time and peak memory, recorded against 98 s / 7.3 GB.
- **VER-3** `pnpm typecheck` at root green on TS7. Local-CI typecheck runner and its tests green. `check-typecheck-baseline` green on the TS7 report.
- **VER-4** `pnpm --filter web exec vitest run lib/build/code-graph lib/gpp/shape-language/emit.test.ts` and the db inventory test, green on TS6.
- **VER-5** `run-tsc.test.mjs`: signal-killed compiler maps to 88 under both compilers.

## Risks and rollback

- **Diagnostic drift in a later TS7 release:** the version is pinned exactly (`7.0.2`), and the TS6 reference job surfaces divergence before it matters.
- **Gate scripts parsing `--extendedDiagnostics` text:** covered by REQ-4 fixtures.
- **Rollback:** one revert, or set `DPF_TSC=6` in CI and `.env` to return every gate to TS6 without a code change.

## Backlog coverage

Decision **atomic**: the steps above are sequencing of one compiler swap behind one entry point. None of them ships value alone; a package switched without the gates would type-check on a compiler CI does not use. Out-of-scope follow-ups (moving the code-graph extractors to the TS7 API, retiring TS6 and the advisory job) are separate future items, not deliverables of this plan.

Receipt: _recorded after commit; see Workroom WC-6B32B406._
