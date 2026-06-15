# Plan — Procedural functional-verification (EP-VERIFY-PROC)

Spec (single source of truth): [`docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md`](../specs/2026-06-06-procedural-functional-verification-design.md)

Engine-light first: each slice is independently shippable. Slice 1 is verifiable entirely by source-local gates (no live portal), which is deliberate — fully driving this work would hit the very problem it solves.

## Slice 1 — Preflight verdict core + tooling reconciliation  (BI-85433710 core, BI-6B31D9FF)

Reuse, do not reinvent: `apps/web/lib/platform/image-version.ts` already exports `ImageVersion`, `ImageVersionSource`, `classifyImageVersion`, `compareImageVersionToSha`. The preflight adds only the *verdict* layer.

1. `apps/web/lib/verify/preflight.ts`
   - Types: `PreflightVerdict = "CAN-TEST" | "MUST-ADVANCE" | "BLOCKED"`, `PreflightNextActionKind`, `PreflightInput`, `PreflightResult`.
   - `computePreflightVerdict(input): PreflightResult` — PURE, total, deterministic. Inputs are the already-fetched `ImageVersion | null`, `portalReachable`, `featureSha`, and `featureContainedInServed: boolean | null` (ancestry pre-computed by the IO layer). No fetch, no git, no fs — so it is a truth table under test.
   - Decision logic exactly per spec §3.1.
2. `apps/web/lib/verify/preflight.test.ts` — vitest truth table: unreachable, no-marker, content-hash, unknown-source, git-sha×contained, git-sha×not-contained, git-sha×ancestry-uncomputable. Assert verdict + nextAction.kind for each.
3. `scripts/portal-version-check.sh` + `scripts/portal-version-check.ps1` — replace the two `redeploy-portal.*` remediation strings with the governed self-upgrade path (`/ops/self-upgrade`), citing AGENTS.md §5. (BI-6B31D9FF)

Gate: `pnpm --filter web exec vitest run lib/verify/preflight.test.ts` + `pnpm --filter web typecheck`.

## Slice 2 — CLI shim + the entry-point skill + AGENTS.md binding  (BI-85433710 IO, BI-35A92FB6, BI-C5E03376)

4. `scripts/dpf-verify-preflight.mjs` — cross-platform CLI (consistent with `dpf-compose.mjs`): resolves `featureSha` (arg or branch HEAD), fetches `/api/platform/image-version`, computes ancestry via `git merge-base --is-ancestor`, then prints the JSON verdict (and a human summary on stderr). Thin IO over the pure core.
5. `packages/dpf-skill-pack/skills/dpf-verify-on-live-install/SKILL.md` — step-zero skill: run preflight, branch on verdict, enforce the BLOCKED **hard stop-rule** (file a BI, STOP; never silently pivot to infra fix). composesFrom `dpf-evidence-before-diagnosis`; precedes `dpf-finishing-a-development-branch`.
6. AGENTS.md §5 "Where each gate runs" — name the preflight+skill as step zero of live-install functional verification; add the thin-adapter checklist for Claude/Codex capability churn. Seed the skill row in §16. Update `packages/db/src/seed-skills.ts` if the dual-surface seed needs it.

## Slice 3 — Build-gate failure classifier  (BI-E4CBC7C1)

7. `apps/web/lib/self-upgrade/build-failure-classifier.ts` + tests — match captured promoter failure logs to known classes (host-vs-Docker hoist divergence; Turbopack NFT duplicate-asset cascade; bundle-boundary static import). Return `{class, playbookLink, failingTrace, isMainDefectVsEnvironment}`. Wire into the promoter result so the BLOCKED preflight reason carries the class.

## Slice 4 — Fast static bundle-boundary / undeclared-import guard  (BI-98AF1066)

8. A source-local check (pre-commit + CI) tracing route/Inngest entrypoints → import graph, flagging Docker-only/promoter modules in the server bundle, plus the triage doc's depcheck/knip undeclared-import check. Surfaces all violations at once in seconds.

## Slice 5 — MCP-tool exposure of the preflight  (BI-85433710 surface-agnostic)

9. Expose `computePreflightVerdict` behind an MCP tool so Build Studio / in-portal coworkers hit the identical verdict — closes surface-agnosticism per Unified Delivery Surfaces.

## Ordering rationale

1 → 2 unblock the agent-facing win (the stop-rule) fastest. 3 → 4 make the BLOCKED path cheap and shift Docker-only failures left. 5 generalizes to the embedded surface last, once the contract has proven out on the CLI surfaces where the token burn is observed today.
