---
status: active
---

# Late-defect detection hardening — make the common escape classes findable in the dev loop

**Status:** plan · 2026-08-16
**Umbrella BI:** BI-3D73CBC6
**Epic:** EP-413F2602 (whole-platform architecture hardening & simplify-strengthen program)
**Kernel decision:** `DI-C7D10BBB387B` (umbrella-plan-decomposed-guards, composite 15.57 vs 8.15 / 7.88, margin 7.42, high confidence, no commandment conflict)
**Scope:** the unit-test and dev-loop layer only. UX and business-level exercise is a separate thread and is not duplicated here.

## Backlog coverage

**Umbrella item:** BI-3D73CBC6. Coverage decision: **decomposed** — each mechanism is independently shippable:

- M1 name-set referential integrity -> `BI-47629B5B`
- M2 test-inventory completeness guard -> `BI-B2E980B6`
- M3 twin-artifact set-parity guard -> `BI-788EC51A`
- M4 degenerate-environment fixture kit -> `BI-927D64C0`
- M5 did-not-run honesty (pregate exit + zero-work legality) -> `BI-A9CF0D69`
- M6 declared-but-inert conformance -> `BI-6FD78522`
- M7 hermetic-gate conformance -> `BI-95A83B47`

Dependencies: none between mechanisms (ordering in §3 is a recommendation, not a dependency).

**Governed coverage receipt: blocked by BI-B9403248.** `record_plan_backlog_coverage` (schema v2) still rejects external CLI sessions on its repository-artifact provenance check. The full decomposed deliverable set above was submitted on 2026-08-16 (capsule `WC-20DDF4B2`, commit `591546718`, blob `30dd59d1`) and refused with `plan-artifact-invalid` → "Repository DCO author cannot be mapped unambiguously through capsule provenance" — even after the capsule was re-adopted with a stamped `headSha`, confirming BI-B9403248's second failure leg (single-agent activity provenance an external session structurally cannot produce). Fittingly, that defect is itself a class-C instance of this plan's §2.1 (a gate whose accepted-caller set is narrower than its governed population). Restore the governed receipt here when BI-B9403248 ships.

## 1. Why — the observed problem

A single session (PRs #4344, #4374, #4385, #4390) produced an unusual number of defects found only after merge, on the live install or by hand-reading code. The question posed: are these one-off misses, or recurring failure-of-detection modes the net could be taught to catch?

## 2. Evidence base

Two independent samples, classified by **why the existing net missed the defect**, not by symptom:

- **Git history:** 65 escaped defects from the last ~200 `fix(...)` commits on `origin/main`, where the commit message or diff shows the bug reached main or a live install. Commit messages in this repo are unusually forensic; classification is quoted, not inferred, except where marked. A minority of trailer-only fix commits were excluded rather than force-fit (honesty note: the richly-narrated commits skew toward the harder escapes).
- **Live backlog:** 41 of ~270 `workType=bug` BIs (done 215: 146 automated-detection / 69 user-request; open 46; in-progress 9), bodies read in full. Caveat recorded: `source: automated-detection` is an intake-channel label — many such BIs were filed by an agent after a *manual* live investigation, so the field overstates automation.

Total classified: 106 (small overlap between samples, e.g. BI-8742C12A, BI-1D144CC1 appear in both).

### 2.1 The hypothesis, tested

The four candidate classes (A name-vs-resolved-thing, B healthy-environment fixtures, C narrow guard scope, D success-without-execution) were **tested against, not adopted**. Verdict:

| Class | Combined share | Verdict |
|---|---|---|
| **B** — fixtures model only the healthy environment; degenerate states (partial tree, absent service, empty data, two installs, oversized input, wall-clock, transient failure) unmodelled | **~30%** | **Supported — dominant.** |
| **C** — guard scope narrower than the protected surface (pinned subset vs completeness: one of two installers, one of three ingestion paths, build-matrix-but-not-merge-matrix, `cp` but not `COPY`) | **~20%** | **Supported.** |
| **D** — success signal without proof of execution (exit-0 masking, "Completed" with zero work, "OK pulled" on wget exit) | **~15%** | **Supported — and it is the amplifier: C and wiring-gap defects almost always survived because a false green sat on top.** |
| **A** — assertion against a name rather than a resolved thing | **~7%** | **Supported but small.** Real (phantom gate names #4385, phantom probe endpoints BI-7988DAD8, retired scrape targets BI-31FDC859), cheap to close, not the main story. |
| Modes outside A–D | **~28%** | The data adds classes the hypothesis lacked — see below. |

Classes the data **adds**:

- **Wiring gap / shipped-but-never-invoked** (~4% by count, but containing the most expensive escapes): re-verifier whose locator was discarded at write time (#4344); stance publish that never calls the embedder (BI-D4C1E05E); scheduler that never passes `externalAccessEnabled` (BI-0A59F936); tools sealed by `grants:{}` + deny-by-default (BI-F998BCE8).
- **Packaging/release path never exercised locally** (~6%): Docker `deps` stage vs `patches/` (BI-FF2BB8F7, BI-C278514A), `pnpm deploy --prod` pruning, published-artifact rot (7e5f97aa0).
- **Non-hermetic tests / env-parity drift** (~3%): ambient Postgres (BI-BFDCE0A9), real host-memory guard in unit tests (BI-EFA383AA), local-CI Postgres without pgvector (BI-032B49EB).
- **Platform-specific paths** (~5%): Windows PowerShell twins, WinNAT port theft, macOS `sleep` shadowing.
- **Cross-boundary contract drift** (~4%): MCP capability emitted as boolean not object (cecd6a4ff), Stop ≠ SessionEnd hook semantics (BI-E5D810B8), provider cache-prefix ordering (BI-56804810), `stop_reason:"refusal"` collapsed to empty success (BI-9F1F174D).
- Singletons not worth a mechanism: dependency-advisory-only (already owned by the security findings watch, WC-42C558DD), prod-build-only redaction path, non-discriminating oracle, reachability-not-asserted.

### 2.2 How escapes are actually found (n = 106)

Live-install runs / live measurement dominate (~50). Then post-merge CI or gate failure (~14), hand code-reading or live-DB audit (~16), fresh-machine installer runs (5), CodeQL/Dependabot/OSV (5), automated sweeps (6). **No user-reported defects in either sample** — founder/dev installs are doing the job a customer would in a shipped product. That is the cost being paid today: the live install is the de-facto test suite for classes B, C and D.

### 2.3 Two aggravating patterns worth naming

- **Tests that defend the bug.** Twice in the sample, the test asserted the defective behaviour (test asserted the reaper WAS in stop_cmds, BI-E5D810B8; policy test asserted Work Room shapes for phantom tool names, #4385). A green suite is evidence of consistency with the fixture, not of correctness.
- **The B+C common root.** The test's world is smaller than production along a dimension nobody named. B is that gap in environmental state; C is that gap in artifact/path completeness. The fixes that worked (check-release-compose-pins, the derived-artifacts registry, clock-bomb guard) all did the same thing: **made the untested dimension declarable and enumerable, then asserted over the enumeration.** That is the design principle for everything in §3.

## 3. Mechanisms — cheapest thing that fails loudly, per supported class

Substrate verified first (the platform is denser than it looks): guards auto-discover via `scripts/check-no-*.mjs` (one file, zero wiring — `check-guards.mjs:9-23`); three policy-guard profiles are the single guard inventory (`scripts/lib/ci-policy-guards.mjs`); red/green gate fixtures are an established convention (`docs/testing/fixtures/<gate>/`, BI-D967DEE0); did-not-run detection already half-exists at four levels (guard spawn classification exit-3, pregate-preflight environment/runner/violation taxonomy, ci.yml route-evidence assert, `pregate:status` SHA-bound verdict). Every mechanism below **extends** one of these; none adds a framework.

| # | BI | Class | Mechanism (one line) | Extends |
|---|---|---|---|---|
| M1 | BI-47629B5B | A | Every hardcoded tool/service/endpoint name-set resolves against its registry; covered-set list derived, not pinned | `consequential-tool-coverage.test.ts` ("every name resolves"), `check-doc-reference-integrity.mjs` |
| M2 | BI-B2E980B6 | C | Test-inventory completeness: every `scripts/**/*.test.mjs` + `hooks/*.test.mjs` reachable from a profile or the check-no-* convention | the hole `ci-policy-guards.mjs:233-235` names about itself, three times |
| M3 | BI-788EC51A | C | Twin-artifact set-parity: sh↔ps1 behavior markers, build↔merge matrices compared as sets | the "half the chain" fixes (#4369, #4371), distinct from BI-B2839E89 (runner-level Windows CI) |
| M4 | BI-927D64C0 | B | Degenerate-environment fixture kit (partial tree/no-.git, absent/stale artifact, empty/null rows, two-installs-independent-ids, oversized input, transient-then-success) + enumerated probe-module conformance, with a completeness check on the enumeration itself | red/green fixture convention; the evidence-reverifier's injected-resolver pattern; `check-test-clock-bombs` already owns the time case |
| M5 | BI-A9CF0D69 | D | Abandoned-while-queued pregate exits a distinct non-zero code (exit 0 ⇒ gated and passed, always); zero-work "Completed" requires declared zero-legality, count in the success line | the four existing did-not-run levels; `docs/testing/pre-pr-gate.md:346` documents the current lie |
| M6 | BI-6FD78522 | wiring | Declared-but-inert: every registered tool granted-or-marked; produce/consume contract pairs asserted (locator↔re-verifier, stance↔embedder); unhonored-grant count becomes a shrink-only ratchet. **Landed 2026-08-22** (tool half): `apps/web/lib/tak/tool-reachability.conformance.test.ts` (every PLATFORM_TOOLS tool reachable by ≥1 registry agent or on the reasoned shrink-only exemption list in `tool-reachability-exemptions.ts` — 20 tools baselined) + `scripts/check-no-unhonored-grant-growth.mjs` (unhonored-grant-key ratchet, baseline `scripts/unhonored-grant-baseline.txt`, 71 keys pinned) | `check-capability-consumers.mjs` (the exact shape, already shipped for capabilities), `audit-coworker-tool-grants.ts` (verdict today is a report, not a gate) |
| M7 | BI-95A83B47 | non-hermetic | Ambient-host markers in unit tests (raw DB, live memory probe) fail with a pointer to the injection seam; shrink-only baseline | `check-test-clock-bombs.mjs` idiom |

Deliberately **not** mechanised: cross-boundary contract drift (provider semantics change under you; a pinned conformance fixture rots into class A — this is a checklist line instead), packaging paths (the escapes of Aug 12–16 each shipped their own targeted guard — `check-release-asset-contract`, `check-docker-patch-context`, `check-edge-node-image-bom` — extend those on the next escape rather than pre-building generality), platform runners (that is BI-B2839E89, already filed and open).

Ordering: M2 and M1 first (each is small and closes the "a test/name that isn't wired gates nothing" hole that undermines every other guard); then M5 (exit-code honesty makes all subsequent signals trustworthy); then M4 (largest class, most new surface); M3, M6, M7 in any order. Each lands as its own PR with a red fixture proving the guard trips before it is trusted — a guard whose own failure mode is untested is a class-D instance.

## 4. Review checklist — only what cannot be a failing test

Justified line-by-line by an incident; anything below that later proves mechanisable should be converted and struck. A checklist is the weakest instrument here — the most expensive defect in the sample WAS a hand-maintained list that rotted while reading as coverage.

1. **Name the dimension your fixtures do not vary** (tree completeness, install count, data presence, scale, clock, transient failure). If you cannot name one, you have not looked. — BI-EE2B243D, 8dde5854e
2. **State what the guard does NOT cover in the guard's own header.** Undercount declared is honest; undercount implied is #4385.
3. **For any "X is done" claim, name the caller that invokes X in production.** No caller, not done. — #4344, BI-D4C1E05E
4. **When a check passes suspiciously fast or reports zero findings, ask what would have made it fail.** — BI-F359E1E9, 7a6c66b4e
5. **A fix to a `.sh`, a matrix, or one ingestion path: grep for the twin before commit.** — BI-68EED40A, #4371
6. **When consuming an external contract (provider API, hook event, wire schema), read the current spec, not the memory of it.** — cecd6a4ff, BI-9F1F128A/BI-9F1F174D
7. **A test that asserts current behaviour is only as good as the fixture's claim to represent reality — ask "does the live install look like this fixture?"** — BI-E5D810B8, #4385

## 5. Friction — costed separately from correctness

| Observed | Verdict | Basis |
|---|---|---|
| Pregate killed twice by host-pressure SIGTERM mid-run | **Weather, with one fix already tracked.** Root cause is local-CI slot preemption, not memory (macOS swap is not a pressure signal); BI-EC8F2B33 covers slot-preemption babysitting. Retry-on-quiet-host is the correct operator move today. | pre-pr-gate.md:226; runner-failure exit taxonomy already distinguishes it |
| Piped pregate masking failure as exit 0 | **Worth fixing — it is M5**, not friction. The behavioural half (read `pregate:status`, never the pipeline exit) is already doctrine; the abandoned-queue exit-0 is a real lie and gets removed. | pre-pr-gate.md:346, :698 |
| Three discover→fix→re-baseline loops (module-size, tool-surface ratchets) | **Weather.** The loop *is* the ratchet doing its job; baselines are `merge=union` so concurrent re-baselines don't conflict. One cheap QoL is acceptable inside M2's PR if free: preflight already runs guards pre-lease, which front-loads discovery. Not worth mechanism. | check-module-size.mjs, .gitattributes |
| ~18s `pnpm install` per new worktree ×4 | **Weather.** Shared pnpm store already minimises it; 72s/session against the isolation guarantees is a good trade. Revisit only if worktree count per session grows. | worktree-per-session doctrine |
| Docs-impact gate flagging pages that merely cite a file | **Real but cheap-to-tolerate; defer.** The gate keys on `DOCS_ROUTE_MAP` longest-prefix, and its known weakness is the opposite one (opt-in edges under-protect — stated in `check-retired-substrate.mjs:10-13`). Tightening cite-vs-mechanism needs semantic judgment; a trailer (`Docs-Impact-Decision:`) already prices an override at one line. No BI filed. | check-docs-impact.mjs |

## 6. Research & benchmarking

- **Mutation testing** (Stryker, PIT lineage): the industry's general answer to "tests that pass for the wrong reason" (class A + the tests-defend-the-bug pattern). Rejected for now: run-cost on a monorepo this size is far above the targeted guards here, and the top classes (B, C) are environment/completeness gaps mutation testing cannot see. Reconsider per-package if class A recurs after M1.
- **Hermeticity as policy** (Bazel's sandboxed tests, Go's `testing/synctest` clock control): the M7 direction is standard practice; DPF's version is a grep-guard rather than a build-system migration — proportionate to 3% of escapes.
- **"Verify the artifact you ship, not the tree you built"** (SLSA provenance, container smoke tests): the packaging-class escapes match this known industry gap; DPF already moved (published-image contract check, 7e15030bf/#4366) and this plan deliberately leaves further generality unbuilt until the next concrete escape.

## 7. Acceptance for the umbrella

- All seven mechanism BIs individually shipped (each with red fixture) or explicitly re-triaged with reasons.
- A re-run of the §2 classification on the *next* 50 escaped defects shows B+C+D combined share falling; if it does not, the mechanisms missed and the classification, not the net, gets revisited.
