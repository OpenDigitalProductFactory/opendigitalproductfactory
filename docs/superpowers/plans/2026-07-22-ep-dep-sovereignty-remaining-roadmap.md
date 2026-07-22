# EP-DEP-SOVEREIGNTY — Remaining Roadmap Execution Plan

| Field | Value |
|-------|-------|
| **Status** | Draft — authored 2026-07-22 |
| **Epic** | `EP-DEP-SOVEREIGNTY` |
| **Design spec** | [`2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md`](../specs/2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md) |
| **Companion (detection)** | [`2026-05-21-supply-chain-and-desired-state-assurance-design.md`](../specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md) (`EP-ASSURANCE-LEDGER`) |
| **Companion (tooling)** | [`2026-07-21-agent-process-efficiency-hardening-design.md`](../specs/2026-07-21-agent-process-efficiency-hardening-design.md) |
| **Author** | Claude (Opus 4.8) + Mark Bodman |
| **Kernel decision** | `DI-957F61CFECEA` (vendoring bar = strict-all-of, high confidence — §Phase A) |
| **Work Capsule** | `WC-5D3ED98A` |

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. **Do not force multiple BIs into one PR.**

---

## 0. Where we are

Phase 0 (spec §8) is merged to `main`:

- `BI-316CCCD7` (done, #3362) — pruned 6 redundant override floors.
- `BI-3FB75D09` (done, #3360) — dependency-hygiene tooling: `scripts/regen-lockfile.mjs`, `scripts/check-override-comments.mjs` (+ Override Provenance Guard CI job), `dpf-clear-dependabot-alerts` skill, AGENTS.md §5 rule.

Six BIs remain open. This plan sequences them into one-concern-per-PR deliverables, each grounded in verified substrate.

### Substrate that already exists (verified 2026-07-22)

| Asset | Path | Relevance |
|---|---|---|
| Override Provenance Guard | `scripts/check-override-comments.mjs` | tag convention (`Dependabot #NN` / GHSA / CVE) the stale-override audit machine-checks |
| Lockfile regen helper | `scripts/regen-lockfile.mjs` | fresh-store re-resolve — the ONLY sanctioned path |
| New Dependency Gate | `scripts/sbom/check-new-dependencies.mjs` | network-free required check; acknowledges direct deps in `sbom/dependency-allowlist.json` |
| Provenance/install-script audit | `scripts/sbom/audit-provenance.mjs` | **already reads SLSA `dist.attestations.provenance`**, report-only; honors `NPM_REGISTRY_URL` |
| Diagram-pin cooldown (hand-rolled) | `scripts/check-diagram-dependency-pins.mjs` | the ad-hoc cooldown a first-class policy generalises (BI-72E0A27B) |
| `AssuranceFinding` model | `packages/db/prisma/schema.prisma:6396` | **landed** — provenance findings emit here (one findings store) |
| `AssurancePolicy` model | — | **NOT landed** — cooldown/provenance/bar policies cannot be rows yet (spec §1.1) |
| Deployment contracts | [`2026-05-09-deployment-contracts.md`](../specs/2026-05-09-deployment-contracts.md) | the registry proxy MUST wrap these |
| Acquisition-hardening program | `docs/architecture/dependency-reduction-routine.md` | 2026-06-20 `principle_decide` lineage this epic continues |

**Load-bearing seam facts:**
- `AssuranceFinding` exists; `AssurancePolicy` does not. Provenance findings have a home; intake *policies* (cooldown window, provenance threshold, the vendoring bar) do **not** yet have the canonical `AssurancePolicy` substrate. Every phase that expresses a policy ships **minimal inline enforcement + a `register_tech_debt` row to fold into `AssurancePolicy`** — never a bespoke parallel policy table (`schema-audit-before-features`).
- The New Dependency Gate is **network-free by design** so it can be a *required* check. Network lookups (provenance, package age) live in `audit-provenance.mjs`-class scripts. Enforcement therefore uses the **verify-then-record-then-gate** pattern: the network step verifies and writes a verdict into the allowlist entry / an `AssuranceFinding`; the network-free gate enforces that a verdict is present — exactly how the Override Provenance Guard enforces tags without re-resolving the tree.

---

## Phase A — Ratify the vendoring bar (`BI-6B50CE41`, small) · **PR 1** · *this session*

**Status: kernel decision DONE.** `principle_decide` (`DI-957F61CFECEA`, external_coding_agent, universal-ring) scored three bar shapes:

| Option | Composite | Verdict |
|---|---|---|
| `strict-all-of` | **8.26** | **RECOMMENDED** (margin 2.97, high confidence, no commandment conflict) |
| `weighted-threshold` | 5.29 | rejected |
| `security-first-any-of` | 3.65 | rejected — *negative* on "Destructive actions require explicit go" & "Never wipe the DB" |

Top positive contributors: Never Fabricate, Build Gate, **Always Respect Open-Source License Terms**, Architecture Over Shortcuts. The kernel surfaced license terms as a first-class contributor — folded in as criterion 6 below.

### The ratified bar (concrete cutoffs — spec §10 Q3 resolved)

A dependency is a **Tier-1 vendoring candidate only if it meets ALL SIX**:

1. **Runtime-critical** — declared in `dependencies` (not `devDependencies`) of a *shipped* workspace and reachable from a production entrypoint. Build/dev/test-only tooling is disqualified outright.
2. **Small & legible** — ≤ ~2,000 SLOC of first-party source (excl. tests), single-package (not a multi-package framework), and ≤ 5 runtime sub-dependencies of its own (bounded vendored surface).
3. **Stable** — ≤ 6 releases in the trailing 12 months **and** no breaking major in the trailing 12 months.
4. **High blast-radius** — sits in a security-sensitive category: crypto · auth/authn · (de)serialization · template rendering · request routing/parsing · or is in `allowBuilds` (runs code at install).
5. **Already-patched-by-us** — already carries a DPF `overrides:` floor or a fork/patch (we already maintain a divergence).
6. **License-compatible to vendor** — permissive license that allows source redistribution within our tree (MIT/BSD/Apache-2.0/ISC class). Copyleft (GPL/AGPL) or unlicensed → **not** a candidate without explicit legal review.

Miss any one → route to Tier-0 hardening, not vendoring. **Tier-2 (fork+refactor)** additionally requires a recorded *product* justification per candidate and is **never** entered for a security reason (the security benefit is fully banked at Tier-1). Blanket-forking remains the rejected alternative (spec §9).

`node-forge` (crypto, `overrides` floor, self-contained zero-runtime-dep MIT package) is the lead candidate; criteria 1 & 3 get their numeric confirmation inside the pilot BI.

**Deliverable (PR 1):** append §5.1 "Ratified bar (kernel `DI-957F61CFECEA`)" to the design spec with the six criteria + cutoffs above; cross-reference the decision id and this plan. Docs-only.
**Verification:** spec renders; `DI-957F61CFECEA` recorded in the kernel ledger (done); `search_specs_and_plans` finds the addendum.
**Risk/rollback:** none material (docs). If cutoffs prove wrong in the pilot, re-run `principle_decide` with revised features and supersede the addendum.

---

## Phase B — Standing stale-override audit (`BI-CDB2E8AB`, medium) · **PR 2**

**What:** a scheduled script (`scripts/audit-stale-overrides.mjs`, alias `pnpm audit:stale-overrides`) that (a) re-runs the §7.1 prune screen across every `pnpm-workspace.yaml` security-floor override via the fresh-store regen path, and (b) cross-checks the GitHub Security API for whether each floor's tagged alert (`Dependabot #NN` / GHSA) is still open; files a BI listing newly-redundant floors.

**Depends on:** the Override Provenance Guard's tag convention (shipped, `BI-3FB75D09`). Reuses `regen-lockfile.mjs` for the fresh-store re-resolve.

**Design notes:**
- Parse floors + tags by reusing the classifier in `check-override-comments.mjs` (extract the shared parser into a small module rather than duplicating the YAML walk — `single-source-of-truth`).
- GitHub Security API: read-only `GET /repos/{owner}/{repo}/dependabot/alerts` filtered by GHSA; graceful-skip when unauthenticated/offline (mirror `audit-provenance.mjs`'s offline behavior) so fully-local runs degrade to the prune-screen half only.
- **Schedule:** a GitHub Actions cron workflow (monthly) that runs the audit and opens a BI via the DPF MCP `create_backlog_item` (or a GH issue as fallback). It **proposes**, humans/agents verify each prune (`BI-316CCCD7` pattern) — never auto-edits overrides.

**Verification:** unit test over a fixture `pnpm-workspace.yaml` (redundant floor → flagged; load-bearing floor → kept; untagged floor → reported as un-auditable). Dry-run against the live tree produces a correct redundant/load-bearing split matching a hand-check.
**Risk/rollback:** report-only; worst case a false "redundant" flag, caught by the mandatory per-floor re-verify before any prune PR. Delete the workflow to roll back.

---

## Phase C — Provenance verification in the New Dependency Gate (`BI-640AEE80`, medium) · **PR 3**

**What:** promote the existing report-only `audit-provenance.mjs` into an *enforcing* intake control, using the network-free-gate pattern, and record verdicts as `AssuranceFinding` rows (kind `provenance`).

**Design (verify-then-record-then-gate):**
1. Extend the vetting step (network side): when a new direct dep is acknowledged, `audit-provenance.mjs` writes its provenance verdict (`attested` / `predicateType` / `none`) into the `sbom/dependency-allowlist.json` entry and emits an `AssuranceFinding` (kind `provenance`, the Ledger is the recorder — verify the `AssuranceFinding.kind` field admits `provenance` first; if not, that enum change is Ledger-owned, coordinate).
2. Extend `check-new-dependencies.mjs` (network-free required gate): fail a PR whose new/changed allowlist entry lacks a recorded provenance verdict — same shape as the Override Provenance Guard enforcing a tag. The gate stays network-free and required.
3. **Threshold is policy** → `AssurancePolicy` not yet landed. Ship the enforcement as "verdict must be present + recorded" (documentation-provenance, not a hard attest-or-block wall — most of the ecosystem is unattested, per the audit's own note), and `register_tech_debt` to fold the *threshold* (e.g. "block unattested in category X") into `AssurancePolicy` when it lands.

**Verification:** `dpf-tdd` — add a direct dep in a fixture without a provenance verdict → gate fails; with a verdict → passes. `AssuranceFinding` row written (assert via a DB read in an integration test). Existing `pnpm check:new-deps` stays green on the current tree after the allowlist is backfilled with verdicts.
**Risk/rollback:** backfilling verdicts for ~all existing direct deps is the bulk of the work; do it in the same PR via an `--update-allowlist`-style pass so the gate goes green atomically. Rollback = revert the gate's verdict-required branch.
**Seam:** provenance is VERIFIED here, RECORDED as `AssuranceFinding` in `EP-ASSURANCE-LEDGER`. Do not build a second findings store.

---

## Phase D — Version-adoption cooldown (`BI-F1267010`, medium) · **PR 4**

**What:** refuse dependency versions younger than N days (start **14**, per spec §10 Q2), with an emergency-override for same-day CVE fixes. Generalises the hand-rolled diagram pins (`check-diagram-dependency-pins.mjs`, BI-72E0A27B).

**Design:**
- Network side: a `scripts/audit-version-cooldown.mjs` reads each direct dep's resolved version publish time from the packument (`time[version]`), flags any younger than the window. Honors `NPM_REGISTRY_URL`; graceful-skip offline.
- Enforcement: verify-then-record-then-gate again — the cooldown verdict is recorded (allowlist entry `cooldownClearedAt` or an `AssuranceFinding`), and the network-free gate enforces presence. Same-day-CVE **emergency override** is an explicit, commented, recorded exception (mirrors the override-comment convention) so a bypass is always a deliberate recorded decision.
- **Window is policy** → minimal inline `const COOLDOWN_DAYS = 14` + `register_tech_debt` to fold into `AssurancePolicy` (`policyKind="supply-chain"`) once landed. Retire the ad-hoc diagram pins into this general mechanism only after it is proven (leave BI-72E0A27B pins in place until then).
- **Proxy interaction:** cooldown is *best* enforced at the registry proxy (Phase E) — the proxy can refuse to serve a too-young version to *any* resolver. Phase D ships the script-level gate first (protects everyone, including air-gapped); Phase E adds proxy-level enforcement as a second, stronger layer. Sequencing rationale in §"Sequencing" below.

**Verification:** `dpf-tdd` — fixture with a version published yesterday → gate fails; older than 14d → passes; emergency-override comment present → passes with a recorded exception. Offline → skips cleanly.
**Risk/rollback:** a legitimate urgent bump could be blocked — mitigated by the emergency override. Rollback = revert; the diagram pins remain as the pre-existing floor.

---

## Phase E — Private registry mirror/proxy (`BI-57731D5D`, large) · **PR 5**

**What:** a Verdaccio-class self-hostable proxy as the resolution source of record, wired through the existing `NPM_REGISTRY_URL` seam. **Optional / self-hostable / default-off** so fully-local & air-gapped installs still resolve without a hosted dependency (the fully-local-by-choice constraint is hard).

**Kernel sub-decision:** Verdaccio vs Artifactory (spec §10 Q1) — run `dpf-decision-via-kernel` at the top of this phase; spec leans Verdaccio for sovereignty/self-hostability (`operational_independence`, `prefer-self-hosted-infrastructure`).

**Design / blast radius (spec §8 Phase 1):** changing the resolution source of record touches every resolving path — root `.npmrc`, CI resolution, `scripts/installer/*`, contributor onboarding, edge-node, Build Studio sandboxes. Therefore:
- Ship **behind a capability activation, default off**, before it becomes any default. The proxy is an *option*, not a new hard requirement.
- **Wrap the deployment contracts** ([`2026-05-09-deployment-contracts.md`](../specs/2026-05-09-deployment-contracts.md)) — the proxy is a deployable service with the same contract surface.
- **Pass the Tool Evaluation Pipeline** (EP-GOVERN-002 / `tool-evaluation` skill / `mcp__dpf__evaluate_tool`) before adoption — Verdaccio is an external tool.
- Once active, it becomes the enforcement point for Phase C (provenance) and Phase D (cooldown) — a component can be refused at serve time.

**Verification:** with the capability off, resolution is byte-identical to today (regen produces a no-op lockfile diff — the `regen-lockfile.mjs` stability check IS the assertion). With it on against a local Verdaccio, `pnpm install --frozen-lockfile` resolves through the proxy; an air-gapped smoke test (proxy pointed at a warm cache, network cut) still resolves.
**Risk/rollback:** highest blast radius in the epic. Mitigation: default-off capability + deployment-contract wrap + Tool Eval gate. Rollback = deactivate the capability; `NPM_REGISTRY_URL` reverts to the public registry.

---

## Phase F — Vendoring pilot (`BI-D549A5A9`, xlarge) · **PR 6+ (split)** · *gated on Phase A*

**What:** vendor 1–2 candidates that clear the ratified bar (`node-forge` lead) and stand up the AI-owned watch→triage→backport→verify loop (spec §6), wired to `EP-ASSURANCE-LEDGER`'s coworker improvement loops. **THESIS PILOT with an explicit exit decision** — do not expand vendoring beyond the pilot without evidence.

**Sub-PRs (do not land as one):**
1. **F1 — Candidate confirmation:** run `node-forge` through the ratified bar (numeric checks for criteria 1 & 3); record the pass/fail as evidence. If it fails, pick the next candidate; do not force it.
2. **F2 — Vendoring mechanics:** freeze + own the copy, resolved from our tree/registry instead of live npm, **without diverging source** (vendoring ≠ fork). Build + tests + Assurance Ledger scan green on the vendored copy.
3. **F3 — AI-owned maintenance loop:** the watch (upstream release/CVE feed) → triage → backport → verify cycle as a scheduled coworker task, composing with the SBOM Management / Security Auditor agents. Demonstrate ONE full autonomous cycle end-to-end.
4. **F4 — Exit decision:** `dpf-decision-via-kernel` on the Phase-3 gate (spec §8): scale, hold, or un-vendor, based on demonstrated-loop evidence. A recorded decision either way.

**Verification:** F2 — vendored package resolves & the product builds/tests/scans green. F3 — a demonstrated autonomous maintenance cycle (an upstream change detected → backported → verified by the fleet, with evidence), or a recorded decision that the loop is not yet reliable.
**Risk/rollback:** vendoring is reversible (un-vendor back to the npm dep). The one-way-door risk is *fork+refactor* (Tier-2), which this pilot explicitly does NOT do. Rollback = restore the npm dependency + its override floor.

---

## Sequencing (recommended vs spec/user order)

The design spec §8 groups proxy + cooldown + provenance as "Phase 1" and notes cooldown is *best* enforced at the proxy. Substrate verification changes the leverage math: **provenance and cooldown can ship as cheap network-scripts today** (provenance especially — `audit-provenance.mjs` already reads attestations), banking most of the "poisoned update" protection *without* waiting on the large, high-blast-radius proxy. The proxy then adds a second, stronger enforcement layer.

**Recommended order:** A (done) → B (stale-override audit) → **C (provenance)** → **D (cooldown)** → **E (registry proxy)** → F (vendoring pilot).

This is a **deliberate reorder** of the roadmap note's "proxy before cooldown/provenance." It front-loads the two low-cost, independently-shippable intake gates and defers the large proxy to a belt-and-suspenders layer, so protection lands sooner. **Flagged for operator ratification before Phase C begins** — Phase A/B are order-invariant and proceed regardless.

## Cross-cutting guardrails

- **Lockfile:** any override/lockfile touch goes through `pnpm regen:lockfile` (fresh empty store) — never a naive `pnpm install`. `dpf-clear-dependabot-alerts` is the runbook.
- **`node-forge`:** do NOT prune its override — it is the Tier-1 vendoring candidate.
- **Policy substrate:** cooldown/provenance/bar are policies → minimal inline enforcement + `register_tech_debt` to fold into `AssurancePolicy`; never a parallel policy store.
- **Findings:** one findings store — provenance verdicts are `AssuranceFinding` rows; do not build a second.
- **Every PR:** DCO-signed, off `origin/main`, overlap-swept, `dpf-local-merge-ci-before-push` before push.
