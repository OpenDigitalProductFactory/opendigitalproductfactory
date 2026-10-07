---
status: draft
---

# GPP Phase 5: Build Studio as one declared work shape

| | |
|---|---|
| Date | 2026-10-06 (revised after independent review the same day: approve-with-changes, all findings applied) |
| Design | [GPP Phase 5: Build Studio as one declared work shape](../specs/2026-10-06-gpp-phase-5-build-studio-shape-design.md): §4 drive vs declared, §5 the document, §6 constructs, §7 compiler changes, §8 non-disruption proof, §9 sandbox boundary, §10 realization map, §15 baseline |
| Parent design | [GPP shape notation, execution semantics and compiler](../specs/2026-10-02-gpp-shape-notation-and-compiler-design.md) §6.4, §10, §11. Not edited by this plan or by any PR in it; the §6.4 binding-record rule is superseded by a recorded WWMD outcome (task 5a-0) |
| Prior plans | [GPP Phase 3a and 3b](2026-10-02-gpp-shape-notation-compiler-phase-3.md); [GPP Phase 3c](2026-10-02-gpp-phase-3c-drive-graph-execution.md) |
| Epic | EP-B932453F |
| Backlog | BI-D37B2C13. Related: BI-5D59A982 (C-8 on `save_phase_handoff` plan → build), BI-BDB63485 (`save_phase_handoff` advances any phase, including over external MCP), BI-F1C680C7 (`AUTH_SECRET` shared with the sandbox), BI-69415B68 (binding attach), BI-6DA17863 (notation) |
| Decisions | DI-EFCFA7596534 (WWMD): known-findings list, shrink-only, declared flows only. Q1 (ratify `build-studio-plan-advancement`) is open with the founder |
| Standard | [GPP](../../architecture/gated-permissions-process.md) §7, §12.4, Annex C |
| Verified against | `origin/main` at `b48b6d908a` |

## Outcome

When Phase 5 is finished, Build Studio's lifecycle exists as one hand-authored GPP shape document,
`build-studio@1.0.0`, compiled by the existing compiler. Tests verify Build Studio's code against
it in CI: phases, transitions, every phase write, per-phase tools, the plan → build gate set and
preconditions from `PLAN_TO_BUILD_GATE_PROFILES`, evidence across the lifecycle and rightsizing
matrix, the sandbox environment boundary and every transition path. Every way Build Studio departs
from the model or from the GPP design rules is a named finding on a shrink-only list.

Build Studio behaves exactly as before. Only allowlisted paths change, nothing at runtime reads the
declared shape, and no binding is enforced. The tests verify code declarations at the default
configuration only (design §8).

## Constraints (binding on every PR)

1. **Allowlist of changed paths.** Each PR runs:
   ```bash
   git diff --name-only origin/main...HEAD \
     | grep -vE '^(apps/web/lib/gpp/|apps/web/lib/work-management/declared-flows/|apps/web/lib/work-management/generated/(declared-flows|[a-z0-9-]+\.flow)\.generated\.ts$|apps/web/scripts/build-gpp-shapes\.ts$|apps/web/lib/docs/doc-impact\.generated\.json$|docs/)' \
     && echo "PATH OUTSIDE ALLOWLIST" || echo ok
   ```
   Any output line other than `ok` fails the PR. The PR body records the output. This replaces any
   definition of "a Build Studio file": nothing outside the allowlist can change.
2. **No runtime reader.** Only tests and `apps/web/scripts/build-gpp-shapes.ts` import a
   declared-flow module. A test enforces it (design P7).
3. **No enforcement.** `GPP_BINDING_ENFORCEMENT`, `GPP_BINDINGS` and `KNOWN_SHADOW_BINDINGS` are
   unchanged. No `CONSTRUCT_EXECUTABLE` flag changes. The generator never calls
   `emitBindingRecords`.
4. **Tooling is neutral for work shapes.** After every PR, `pnpm --filter web check:gpp-shapes`
   passes and `inquiry-response-watch.shape.generated.ts`, `generated/index.generated.ts` and
   `gpp/generated/gate-ratification-report.json` are byte-identical to `origin/main`.
5. **The drive is untouched.** `apps/web/lib/work-management/drive-sequential-identity.test.ts`
   (the PR-3c-1 golden) and the full `apps/web/lib/work-management` suite pass unedited.
6. **No new dependency, no Prisma migration, no environment variable.**
7. **Read, never restate.** The realization map imports `PLAN_TO_BUILD_GATE_PROFILES`,
   `canTransitionPhase`, `PHASE_ORDER`, `getProcessPolicy`, `findDirectPhaseWrites` and (in tests)
   `PLATFORM_TOOLS`; it never copies their values. The plan → build divergence table is generated
   by `planToBuildDivergences()`, never written by hand.
8. **Parent spec not edited.** Refinements live in the design §12 and in "Spec refinements" below.

## Facts this plan is built on (`origin/main` `b48b6d908a`)

| Fact | Source |
|---|---|
| Compile pipeline: parse → schema → resolve → DRC → lower → emit; emits only when no error | `apps/web/lib/gpp/shape-language/compile.ts:64-82`; `diagnostics.ts:166-168` |
| Generator: `shape-documents/*.gpp.json` → `generated/*.shape.generated.ts` and the index; orphans are `.shape.generated.ts` only | `apps/web/scripts/build-gpp-shapes.ts:78`, `:126-133`, `:227-243` |
| `--report` covers registry definitions only and prints only errors and warnings | `build-gpp-shapes.ts:253-279` |
| Generator tests live beside the shape language, not the script | `apps/web/lib/gpp/shape-language/generated-integrity.test.ts`, `determinism.test.ts` |
| Every generated work shape must be registered in `ALL_SHAPES` | `apps/web/lib/work-management/work-shapes.ts:377-384` |
| C-7 build-sandbox clause is a standing `not-evaluated` finding | `drc.ts:199-206`; test `drc.test.ts:187-189` |
| C-3 and binding drafts read the stage's own advance gate | `drc.ts:295-309`; `bindings-emit.ts:57-68` |
| D-8 refuses an unratified typed gate | `drc.ts:373-382` |
| Resolver module paths must match `^lib/…` | `resolve-sources.ts:62-63`, `:96-103`; existing form `bindings.ts:66`, `:80` |
| Ratification test: two-way key check reads the registry; every entry must be enforced, blocking, `accountable-human` | `gate-ratification.test.ts:26-37`, `:76`, `:100-118` |
| Plan → build profiles, five paths; canonical `callerChecksBefore` | `apps/web/lib/build/plan-to-build-transition-core.ts:140-251`, `:158` |
| Rightsizing raises gate requirements when evidence carries it | `apps/web/lib/explore/build-process-matrix.ts:797-803`, `:813-817` |
| Lifecycle matrix and default cell | `build-process-matrix.ts:137-155`, `:236-245`, `:336-363`; `getProcessPolicy` `:511` |
| Phases and allowed transitions | `apps/web/lib/explore/feature-build-types.ts:570-572`, `:705-722` |
| Per-phase tool tags | `apps/web/lib/mcp-tool-types.ts:17`, `:162-164` |
| Direct phase-write scanner | `apps/web/lib/gpp/direct-phase-writes.ts:120` |
| Sandbox CLI chokepoint and its callers | `runSandboxAgentCli` `sandbox/agent-cli-runtime.ts:315`; call sites `claude-dispatch.ts:181`, `codex-dispatch.ts:168`, `grok-dispatch.ts:269`, `opencode-dispatch.ts:593`, `ideate-dispatch.ts:675`; engine callers `sandbox/agents/*-agent-runner.ts`, `build-pipeline.ts:591`; provider path `dpf-native-agent-runner.ts:190`, `git-promotion-sandbox-verification.ts:124` |
| Phase 3c: PR-3c-1 merged; all four graph flags off | `fb6cdad042` (#6021); `executable-constructs.ts:78-81` |

## Scope and staging

**Operator directive: as few PRs as safely possible.** Two PRs.

| PR | Contents | Behaviour change | Depends on |
|---|---|---|---|
| **PR-5a** Declared-flow tooling | Known findings (closed eligible set, declared-flow paths only); entry-gate owning scope for C-3 and binding drafts; C-7 sandbox clause; generator second root, index and orphan rule; sandbox-dispatch ratchet; ratification test changes. Fixtures only, no Build Studio content | None. Generated work-shape files byte-identical | Nothing |
| **PR-5b** Build Studio declared shape | `build-studio.gpp.json`, its known-findings list, the realization map, the generated flow module, conformance tests P1–P8 and the element map, the ratified gate entry, GPP standard 0.10, `doc-impact.generated.json` | None | PR-5a merged; founder DI for Q1 |

**Why two and not one.**

- PR-5a changes compiler semantics for every document (C-3 owning gate, C-7 standing finding,
  `hasBlockingDiagnostic`). PR-5b is content. A defect in either should revert alone, and reverting
  the compiler change must not take the Build Studio model with it, or the reverse.
- PR-5b cannot merge until the founder ratifies the plan gate (Q1). PR-5a has no such wait.
- Folding PR-5a into PR-5b saves one gate run and costs both points above. Recommendation: two.

**Why not three.** The realization map, the document and the conformance tests are one unit: the
document without the tests is an unverified picture (GPP §12.4.1), and the tests without the
document have nothing to verify. Docs ride with the content PR.

**Sequencing against other work.**

- Independent of Phase 3c PR-3c-2 to PR-3c-5 (design §6). The document uses no graph construct.
- Independent of BI-5D59A982 and BI-BDB63485 in either order (design §13). If either changes a
  `save_phase_handoff` profile or path, the P3 or P1 rows shrink in that PR.
- PR-5a supersedes parent §6.4's binding-record rule; record it before merge (task 5a-0).
- No conflict with Phase 4: Phase 4 reads `listWorkShapes()`; adding declared flows to its
  projection is a follow-up (design §11, step 5).

## PR-5a: declared-flow tooling (no Build Studio content)

Branch `feat/gpp-phase-5a-declared-flow-tooling`, from fresh `origin/main`. Workroom claimed on
BI-D37B2C13, shape declared at claim.

### Task 5a-0: record the §6.4 supersession

1. Consult `principle_decide` (WWMD) on "a binding's owning gate is the gate on the transition into
   its stage" against the parent's "the stage's own advance" (design §7.4), and record the outcome
   with `dpf-record-decision-outcome`. Cite the DI in the PR body and in the `drc.ts` and
   `bindings-emit.ts` header comments.
2. Post a dated note on BI-69415B68 with the DI and the rule.

### Task 5a-1: characterize current generator output

1. Before touching code, record the sha256 of the generated work-shape outputs:
   ```bash
   cd apps/web && shasum -a 256 lib/work-management/generated/*.ts lib/gpp/generated/gate-ratification-report.json lib/gpp/shape-language/gpp-shape.schema.json
   ```
   Paste the digests into the PR body. Constraint 4 is checked against them at the end.
2. Run `pnpm --filter web exec tsx scripts/build-gpp-shapes.ts --report > /tmp/report-before.txt`
   (stdout only; writes nothing).

### Task 5a-2: known findings (design §7.3)

Files: `apps/web/lib/gpp/shape-language/diagnostics.ts`, `drc.ts`, `compile.ts`, new
`known-findings.ts`, `known-findings.test.ts`.

1. **Tests first:**
   - `KNOWN_FINDING_ELIGIBLE_RULES` equals exactly
     `[{rule:"C-1"},{rule:"D-1"},{rule:"D-2"},{rule:"D-3"},{rule:"D-6"},{rule:"C-3"},{rule:"C-7",code:"C-7/SANDBOX-CONTAINMENT"}]`
     (pinned, so widening it is a reviewed diff);
   - `applyKnownFindings` refuses (throws a typed refusal the generator turns into a refusal line)
     an entry for D-8, D-7, E-NOT-EXECUTABLE, any S-*, C-2, D-5, C-4, D-4, PARSE, SCHEMA,
     `C-7/ENFORCEMENT-ENTRY` or `C-7/RESOLVER`;
   - entry-rule findings (C-1, D-1, D-2, D-3, D-6) carry a structured `tools` field with the O/A/I
     tool names that triggered them; an entry matches only when rule, code, element id and the
     `tools` set all match; adding one tool to the triggering set makes the entry not match;
   - a matched error comes back with `knownFinding: { reason, backlogItemId }` and severity still
     `error`; `hasBlockingDiagnostic` is false only when every error carries `knownFinding`;
   - `staleKnownFindings` reports an entry that matched nothing;
   - an entry without a `BI-` id or with an empty reason is rejected;
   - `compileShapeDocument` with `knownFindings` and a `sourcePath` not under
     `apps/web/lib/work-management/declared-flows/` is refused.
2. Implement. Types: `KnownFinding.rule: GppRuleId` and `code?: GppDiagnosticCode`
   (`diagnostics.ts:64`, `:116`), narrowed by a type derived from `KNOWN_FINDING_ELIGIBLE_RULES`.
   The structured `tools` field is added where the entry rules build their message today
   (`drc.ts:396`, `:422`, `:453`); the message text is unchanged, so the work-shape outputs and the
   corpus messages do not move.
3. `CompileShapeResult` (accepted) gains `staleKnownFindings: KnownFinding[]`; the generator refuses
   on any.

### Task 5a-3: C-3, D-7 binding clause and binding drafts use the entry gate (design §7.4)

Files: `drc.ts`, `bindings-emit.ts`, their tests, DRC corpus fixtures.

1. **Tests first:**
   - `drc.test.ts`: stage 1 exits by an enforced typed gate, stage 2 carries a binding and exits by
     status change → no C-3. The same binding on stage 1 (the start stage) → C-3 on
     `binding:<id>@<v>`. A binding on a stage entered by a status-change advance → C-3;
   - `bindings-emit.test.ts`: the draft's `gateKey`, `authority` and `resolver` come from the
     entering gate; a bound stage whose entering transition is ungated yields no draft;
   - update fixtures that encoded the old reading; list each changed fixture in the PR body.
2. Implement `enteringGate(document, stageKey)` over `buildShapeFlowGraph` (`drc.ts:388`), used by
   C-3, the D-7 binding clause (`drc.ts:322-326`) and `emitBindingRecords`. With several
   predecessors (only after a join, which no compiled document has), every predecessor must exit by
   a typed gate of the same authority, else C-3.
3. Grep for importers of `bindings-emit.ts` and list them in the PR body (expected: tests only,
   `bindings-emit.ts:24-25`).

### Task 5a-4: C-7 sandbox clause (design §7.5)

Files: `drc.ts`, `drc.test.ts`, `drc-corpus.test.ts` if it pins the standing finding.

1. **Tests first:**
   - no `sandboxStages` option → exactly one `C-7/SANDBOX-CONTAINMENT` finding, severity `info`,
     "not applicable" message (replaces `drc.test.ts:187-189`);
   - `sandboxStages: {"build"}` and stage `build` with an `environment` binding → no finding;
   - `sandboxStages: {"build"}` with no binding, or a non-environment binding → `error` on
     `stage:build`.
2. Implement `DesignRuleOptions.sandboxStages?: ReadonlySet<string>`. Update the `drc.ts` header
   (lines 68-69). `compile.ts` accepts `sandboxStages` only for declared-flow source paths, like
   `knownFindings`.

### Task 5a-5: generator second root (design §7.2)

Files: `apps/web/scripts/build-gpp-shapes.ts`; tests in
`apps/web/lib/gpp/shape-language/generated-integrity.test.ts` and `determinism.test.ts`; new
directory `apps/web/lib/work-management/declared-flows/` (only `.gitkeep` in this PR).

1. **Tests first** (temp-dir fixture root):
   - a document under `declared-flows/` compiles to `generated/<key>.flow.generated.ts` and is
     listed in `generated/declared-flows.generated.ts` as `GENERATED_DECLARED_FLOWS`; it does not
     appear in `GENERATED_WORK_SHAPES`;
   - a sibling `<key>.known-findings.ts` exporting `KNOWN_FINDINGS` and `SANDBOX_STAGES` is passed
     as `knownFindings` and `sandboxStages`; a stale entry and an ineligible rule are refusal lines;
   - a work-shape document never receives either option, even if a sibling file exists (refusal
     line);
   - a declared-flow key equal to a registered work-shape key is a refusal line;
   - **orphans:** `listGeneratedFlowModules` (suffix `.flow.generated.ts`) feeds the existing orphan
     rule (`build-gpp-shapes.ts:227-243`): a `.flow.generated.ts` with no source is stale under
     `--check` and removed on write. `declared-flows.generated.ts` is an output, never an orphan;
   - determinism: a declared-flow document compiled twice, once with shuffled keys, gives
     byte-identical output.
2. Implement. The sidecar is a TypeScript module the generator imports dynamically; keep it free of
   runtime imports other than types, the realization constants and `sandboxPhases()`, so the
   generator stays static (no DB, no network).
3. With an empty `declared-flows/`, `declared-flows.generated.ts` is written with an empty list.
4. `--report` is left registry-only (design: PR-5b reads refusal lines instead, task 5b-2).

### Task 5a-6: sandbox-dispatch ratchet (design §7.5)

Files: new `apps/web/lib/gpp/sandbox-dispatch-sites.ts` and `sandbox-dispatch-ratchet.test.ts`,
reusing `apps/web/lib/gpp/source-files.ts`.

1. Scan non-test sources under `apps/web/lib` and `apps/web/app` for, in three groups:
   - `runSandboxAgentCli(` call sites (expected: `lib/build/claude-dispatch.ts`,
     `codex-dispatch.ts`, `grok-dispatch.ts`, `opencode-dispatch.ts`, `ideate-dispatch.ts`, one each);
   - callers of `dispatchClaudeTask(`, `dispatchCodexTask(`, `dispatchGrokTask(`,
     `dispatchOpencodeTask(` (expected: the four `lib/build/sandbox/agents/*-agent-runner.ts` and
     `lib/build/build-pipeline.ts`);
   - `provider.exec(` and `provider.writeFile(` users (expected:
     `lib/build/sandbox/agents/dpf-native-agent-runner.ts`,
     `lib/queue/functions/git-promotion-sandbox-verification.ts`).
   Confirm the export names in each dispatcher before writing the patterns and record them in the
   test header.
2. `SANDBOX_DISPATCH_SITES: Record<file, { group; count; phase: BuildPhase | "outside-lifecycle" }>`.
   Classify each file's phase by reading its caller (expected: `ideate-dispatch.ts` → `ideate`; the
   agent runners and `build-pipeline.ts` → `build`; `git-promotion-sandbox-verification.ts` →
   `outside-lifecycle`; the four engine dispatch modules are reached from those callers and take
   their callers' phase).
3. State in the file header: **the phase labels are maintained by hand; the ratchet fails only on a
   new file or a changed count, not on a relabelling.**
4. Export `sandboxPhases()` = the classified phases in the Build Studio lifecycle.

### Task 5a-7: ratification test

File: `apps/web/lib/gpp/shape-language/gate-ratification.test.ts`.

1. Two-way key check (`:76`): the scope set adds `GENERATED_DECLARED_FLOWS`'s governed scopes. With
   no declared flow yet, the set is unchanged.
2. **Narrow the "describes today's behaviour" assertion (`:100-118`) to scopes used by registry
   shapes** (`governedUsesByScope`, `:26-37`). An entry whose scope only a declared flow uses is not
   held to `enforced`/blocking/`accountable-human`; P3 checks it against its source (design §5.3).
   Record the narrowing and its reason in the PR body. This is the design's recommendation over
   ratifying the Build Studio gate as `accountable-human`, which would misstate who resolves it.

### Task 5a-8: verify and open

1. ```bash
   pnpm --filter web exec vitest run lib/gpp lib/work-management
   pnpm --filter web typecheck
   pnpm --filter web check:gpp-shapes
   ```
   `lib/work-management` includes `drive-sequential-identity.test.ts` and `migration-proof.test.ts`.
2. Re-run the task 5a-1 digests; they must match. Diff `--report` before and after: **the expected
   diff is none.** `--report` prints only errors and warnings (`build-gpp-shapes.ts:270`), and the
   C-7 sandbox line moves between `not-evaluated` and `info`, both of which it filters out.
3. Constraint 1 allowlist check. Lint changed files.
4. PR body: digests, report diff (empty), fixture changes from 5a-3, the ratification-test narrowing,
   the DI from 5a-0, the no-docs-needed reason ("compiler tooling only; no user, coworker or runtime
   surface"), DCO sign-off. `pnpm pr:health <n>`, then `gh pr merge <n> --squash --auto`.

## PR-5b: Build Studio declared shape

Branch `feat/gpp-phase-5b-build-studio-shape`, after PR-5a merges.

### Task 5b-0: decision before merge

1. Put Q1 to the founder: ratify `build-studio-plan-advancement` with the design §5.3 gate
   (resolver `lib/decision-perspective/build-studio-gate#evaluateBuildStudioPlanAdvancementGate`).
   Consult `principle_decide` (WWMD) and record the outcome. The PR does not merge without the DI.
2. Record the Option B decision (design §4) as a WWMD outcome in the same consultation, so the
   reason the shape is not drive-executed is on the ledger.
3. Q2 is decided (DI-EFCFA7596534); cite it in the known-findings module header.

### Task 5b-1: realization map (design §10)

File: `apps/web/lib/work-management/declared-flows/build-studio.realization.ts`, test
`build-studio.realization.test.ts`.

1. **Tests first**, then implement, in this order:
   - `BUILD_STUDIO_EVIDENCE_MAP: Record<GateRequirement, WorkShapeEvidenceKind | null>` (design §5.4),
     total over `GATE_REQUIREMENTS`.
   - `PLAN_TO_BUILD_MODE_RANK` (design §10.1): `blocking` 5, `blocking-soft` 5, `autonomous-mode` 4,
     `upstream` 3, `not-evaluated-recorded` 2, `not-evaluated` 1. A test asserts it is total over
     `PlanToBuildGateMode` (`plan-to-build-transition-core.ts:92-98`).
   - `CANONICAL_PLAN_TO_BUILD_PRECONDITIONS` = the `advance-build-phase` profile's
     `callerChecksBefore`, read from the profile, not copied.
   - `planToBuildDivergences()`: per path, every gate ranked below the canonical mode, every
     `callerChecksBefore` entry missing from the canonical set, and an info row where
     `blocking-soft` stands for `blocking`. The test prints the table; that printed output is what
     the PR body and GPP Annex A cite. Tie the `save-phase-handoff` rows to BI-5D59A982.
   - `BUILD_STUDIO_TRANSITION_PATHS`: every row of design §10.1's declared table, each with writer
     `(file, line)`, gates, rightsizing opts passed / not passed, and backlog reference where one
     exists (BI-BDB63485 for the `save_phase_handoff` rows).
   - `BUILD_STUDIO_CONFIG_DEPENDENT_GATES` (design §10.1, configuration table).
   - `SANDBOX_TOOL_CLASS: Record<sandboxPackToolName, "read" | "act" | "lifecycle">`; a test fails if
     a `sandbox-pack.ts` tool is unclassified. `sandboxActingPhases()` = phases tagged on any `act`
     tool. `BUILD_STUDIO_SANDBOX_STAGES = sandboxPhases() ∪ sandboxActingPhases()` (expected
     `{ideate, build, review}`).
   - `BUILD_STUDIO_ELEMENT_MAP` (design §10.3).
   - `lifecycleVariantDeltas()` over `getProcessPolicy` for 16 cells × {base, `qualityFirst`, each
     `DeliverableSensitivity`}.
   - Recorded facts: three reach rules with the declared choice (design §10.4), readiness
     correspondence, residual risks (network egress; `AUTH_SECRET`, BI-F1C680C7).
2. No Prisma or MCP pack graph at module scope; `PLATFORM_TOOLS` is read in tests only, through the
   import `stage-tool-parity.test.ts` uses.

### Task 5b-2: the document and its first compile

File: `apps/web/lib/work-management/declared-flows/build-studio.gpp.json`.

1. Author per design §5.2 and §5.3: five stages; `tools` copied from the `buildPhases` sets
   (code-unit order); the plan gate with resolver module `lib/decision-perspective/build-studio-gate`
   (no `@/`); the `build` binding (design §9.1); three stops; `grants`, `measures`, `budgets: []`,
   `reviewPoint` 30 days.
2. Add the ratified entry to `gate-ratification.ts` with the DI and date from task 5b-0.
3. With an empty `KNOWN_FINDINGS`, run `pnpm --filter web build:gpp-shapes` and record every refusal
   line. (`--report` does not cover declared flows and hides `info`/`not-evaluated`; the refusal lines
   are the complete error set.) Expected (design §7.3): C-1 `stage:ideate`; D-1 `stage:ideate`,
   `stage:build`, `stage:review`; D-3 `gate:plan`; `C-7/SANDBOX-CONTAINMENT` `stage:ideate`,
   `stage:review`. Any D-7 means the resolver import failed in this environment (R7), not a Build
   Studio gap: fix the environment, never list it.

### Task 5b-3: known findings

File: `apps/web/lib/work-management/declared-flows/build-studio.known-findings.ts`.

1. One `KnownFinding` per refusal line from task 5b-2, with the triggering `tools` set, a reason
   citing code and a backlog item. File any missing backlog item with `dpf-file-backlog-item`
   before citing it. Only eligible rules can be listed (PR-5a); anything else means the document is
   wrong and is fixed instead.
2. Export `SANDBOX_STAGES = BUILD_STUDIO_SANDBOX_STAGES`.

### Task 5b-4: conformance tests (design §8)

File: `apps/web/lib/work-management/declared-flows/build-studio.conformance.test.ts`. One `describe`
per property; each failure names the file and row to update.

- **P1 topology and writes.** Stage keys equal `PHASE_ORDER` minus `complete`, `failed`,
  `abandoned`. Every `canTransitionPhase(from, to)` pair is a forward edge, a stop or a path row.
  Scan every non-test `.ts`/`.tsx` file under `apps/web/app/` and `apps/web/lib/` with
  `findDirectPhaseWrites`; group the writes by `(file, target)` with counts; every group, including
  `create`/`createMany` entry rows, is attributed to exactly one `BUILD_STUDIO_TRANSITION_PATHS` row
  with the same count. A new group or a changed count fails.
- **P2 capability.** Per stage, `tools` equals the coworker-rule tag set.
- **P3 gate set and preconditions.** The plan gate equals the canonical profile reading;
  `planToBuildDivergences()` equals the declared C-8 rows for modes and `callerChecksBefore`.
- **P4 evidence**; **P6 variants with rightsizing** (snapshot committed under `__snapshots__`).
- **P5 containment.** Environment-bound stages plus known `C-7/SANDBOX-CONTAINMENT` entries equal
  `BUILD_STUDIO_SANDBOX_STAGES`.
- **P7 inertness.** Import scan over `app/` and `lib/` excluding tests and `scripts/`.
- **P8 registry unchanged.** `listWorkShapes()` keys equal
  `__fixtures__/work-shape-keys.pre-migration.json`; `GENERATED_WORK_SHAPES` unchanged.
- **Element map.** Every compiled element id has exactly one row, and the reverse.
- **Binding draft.** `emitBindingRecords` over the compiled document returns exactly one draft:
  binding `build-studio-sandbox@1`, owning gate `gate:plan` (WWMD, `build-studio`), tools
  `recover_sandbox` and `release_nonprod_environment_lease`. Nothing writes it.

### Task 5b-5: generate and verify

1. ```bash
   pnpm --filter web build:gpp-shapes
   pnpm --filter web check:gpp-shapes
   pnpm --filter web exec vitest run lib/work-management lib/gpp lib/build/plan-to-build-transition.characterization.test.ts lib/build/build-on-plan-approval.plan-to-build.characterization.test.ts lib/mcp/packs/build-evidence-extra-pack.plan-to-build.characterization.test.ts lib/mcp/packs/build-evidence-extra-pack.c8-shadow.test.ts
   pnpm --filter web typecheck
   ```
2. Constraint 1 allowlist check (P10); constraint 4 digests (P9) against task 5a-1; constraint 5
   (P11). The ratification report is unchanged: `buildRatificationReport` reads
   `context.definitions` (registry and priors, `build-gpp-shapes.ts:89-96`), and declared flows are
   not added to it.

### Task 5b-6: documentation (design §18)

1. `docs/architecture/gated-permissions-process.md`, **revision 0.10**:
   - §12.4.3 "Executable model": Build Studio is a declared flow, verified at default configuration,
     not executed; paths to the document, realization map and conformance test.
   - §12.4.3 "Transition gate sets": every Build Studio transition declared; divergences listed (the
     generated plan → build table); C-8 open; BI-BDB63485 named.
   - Annex A rows "Executable model source" and "Transition path uniqueness".
   - Annex C.1: the ship gate is not evaluated under the default `off` playbook mode; ideate runs a
     coding CLI in the sandbox; review acts in the sandbox. C.4: status per step (design §11).
   - Residual risks: sandbox network egress; `AUTH_SECRET` shared with the sandbox (BI-F1C680C7).
   - Revision-history row 0.10.
2. Regenerate the docs-impact graph and check it:
   ```bash
   pnpm docs:impact:graph
   pnpm docs:impact:graph:check
   ```
   Commit `apps/web/lib/docs/doc-impact.generated.json` if it changed (it is on the allowlist).
3. PR body: no user- or coworker-facing doc changes, with the reason (no screen, prompt, tool or
   behaviour changes).

### Task 5b-7: open, merge, record

1. Fast local gate (task 5b-5), lint, `pnpm pr:health <n>`, `gh pr merge <n> --squash --auto`.
2. After merge, record execution evidence on BI-D37B2C13 (`record_execution_evidence`: PR, merge
   SHA, conformance test names). UX verification: not applicable (no UI); say so.
3. File the follow-ups (design §11) with `dpf-file-backlog-item`, linked to EP-B932453F. Do not
   re-file BI-BDB63485 or BI-F1C680C7; link them.
4. Move BI-D37B2C13 to `done` only after acceptance against the §15 baseline.

## Tasks (checklist)

### PR-5a

- [ ] 5a-0 WWMD outcome superseding parent §6.4's binding-record rule; note on BI-69415B68
- [ ] 5a-1 Record generator digests and the before `--report`
- [ ] 5a-2 Known findings: closed eligible set, tool-set matching, declared-flow paths only, stale detection; tests first
- [ ] 5a-3 Entry-gate owning scope for C-3, D-7 binding clause and binding drafts; fixtures listed
- [ ] 5a-4 C-7 sandbox clause: `info` for work shapes, evaluated with `sandboxStages`
- [ ] 5a-5 Generator declared-flow root, `GENERATED_DECLARED_FLOWS`, `.flow` orphan rule, sidecar options, refusals
- [ ] 5a-6 Sandbox-dispatch ratchet, three groups, hand-maintained phase labels; `sandboxPhases()`
- [ ] 5a-7 Ratification test: two-way set reads declared flows; behaviour assertion narrowed to registry scopes
- [ ] 5a-8 `lib/gpp` and `lib/work-management` suites; typecheck; digests match; report diff empty; allowlist; PR

### PR-5b

- [ ] 5b-0 Founder DI for Q1; Option B outcome recorded
- [ ] 5b-1 Realization map with tests (mode rank, divergences, path rows, sandbox classes, variants with rightsizing)
- [ ] 5b-2 Document; ratified entry; first compile's refusal lines recorded
- [ ] 5b-3 Known findings from the refusal lines, each with its tool set and a BI
- [ ] 5b-4 Conformance tests P1–P8, element map, binding draft
- [ ] 5b-5 Generate; fast local gate; P9, P10, P11
- [ ] 5b-6 GPP standard 0.10; docs-impact graph
- [ ] 5b-7 PR; merge; evidence; follow-ups filed

## Spec refinements and open questions

1. **Resolved implementer questions:**
   - "Build Studio file" is not defined; the allowlist (constraint 1) replaces it.
   - `.flow.generated.ts` orphans: `listGeneratedFlowModules` feeding the existing orphan rule
     (task 5a-5).
   - Generator tests: `apps/web/lib/gpp/shape-language/` (task 5a-5).
   - Binding drafts for declared flows: the generator produces none for any root; PR-5b pins the
     would-be draft in a test (task 5b-4).
   - `blocking-soft` vs `autonomous-mode`: `blocking-soft` ranks with `blocking` (it stops the
     transition; only reporting differs), above `autonomous-mode` (task 5b-1; design §10.1).
   - `--report` stays registry-only; PR-5b reads refusal lines (task 5b-2).
2. **Founder question:** Q1 only (required before PR-5b merges). Q2 is decided by DI-EFCFA7596534.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | PR-5a changes a generated work-shape file | Digests before and after (tasks 5a-1, 5a-8); `check:gpp-shapes` in CI; the structured `tools` field leaves message text unchanged |
| R2 | The entry-gate correction breaks a hidden consumer of binding drafts | `bindings-emit.ts` is fixture-only (`:24-25`); importers listed in task 5a-3 |
| R3 | Conformance tests fail on unrelated Build Studio PRs and get disabled | Failure messages name the row to update; the fix is data. Disabling a P-test is a §1 refusal, not a fix |
| R4 | The known-findings list absorbs real defects | Closed eligible set; never D-8, D-7, E-NOT-EXECUTABLE, S-*, C-2, D-5; tool-set match; shrink-only; BI per entry; declared-flow paths only |
| R5 | Q1 is not ratified | PR-5a stands alone; PR-5b waits on one DI |
| R6 | A sandbox dispatch path is missed or mislabelled | Three-group scan across `lib/` and `app/`; counts ratcheted; labels hand-maintained and reviewed (a relabel with unchanged counts is not detected, stated in the file header) |
| R7 | Heavy imports reach the generator | The realization map imports no Prisma or pack graph at module scope. **The plan gate's resolver check imports `lib/decision-perspective/build-studio-gate.ts`, which imports the evaluator (`:6`) and voice synthesis (`:14`).** `importResolver` turns any import failure into `false` (`resolve-sources.ts:96-103`), which surfaces as D-7, which cannot be listed. The generator runs with a full install in `audit-gpp-shapes.yml`; a local D-7 on this gate means an incomplete install. Task 5b-2 checks module load has no DB or network side effect at import time |
| R8 | Tests read as covering configured installs | Design §8 states they verify code declarations at default configuration only |

## Research & Benchmarking

Design §16: GitHub Actions environments, GitLab deployment approvals, Backstage software templates,
Argo Workflows retries and suspend. No new dependency is adopted.

## Traceability to the scope baseline

| PR | Objectives | Acceptance |
|---|---|---|
| PR-5a | OBJ-5-HONEST, OBJ-5-CONTAINMENT, OBJ-5-NODISRUPT | AC-5-KNOWN, AC-5-C3-ENTRY, AC-5-SANDBOX (clause and ratchet), AC-5-NODISRUPT (tooling neutral, drive golden) |
| PR-5b | OBJ-5-DECLARED, OBJ-5-FAITHFUL, OBJ-5-HONEST, OBJ-5-CONTAINMENT, OBJ-5-NODISRUPT | AC-5-COMPILE, AC-5-TOPOLOGY, AC-5-CAPABILITY, AC-5-GATESET, AC-5-EVIDENCE, AC-5-SANDBOX, AC-5-ELEMENT-MAP, AC-5-NODISRUPT |

## Verification

- Per AGENTS.md §4, tiered: unit tests and typecheck locally; `check:gpp-shapes` locally and in
  `audit-gpp-shapes.yml`; the production build in the cloud merge queue.
- UX verification: not applicable. Neither PR changes a route, screen, prompt or tool.
- Migration: none.
- Runtime: nothing reads the new modules. After PR-5b deploys through `/ops/self-upgrade`, confirm
  read-only that Build Studio's plan → build behaviour is unchanged on the live install (one UI
  advance, observed, not forced) and record it as execution evidence.
