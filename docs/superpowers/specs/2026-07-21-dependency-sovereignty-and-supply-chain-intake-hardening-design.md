# Dependency Sovereignty and Supply-Chain Intake Hardening Design

| Field | Value |
|-------|-------|
| **Status** | Draft — authored 2026-07-21 |
| **Created** | 2026-07-21 |
| **Author** | Claude (Opus 4.8) + Mark Bodman |
| **Architect review** | `dpf-architecture-review` 2026-07-21 — aligned with concerns; folded in the Assurance-Ledger seam (§1.1), registry-proxy blast radius + policy-substrate sequencing (§8 Phase 1), and provenance terminology disambiguation. Reference-doc gap filed as `IP-DF90F`. |
| **Trigger** | PR #3357 (cleared 11 Dependabot alerts via `pnpm-workspace.yaml` overrides) surfaced two questions: (a) why the override block has grown to 74 entries, and (b) whether DPF should sever ties with external dependencies and self-maintain the code. |
| **Primary Surfaces** | `pnpm-workspace.yaml`, CI gate scripts, Build Studio Tool Evaluation, Assurance Ledger |
| **Companion spec** | [`2026-05-21-supply-chain-and-desired-state-assurance-design.md`](2026-05-21-supply-chain-and-desired-state-assurance-design.md) (`EP-ASSURANCE-LEDGER`) |
| **Proposed epic** | `EP-DEP-SOVEREIGNTY` |

---

## 1. Scope and relationship to the Assurance Ledger

The Assurance Ledger spec (`EP-ASSURANCE-LEDGER`) is the **detection** half of supply-chain security: SBOM generation, SCA vulnerability scanning, findings lifecycle, desired-state drift, and governed remediation. It answers *"what is in this product and is it acceptable to ship?"*

This spec is the **prevention / intake / sovereignty** half. It answers a different question: *"on what terms does third-party code enter the tree at all, how much of it do we own outright, and how do we keep the control surface (the override block) from rotting?"* The two are complementary and must not be merged — detection tells you a bad component is present; intake hardening stops it entering, and sovereignty decides which components we refuse to depend on the ecosystem for.

Nothing here re-specifies SBOM/SCA. Where this spec needs "is component X vulnerable?", it defers to the Assurance Ledger.

### 1.1 The seam with the Assurance Ledger (single-source-of-truth)

Two boundaries must be crisp so nothing is built twice (`single-source-of-truth`):

- **Provenance is verified here, recorded there.** The intake provenance gate (§8 Phase 1) is the single *verifier/enforcer* of artifact attestation. It does not own a findings store — it emits an `AssuranceFinding` (kind `provenance`, per the Ledger §6.4) into `EP-ASSURANCE-LEDGER`. One verifier, two consumers (the intake gate blocks; the Ledger records/reports).
- **Intake policy is Ledger policy.** The cooldown window, provenance thresholds, and the vendoring bar are all *policies*. The Ledger defines the canonical policy substrate — `AssurancePolicy` with `policyKind = "supply-chain"` and an `enforcement` enum (`observe|warn|block|proposal-only`). That model is **proposed but not yet landed in `packages/db/prisma/schema.prisma`** (Ledger Phase 1). This spec's Phase-1 gates MUST therefore either (a) wait for `AssurancePolicy` and express intake policy as rows in it, or (b) ship a minimal enforcement now and file explicit migration debt to fold into `AssurancePolicy` — never a bespoke parallel policy store (`schema-audit-before-features`). Sequencing is called out per phase in §8.

> Terminology: "provenance" in this spec means **supply-chain artifact attestation** (SLSA / npm provenance / sigstore), distinct from the AGENTS.md §17 governance sense ("governance approves evidence, not provenance").

---

## 2. Problem statement

Two observations from the field, both real:

1. **The override block is growing without a pruning discipline.** `pnpm-workspace.yaml` carries 74 override entries as of 2026-07-21. Nobody removes a floor once the ecosystem catches up, so the block only grows. Left alone it becomes an unreadable liability where a genuinely-load-bearing security floor is indistinguishable from dead weight.

2. **A sovereignty instinct: sever ties and self-maintain.** The stronger claim is that DPF should fork/vendor its dependencies, refactor them to fit, and self-maintain — guarding against supply-chain compromise while "watching upstream" to backport fixes and learn. This is a genuine strategic fork in the road with a one-way door in it, and it deserves a recorded decision rather than a reflex in either direction.

This spec resolves both: a concrete pruning discipline for (1), and a tiered posture with an explicit rejected-alternative for (2).

---

## 3. The count is not what it looks like

Before deciding anything, ground the "74 overrides" number. Categorised from `pnpm-workspace.yaml`:

| Category | ~Count | Nature |
|----------|--------|--------|
| **jest-30 unification** | 42 | ONE architectural workaround expressed as 42 lines. `jest-expo` declares jest-29 transitive deps; without forcing the whole family to a single major you get a broken mixed 29/30 tree (reverted PRs #1053, #1288 are the evidence). Guarded by `scripts/check-mobile-jest-pin.mjs`. Not 42 decisions. |
| **CVE security floors** | ~18 | The correct, standard pnpm mechanism for patching a *transitive* dependency whose parent has not yet released a version using the fix. This is what PR #3357 added to. |
| **Diagram-stack exact pins** (mermaid, @zenuml, @floating-ui/*) | 8 | Churn-suppression (BI-72E0A27B): floating transitive ranges let lockfile regeneration pull a same-day graph. The most debt-like category. |
| **Dedup / unification** (@types/react, lodash, picomatch, uuid, ip-address) | ~6 | Collapse duplicate majors, or force a security-forked release (lodash 4.18.0). |

The headline number is inflated ~2.5× by the jest block and the diagram pins. The genuinely-distinct security decisions are ~18. **Reverting the overrides does not "address" the findings — it re-introduces every one of the CVEs**, because they are all transitive. The overrides *are* the fix.

---

## 4. Tiered posture (the recommendation)

Dependencies are not one decision. Sort them into three tiers by how much sovereignty each warrants.

### Tier 0 — Stay on upstream, harden the intake (the 99%)

The default. The tree resolves ~2000 packages; blanket-forking that is standing up a Linux-distro maintenance org, not a strategy. Instead, harden the *terms of entry* so that the attack that actually happens — a poisoned **update** you pull — is blocked without owning the code.

DPF already has most of this layer:

| Control | Status | Blocks |
|---|---|---|
| Pinned lockfile + integrity hashes | ✅ have | tampered artifacts |
| `--frozen-lockfile` CI | ✅ have | silent drift |
| `allowBuilds` allowlist (install-script control) | ✅ have (`pnpm-workspace.yaml`) | script-based RCE on install |
| New Dependency Gate + SBOM Divergence Guard | ✅ have (CI) | unreviewed deps entering |
| Dependabot | ✅ have | **known-CVE distribution — the thing forking removes** |
| Tool Evaluation Pipeline (EP-GOVERN-002) | ✅ have | unvetted external tools/MCP/APIs |
| Private registry mirror/proxy | ❌ **gap** | live dependence on the public registry; no cache/checkpoint |
| Version-adoption cooldown (no version younger than N days) | ❌ **gap** | zero-day malicious publishes / typosquat windows |
| Provenance / signature verification (npm provenance, sigstore) | ❌ **gap** | unattested artifacts |

The three gaps are the highest-leverage next work in the entire supply-chain program — cheaper than forking and they stop the real vector. The diagram-pin comment (BI-72E0A27B) is already an ad-hoc, hand-rolled cooldown; a first-class cooldown policy generalises it.

### Tier 1 — Vendor (a handful)

**Vendoring ≠ forking.** Vendoring = own a frozen copy, resolved from our tree/registry instead of live from npm, *without diverging the source*. It delivers essentially all of the supply-chain benefit (an attacker can no longer push you a poisoned update) while staying cleanly mergeable with upstream. Reserve it for packages that clear a hard bar (§5).

### Tier 2 — Fork and refactor (tiny, possibly empty)

Diverge the source to fit DPF. This is a **one-way door**: the moment you refactor, upstream fixes stop being clean merges and become conflict archaeology. It adds ~zero supply-chain protection over Tier 1. **Only enter Tier 2 for a product reason (you have genuinely outgrown upstream, or upstream is abandoned), never for a security reason** — the security benefit was already banked at Tier 1.

---

## 5. The vendoring bar (Tier-1 entry criteria)

A dependency is a vendoring candidate only if it meets **all** of:

1. **Runtime-critical** — it executes in the shipped product's hot path (not a build/dev-only tool).
2. **Small & legible** — small enough that the team (or the fleet, §6) can actually read and own it.
3. **Stable** — low upstream release velocity; you are not signing up to chase a fast-moving target.
4. **High blast-radius** — a compromise would be severe (auth, crypto, serialization, template rendering, request routing).
5. **Already-patched-by-us** — it already carries a DPF override or fork, i.e. you are *already* maintaining a divergence and the ecosystem relationship is already strained.

A stale-but-load-bearing override (a floor that never goes redundant — §7) is a strong Tier-1 signal: it means the package is one you perpetually have to hold a specific version of. `node-forge` (crypto, pinned 1.4.0) and the `@floating-ui`/`@zenuml` diagram stack (perpetually pinned against churn) are the first places to look.

**Non-goals / rejected:** blanket forking; refactoring a fork for security reasons; vendoring dev-only tooling (build tools change too fast and their blast radius is contained to CI).

---

## 6. The DPF-native thesis: AI-owned dependency maintenance

Selective vendoring/forking normally fails on one thing: the **standing maintenance cost**. A frozen, diverged fork rots into *old, unpatched, diverged* code — the worst quadrant — because "watch upstream and backport" is the first task dropped when the team is busy. That decay is why the conservative answer to "should we fork?" is usually "no."

DPF's prime directive is Relentless Pursuit of Automation, and it has a Build Studio + an AI coworker fleet. So the real question is not *"should we fork?"* but *"can the fleet own the maintenance loop autonomously?"*:

```
watch upstream release/CVE feed
  → triage (does this fix/feature affect our vendored copy?)
  → backport / adapt (open PR against the vendored source)
  → verify (build + tests + Assurance Ledger scan)
  → route learning to the hive
```

If the fleet can run that loop, the economics invert: the maintenance burden that normally kills forks becomes an automated asset, and selective vendoring becomes viable at a scale that would otherwise need a distro team. This composes directly with the Assurance Ledger's **coworker improvement loops** (SBOM Management Agent, Security Auditor Agent) — the vendored-package watch feed is another input to those same agents.

**This is a thesis, not a proven capability.** It must be validated on 1–2 packages before it is trusted or scaled. The pilot (§8, Phase 2) is where it earns the right to expand.

---

## 7. Override hygiene: the prune discipline

The immediate, low-risk win. A CVE floor becomes dead weight the moment the direct/parent dependency naturally resolves to a patched version on its own. Detect and delete those.

### 7.1 Method (per floor)

1. Remove the single override.
2. Re-resolve the lockfile with **fresh registry metadata** (see the operational gotcha, §7.3).
3. If every resolved instance still satisfies the CVE's patched threshold → the override is **redundant → delete it**.
4. If any instance drops below the threshold → **load-bearing → keep it**.
5. Verify the pruned lockfile still passes Typecheck + Production Build + the Assurance Ledger scan.

### 7.2 Screening results (2026-07-21, batch pass)

A batch re-resolve with the pre-existing (non-PR-#3357) floors removed classified them as:

| Verdict | Floors |
|---------|--------|
| **Prunable** (tree caught up) | `@tootallnate/once` (gone from tree entirely), `@types/react`, `@xmldom/xmldom`, `dompurify`, `node-forge`, `esbuild`, `@babel/core`, `qs` |
| **Load-bearing** (keep) | `postcss`, `uuid`, `ip-address`, `lodash`, `lodash-es`, `ws` (scoped), `picomatch` (scoped) |

Caveat: this is a *batch* screen — removing all candidates at once can mask interactions. Each prune must be re-verified individually (§7.1) inside its BI before landing. `@types/react` is technically prunable but doubles as a React-types dedup, so removal is low-value and optional. `node-forge` is prunable *and* a Tier-1 vendoring candidate (crypto, high blast-radius) — prune the override only if we are not about to vendor it.

### 7.3 Operational gotcha (load-bearing for anyone doing this work)

Editing the `overrides:` block makes pnpm re-resolve the **whole** tree. On a developer box with a populated pnpm store, pnpm resolves that re-resolution **offline from the stale store** (`downloaded 0` in the progress line is the tell) and silently produces invalid downgrades (e.g. `@vitest/expect@4.1.9` against a `^4.1.10` range). The fix: re-resolve against a **fresh, empty `--config.storeDir` (and `--config.cacheDir`)** so pnpm must fetch fresh metadata. An empty cacheDir alone is *not* enough — pnpm falls back to the populated store. Validate stability by re-running plain `pnpm install --lockfile-only`: a correct lockfile is a ~250ms no-op. (Full detail in the PR #3357 session record.)

### 7.4 Standing guard

Pruning once is not enough — floors re-accumulate. Add a periodic (e.g. monthly, or Dependabot-triggered) **stale-override audit** that runs §7.1 across the whole block and files a BI listing newly-redundant floors. This keeps the control surface legible by construction. Each floor comment should already name its `Dependabot #NN` / GHSA id (PR #3357 established this convention) so the audit can machine-check "is this alert still open?".

---

## 8. Roadmap

Sequenced by leverage-per-effort. Each phase maps to backlog items under `EP-DEP-SOVEREIGNTY`.

### Phase 0 — Prune the long tail (now)
- Prune the 8 redundant floors (§7.2), each individually verified.
- Add the standing stale-override audit (§7.4).
- **Exit:** override block shrinks to load-bearing entries only; audit runs in CI/schedule.

### Phase 1 — Close the Tier-0 intake gaps (highest leverage)
- Private registry mirror/proxy (Verdaccio/Artifactory-class) as the resolution source of record.
- Version-adoption cooldown policy (generalises the BI-72E0A27B hand-rolled pins).
- Provenance/signature verification in the New Dependency Gate.
- **Blast radius (registry proxy).** Changing the resolution source of record touches every path that resolves dependencies: root `.npmrc`, CI resolution, the installers (`scripts/installer/*`), contributor onboarding, edge-node, and Build Studio sandboxes. It MUST wrap the deployment contracts (`2026-05-09-deployment-contracts.md`) and remain **optional / self-hostable** so fully-local and air-gapped installs still resolve without a hosted dependency (the fully-local-by-choice constraint). Ship behind a capability activation, default off, before it becomes the default resolution source.
- **Policy substrate.** Cooldown thresholds and provenance rules are `AssurancePolicy` rows once that model lands (§1.1); if Phase 1 must ship first, the enforcement is minimal + carries a `TechDebt` row to fold into `AssurancePolicy`, not a new policy table.
- **Exit:** the "poisoned update" vector is closed without forking anything.

### Phase 2 — Vendoring pilot (proves the thesis)
- Ratify the vendoring bar (§5) through the kernel.
- Vendor 1–2 candidates that clear the bar (e.g. `node-forge`).
- Stand up the AI-owned watch→triage→backport→verify loop (§6) against them, wired to the Assurance Ledger coworker improvement loops.
- **Exit:** a vendored package with a *demonstrated* autonomous maintenance cycle, or a recorded decision that the loop is not yet reliable enough to scale.

### Phase 3 — Scale or stop (decision gate)
- With Phase-2 evidence, decide via the kernel whether to expand vendoring, and to what set.
- Tier-2 (fork+refactor) remains gated on a *product* justification per candidate; never entered wholesale.

---

## 9. Non-goals

- Blanket-forking the dependency tree. Explicitly rejected (§4): it is a distro-maintenance org, and a frozen diverged fork is *more* exposed to known CVEs (you opt out of the ecosystem's patch distribution — the xz/event-stream class of attack was caught by the community watching *live* packages).
- Refactoring a fork for security reasons. The security benefit is fully banked at Tier-1 vendoring; refactoring only adds cost.
- Re-specifying SBOM/SCA/remediation — owned by `EP-ASSURANCE-LEDGER`.
- Removing the jest-30 block or the diagram-stack pins as "sprawl" — both are load-bearing workarounds with recorded rationale.

---

## 10. Open questions (kernel decisions)

1. **Registry proxy build-vs-buy.** Verdaccio (self-hostable, fits fully-local-by-choice) vs Artifactory (heavier, more features). Leans Verdaccio for sovereignty. **OPEN — kernel.**
2. **Cooldown window length.** 7 / 14 / 30 days trades zero-day protection against patch latency. Recommend starting at 14 and tuning from Dependabot lead-time data. **OPEN.**
3. **Vendoring bar thresholds** (§5) — "small", "stable", "high blast-radius" need concrete cutoffs before the pilot. **OPEN — ratify in Phase 2.**
4. **Does the AI-maintenance loop clear the bar to scale?** Cannot be answered until the Phase-2 pilot runs. **OPEN by construction.**

---

## 11. Acceptance criteria

This spec is accepted when:

1. It is linked from a live epic (`EP-DEP-SOVEREIGNTY`) after an MCP overlap sweep.
2. The prune long-tail (§7.2) is filed as verifiable per-floor backlog work.
3. The Tier-0 intake gaps (§8 Phase 1) are filed and prioritised above any vendoring work.
4. The vendoring bar (§5) is captured as a kernel decision, not a chat consensus.
5. The AI-owned maintenance loop (§6) is scoped as a *pilot with an exit decision*, not an assumed capability.
6. Blanket-forking is recorded as a rejected alternative with rationale (§9).
7. The spec defers all detection/SBOM/SCA concerns to `EP-ASSURANCE-LEDGER` rather than duplicating them.
