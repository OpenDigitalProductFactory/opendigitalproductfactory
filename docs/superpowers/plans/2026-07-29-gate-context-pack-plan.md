# Gate-context pack — prevention-side constraint injection plan

**Backlog item:** BI-2677A465 (EP-AGENT-INSTRUCTION-PLANE)

## Problem

DPF's CI gates are discovered reactively: an agent writes code, pushes, and
learns about the module-size ratchet, a frozen route word budget, a required
attestation trailer, or the generated route companions from a red check. The
52h failure taxonomy (2026-07-27 → 29) counted ~90 deterministic guard
failures in that class. The pregate guard-parity preflight (BI-D35433FB)
moved detection from CI to pre-push seconds; this plan moves the constraint
to BEFORE generation. External validation: AppFaktors' Architecture Context
Engine monetizes exactly this bet (constraints in agent context
pre-generation → their claimed 40–60% rework reduction).

## Substrate verdict (sweep 2026-07-29)

Nothing like a prospective diff→constraints generator exists.
`scripts/pr-readiness` executes gates and reports pass/fail (the back half);
`scripts/lib/ci-evidence-plan.mjs` classifies diffs for evidence selection and
is the architecture template (pure lib + CLI + deterministic output);
`POLICY_GUARD_PROFILES` is the canonical gate inventory. The UX-Fit and
Spec/Plan/Doc gates kept their file-sensitivity constants module-private, and
the dpf-skill-pack precheck hooks hand-mirror them ("Mirrors NEW_SOURCE_FILE_RE
in …") — a real drift existed when this plan was implemented: the
spec-plan-doc hook's mirror was missing the gate's migration-file alternative,
found by this slice's first drift-guard run and fixed in the same change.

## Deliverables

1. **generator** (this slice, under the umbrella BI):
   - `scripts/lib/gate-sensitivity.mjs` — hoisted canonical sensitivity and
     attestation constants; `check-ux-fit-decision.mjs` and
     `check-spec-plan-doc.mjs` import them (no behavior change).
   - `scripts/lib/gate-context.mjs` — `buildGateContext({changedFiles,
     addedLinesByFile})` deriving, from the same registries CI enforces:
     required attestation trailers (spec/plan/doc, design grounding, ux-fit,
     seed-fit, data-impact), module-size caps (baseline + absolute budgets),
     shrink-only prose/style ratchets, derived-artifact regeneration list,
     route budgets (net-new absolute + companions checklist; pre-existing
     frozen word budgets), and migration immutability/safety contracts.
     Deterministic: no timestamps, no environment probes.
   - `scripts/gate-context.mjs` CLI (`pnpm gate:context`, `--json`,
     `--base`): committed + staged + unstaged + untracked diff vs the merge
     base.
   - Drift-guards in `scripts/gate-context.test.mjs` pinning the skill-pack
     hook mirrors' behavior to the canonical exports (the hooks keep
     dependency-free copies because the pack is distributed outside the
     repo).
   - The pregate preflight's failure output points at `pnpm gate:context`.
2. **delivery-surfaces** → BI-121DC3A3: Build Studio `BuildContext.gateContext`
   prompt section + `get_change_gate_context` MCP tool, both consuming the
   generator module verbatim.
3. **pr-readiness-convergence** → BI-9652021C: `buildGatePlan()` derived from
   `POLICY_GUARD_PROFILES`; readiness report leads with the gate-context
   section; one trailer inventory; the shared `dpf-pr-with-dco` skill and
   GitHub PR template both require the mechanical readiness verdict after the
   final push and before PR creation.

## Acceptance (pr-readiness-convergence slice)

- Deleting or adding an executable policy command in
  `POLICY_GUARD_PROFILES` changes the pre-PR plan without editing a second
  registry; policy self-tests are not redundantly replayed and CI setup that
  mutates Git state is excluded from author worktrees. A missing source-only
  host runtime is reported honestly as CI-enforced rather than mislabeled as a
  product failure, matching the pregate-preflight degradation contract.
- The readiness report renders the prospective gate-context checklist before
  its pass/fail verdict for the exact `origin/main...HEAD` diff.
- Trailer parsing and prospective trailer guidance consume one canonical
  trailer-name contract.
- The shared external-agent PR skill and GitHub template instruct authors to
  run `pnpm gate:context`, the cheap no-lease preflight, exact-tree pregate
  when applicable, and `pnpm pr:ready -- --pr-body-file ...` before creating
  a regular PR.

## Acceptance (this slice)

- For a synthetic diff touching a baselined module, a design-sensitive file, a
  new route, seed content, and a migration, the pack names the exact cap,
  trailer, companion, and immutability constraints CI would enforce — proven
  by unit tests against the live registries.
- Identical inputs produce byte-identical packs.
- Hook drift-guards fail CI when a mirror and the canonical constant diverge
  (proven by catching the real migration-alternative drift).

## Backlog coverage

- Decision: decomposed
- Parent: BI-2677A465
- Receipt: cms6sdpei06fg01ogjis8acqw
- Dependencies: delivery-surfaces and pr-readiness-convergence depend on the
  generator; the generator has none.
- Mapping: `generator` -> BI-2677A465
- Mapping: `delivery-surfaces` -> BI-121DC3A3
- Mapping: `pr-readiness-convergence` -> BI-9652021C

## Risks

- **A fourth copy of gate knowledge.** Mitigation: the pack imports checker
  exports and reads the checked-in baselines directly; the only remaining
  copies (skill-pack hooks) are drift-guard-pinned.
- **Stale advice after a gate changes.** Mitigation: same-repo derivation —
  a gate change and its pack output move in the same commit; the drift-guards
  cover the one distribution boundary.
- **Prospective ≠ enforcement.** The pack is advisory context; CI gates remain
  the only authority. The pack must never claim a gate passed.

## Live backlog reconciliation (2026-08-08)

The historical BI and epic identifiers above are retained as delivery
provenance, but they no longer resolve in the current live backlog. The next
prevention slice is governed by live `BI-A7407F49` under
`EP-WORK-CONVERGENCE`: it makes gate context an automatic, persisted Work
Capsule impact contract at edit-scope claim time. See
`docs/superpowers/plans/2026-08-08-automatic-work-capsule-impact-contract.md`.
