# Platform Substrate Measurement and Ratchets Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the reproducible substrate inventory, static complexity measurements, and one-way ratchets required before DPF changes or removes runtime components.

**Architecture:** A declarative JSON manifest classifies Compose services by capability and boundary reason. A pure Node module measures the repository and compares results with a committed baseline; a thin CLI prints human/JSON output and fails only on regressions or invalid classification. Runtime metrics remain a separately recorded canonical-install concern.

**Tech Stack:** Node.js ESM, Node test runner, Docker Compose YAML text parsing, Git, JSON, existing DPF guard conventions.

---

## Chunk 1: Manifest and measurement core

### Task 1: Define the substrate classification contract

**Files:**
- Create: `scripts/platform-substrate-manifest.json`
- Create: `scripts/lib/platform-substrate-measurements.mjs`
- Test: `scripts/lib/platform-substrate-measurements.test.mjs`

- [x] **Step 1: Write the failing manifest validation tests**

Test that validation rejects duplicate services, unknown classes, missing boundary reasons for specialist services, and services present in Compose but absent from the manifest. Test missing/incorrect profiles, ports, volumes, dependencies, data owner, backup policy, health semantics, host platforms, and target classification. Test that the checked-in manifest validates against `docker-compose.yml` and that every configured external AI runtime appears in the external-runtime inventory.

- [x] **Step 2: Run the tests and verify RED**

Run: `node --test scripts/lib/platform-substrate-measurements.test.mjs`  
Expected: FAIL because the module and manifest do not exist.

- [x] **Step 3: Add the minimal manifest and validation implementation**

Use these closed classes:

```js
export const SUBSTRATE_CLASSES = [
  "universal-core",
  "ephemeral-lifecycle",
  "capability-activated",
  "test-development-only",
  "separate-distribution",
];
```

Manifest records cover every Compose service and configured external AI runtime. Static external-runtime enumeration comes from `packages/db/data/providers-registry.json` plus runtime declarations in `docker-compose.yml`; the canonical-runtime collector separately records live `AIProvider`/runtime reconciliation without making live DB state a source-file dependency. Service records contain `service`, `class`, `capability`, `boundaryReason`, `defaultRequired`, `profiles`, `ports`, `volumes`, `dependsOn`, `canonicalDataOwner`, `backupPolicy`, `healthSemantics`, `hostPlatforms`, and `targetClassification`. External runtime records contain `runtimeKey`, `kind`, `activation`, `canonicalDataOwner`, `healthSemantics`, `hostPlatforms`, and `boundaryReason`. Volumes and top-level Compose keys are not services. Parsed Compose profiles, ports, volumes, and dependencies must equal the manifest.

- [x] **Step 4: Run the tests and verify GREEN**

Run: `node --test scripts/lib/platform-substrate-measurements.test.mjs`  
Expected: PASS.

- [x] **Step 5: Refactor parsing and validation while green**

Keep parsing pure and deterministic. Do not add a YAML dependency; support the repository's service/profile syntax and fail clearly on unsupported structure.

- [x] **Step 6: Commit the contract**

```powershell
git add scripts/platform-substrate-manifest.json scripts/lib/platform-substrate-measurements.mjs scripts/lib/platform-substrate-measurements.test.mjs
git commit -s -m "feat(architecture): classify platform substrate services"
```

### Task 2: Add deterministic repository measurements

**Files:**
- Modify: `scripts/lib/platform-substrate-measurements.mjs`
- Modify: `scripts/lib/platform-substrate-measurements.test.mjs`

- [x] **Step 1: Write failing measurement tests**

Use temporary fixture trees and assert measurements for:

- Compose service totals by class and default requirement;
- Prisma model count;
- direct `inngest` imports outside approved adapter/composition paths;
- integration connect routes and provider-local connection-state projectors;
- production TypeScript modules above the existing soft ceiling;
- seed coordinator and schema line counts.

Run collection twice against the same fixture, strip only `generatedAt` and `gitSha`, serialize with the production stable serializer, and assert byte-for-byte equality.

- [x] **Step 2: Verify RED**

Run the targeted Node test and confirm missing measurement functions cause the expected failures.

- [x] **Step 3: Implement the minimal pure collectors**

Collectors accept explicit repository paths/content so tests do not mock process state. Reuse the module-size ceiling semantics rather than create a competing definition.

- [x] **Step 4: Verify GREEN**

Run the targeted test and confirm all fixture cases pass.

- [x] **Step 5: Refactor shared file walking and normalization**

Keep path normalization cross-platform and results stably sorted.

- [x] **Step 6: Commit measurements**

```powershell
git add scripts/lib/platform-substrate-measurements.mjs scripts/lib/platform-substrate-measurements.test.mjs
git commit -s -m "feat(architecture): measure substrate complexity"
```

## Chunk 2: Ratchet CLI and baseline

### Task 3: Implement one-way ratchet comparison

**Files:**
- Modify: `scripts/lib/platform-substrate-measurements.mjs`
- Modify: `scripts/lib/platform-substrate-measurements.test.mjs`

- [x] **Step 1: Write failing comparison tests**

Assert that increased service/default/vendor-import/duplication/model/hotspot counts fail, unchanged counts pass, decreases pass with a stale-baseline advisory, and explicitly informational metrics never fail.

- [x] **Step 2: Verify RED**

Run the targeted test and confirm the comparison API is missing.

- [x] **Step 3: Implement minimal comparison semantics**

Every baseline metric declares `direction: "non-increasing" | "informational"`. Never infer direction from the metric name.

- [x] **Step 4: Verify GREEN**

Run the targeted test.

- [x] **Step 5: Commit ratchet logic**

```powershell
git add scripts/lib/platform-substrate-measurements.mjs scripts/lib/platform-substrate-measurements.test.mjs
git commit -s -m "feat(architecture): ratchet substrate complexity"
```

### Task 4: Add CLI, package commands, and guard integration

**Files:**
- Create: `scripts/measure-platform-substrate.mjs`
- Create: `scripts/measure-platform-substrate.test.mjs`
- Create: `scripts/check-no-substrate-regression.mjs`
- Create: `scripts/check-no-substrate-regression.test.mjs`
- Create: `scripts/platform-substrate-baseline.json`
- Modify: `package.json`

- [x] **Step 1: Write failing CLI tests**

Test `--json`, `--update`, default ratchet checking, missing baseline, invalid manifest, and nonzero exit on regression using injected fixture paths. Add a RED test proving the `check-no-substrate-regression.mjs` wrapper calls the same checker and is discovered by the existing `check-no-*` convention.

- [x] **Step 2: Verify RED**

Run: `node --test scripts/measure-platform-substrate.test.mjs scripts/check-no-substrate-regression.test.mjs`  
Expected: FAIL because the CLI is absent.

- [x] **Step 3: Implement the CLI**

Add commands:

```json
{
  "measure:substrate": "node scripts/measure-platform-substrate.mjs --json",
  "check:substrate": "node scripts/measure-platform-substrate.mjs"
}
```

Default output is concise and human-readable. `--update` writes stable JSON with provenance (`generatedAt`, git SHA, manifest version) and metric policies.

- [x] **Step 4: Verify GREEN**

Run: `node --test scripts/measure-platform-substrate.test.mjs scripts/check-no-substrate-regression.test.mjs` and then `pnpm check:guards`. Confirm the wrapper, real guard discovery, and live CLI are green.

- [x] **Step 5: Generate and validate the baseline**

Run: `node scripts/measure-platform-substrate.mjs --update`  
Then: `node scripts/measure-platform-substrate.mjs`  
Expected: baseline written, then PASS with no regressions.

- [x] **Step 6: Add the auto-discovered guard wrapper**

`check-no-substrate-regression.mjs` is a thin wrapper with a sibling Node test, so existing `check-guards.mjs` and CI discover it without workflow edits. Verify discovery through the wrapper test; edit CI only if fresh inspection proves the convention changed.

- [x] **Step 7: Commit CLI and baseline**

```powershell
git add scripts/measure-platform-substrate.mjs scripts/measure-platform-substrate.test.mjs scripts/check-no-substrate-regression.mjs scripts/check-no-substrate-regression.test.mjs scripts/platform-substrate-baseline.json package.json
git commit -s -m "ci(architecture): enforce substrate complexity budget"
```

### Task 5: Add canonical-install runtime measurements

**Files:**
- Create: `scripts/measure-platform-substrate-runtime.mjs`
- Create: `scripts/measure-platform-substrate-runtime.test.mjs`
- Create: `scripts/platform-substrate-runtime-baseline.json`
- Modify: `package.json`

- [x] **Step 1: Write failing runtime collector tests**

Inject fixtures for `docker compose ps --format json`, `docker stats --no-stream --format json`, and portal health/version responses. Assert required running service count, total idle container RSS, portal idle RSS, unhealthy required count, optional inactive/degraded counts, served identity, malformed-output failure, and byte-for-byte stable serialization after removing timestamp/SHA.

- [x] **Step 2: Verify RED**

Run: `node --test scripts/measure-platform-substrate-runtime.test.mjs`  
Expected: FAIL because the collector is absent.

- [x] **Step 3: Implement the read-only collector**

The collector never starts, stops, or rebuilds services. It consumes the capability/service projection and observes only the leased canonical runtime. Non-increasing budgets are required running service count, total idle RSS, portal idle RSS, and unhealthy required count; identity and optional-state counts are informational.

- [x] **Step 4: Verify GREEN**

Run the targeted test. Partial Docker output must fail closed without overwriting a baseline.

- [x] **Step 5: Add package commands**

Add `measure:substrate:runtime` and `check:substrate:runtime`. The checker refuses a baseline from an unleased or unidentifiable runtime.

- [x] **Step 6: Collect the canonical baseline**

Claim `local-integration-ci`, deploy/verify through the governed sandbox path, wait for its readiness verdict, collect two consecutive no-stream samples, and require each budget to differ by no more than 5%; store the higher value. Record lease id, environment key, served SHA, host profile, and commands.

- [x] **Step 7: Commit runtime measurement support**

```powershell
git add scripts/measure-platform-substrate-runtime.mjs scripts/measure-platform-substrate-runtime.test.mjs scripts/platform-substrate-runtime-baseline.json package.json
git commit -s -m "feat(architecture): baseline runtime substrate footprint"
```

## Chunk 3: Documentation and verification

### Task 6: Publish the measurement contract

**Files:**
- Create: `docs/architecture/platform-substrate-boundaries.md`
- Modify: `docs/install/platform-support-watchlist.md` only if measurement reveals a new platform-specific runtime assumption
- Modify: `docs/superpowers/specs/2026-07-17-platform-substrate-convergence-design.md` only for confirmed implementation learnings

- [x] **Step 1: Document metric semantics and exclusions**

Explain service classes, boundary-reason rules, static versus runtime evidence, ratchet directions, update procedure, and why fewer containers alone is not success.

- [x] **Step 2: Link the manifest, CLI, baseline, epic, and design**

Keep one source of truth; documentation points to measured artifacts rather than copying values.

- [x] **Step 3: Run documentation gates**

Run: `pnpm docs:index` then `pnpm check:doc-links` or the repository's narrower required doc commands. Fix generated artifacts through the canonical generator.

- [x] **Step 4: Commit documentation**

```powershell
git add docs/architecture/platform-substrate-boundaries.md docs/install/platform-support-watchlist.md docs/superpowers/specs/2026-07-17-platform-substrate-convergence-design.md apps/web/lib/docs/doc-index.generated.json
git commit -s -m "docs(architecture): define substrate boundary budgets"
```

### Task 7: Verify, publish, and close BI-PSC-001

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-platform-substrate-measurement-ratchets.md` checkboxes as evidence lands

- [x] **Step 1: Run fresh source-local verification**

```powershell
node --test scripts/lib/platform-substrate-measurements.test.mjs scripts/measure-platform-substrate.test.mjs scripts/check-no-substrate-regression.test.mjs scripts/measure-platform-substrate-runtime.test.mjs
pnpm check:substrate
pnpm check:module-size
pnpm check:guards
pnpm --filter web typecheck
```

Current evidence: the source measurement suites, static substrate guard, documentation gates, and independent implementation reviews are green. The governed `local-integration-ci` candidate at `e6f20832f` passed Prisma generation/migrations, the complete web test run, Windows typecheck with `NODE_OPTIONS=--max-old-space-size=8192`, and the production Docker build (test evidence `cmrogx26a04bu01mw0z74sz53`; build evidence `cmrogx27704bw01mwc0af6epa`).

- [x] **Step 2: Inspect the full diff and requirements checklist**

Confirm every acceptance item in BI-PSC-001 and the design spec has direct evidence.

- [x] **Step 3: Route runtime-bound build evidence correctly**

Claim `local-integration-ci`, run the production build and `pnpm check:substrate:runtime` there, record build and runtime-budget evidence, and release the lease. Do not claim worktree-only runtime evidence.

The governed candidate, database/test/typecheck, and production-build portions are verified as recorded above. Canonical runtime baseline/check evidence was collected under lease `NPEL-E1D03C5F6E` from served SHA `98ed83b67820f893b84c8ec9555d7f535b13b301` and recorded as activity `cmroh2g6904e601mwh8lcs3f9`.

- [x] **Step 4: Commit plan evidence updates**

```powershell
git add docs/superpowers/plans/2026-07-17-platform-substrate-measurement-ratchets.md
git commit -s -m "docs(plan): record substrate measurement verification"
```

- [ ] **Step 5: Push and open a ready PR**

Push the branch. Open a non-draft PR only after all gates and reviews are green.

- [ ] **Step 6: Wait for review, CI, and merge evidence**

Run `pnpm pr:health`, address review/CI findings with reviewed commits, and confirm merge through the normal merge queue. An open PR is not completion evidence.

- [ ] **Step 7: Record evidence and complete the backlog item**

Use DPF MCP to attach source tests, canonical build/runtime budget, and merged PR/SHA evidence; then mark BI-PSC-001 done. Leave the epic open for BI-PSC-002.

Pending completion evidence: ready PR, merge SHA, and BI closure.
