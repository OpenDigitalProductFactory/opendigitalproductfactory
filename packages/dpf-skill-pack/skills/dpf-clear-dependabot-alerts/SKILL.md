---
name: dpf-clear-dependabot-alerts
description: "Use when clearing Dependabot or security-advisory alerts on the DPF repo, or bumping a vulnerable dependency."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash Read Edit Grep

# DPF coworker fields (Surface B — in-portal seed loader)
category: ops
assignTo: ["build-specialist", "platform-engineer", "ops-coordinator"]
capability: null
taskType: workflow
triggerPattern: "dependabot|security alert|vulnerability alert|clear .* (alert|CVE|advisory)|bump .* (vulnerable|CVE)|dependency (vuln|CVE|advisory)|security tab"
userInvocable: true
agentInvocable: false
allowedTools: ["Bash", "Read", "Edit", "Grep"]
composesFrom: ["dpf-verify-substrate-first"]
contextRequirements: ["gh CLI authenticated", "pnpm available", "registry reachable"]
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/all-changes-land-via-pr
  - kernel/principles/single-source-of-truth
  - kernel/principles/never-fabricate
  - kernel/principles/structural-verification-is-not-functional
---

# Clear Dependabot Alerts (DPF pattern)

Clearing Dependabot alerts on this repo is recurring work with two sharp edges that cost a full session the first time. This skill encodes both so every surface (Claude Code, Codex, Grok, Build Studio) does it in one pass.

The two edges:
1. **These are almost all _transitive_ vulns.** The fix is to floor the vulnerable package in the `pnpm-workspace.yaml` `overrides:` block — **not** to bump a `package.json` manifest. Reverting/removing overrides re-introduces the CVEs; the overrides ARE the fix.
2. **Editing `overrides:` re-resolves the WHOLE tree**, and a naive local `pnpm install` resolves that offline from the stale store (`downloaded 0` is the tell), silently downgrading ~40 unrelated packages to invalid versions. The fix is `scripts/regen-lockfile.mjs`, which forces fresh metadata via a fresh empty store.

## When to use

- A batch of open Dependabot alerts on `OpenDigitalProductFactory/opendigitalproductfactory` to clear.
- "Bump the vulnerable X" / "resolve the security advisory for X".
- A security-tab sweep before a release.

## When NOT to use

- A **direct** dependency you genuinely want to upgrade across a major (that's a normal dep bump + its own compat check, not an override floor).
- Non-npm advisories (Docker base images, GitHub Actions) — different remediation.
- Designing the dependency posture / vendoring strategy — that's `EP-DEP-SOVEREIGNTY` (`docs/superpowers/specs/2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md`), not this per-alert runbook.

## Steps

1. **Enumerate the alerts.** `gh api "repos/OpenDigitalProductFactory/opendigitalproductfactory/dependabot/alerts?state=open&per_page=100" --jq '.[] | {number, sev: .security_advisory.severity, ghsa: .security_advisory.ghsa_id, pkg: .dependency.package.name, vulnerable: .security_vulnerability.vulnerable_version_range, patched: .security_vulnerability.first_patched_version.identifier}'`. Group by package; multiple alerts often collapse to one floor.

2. **Classify transitive vs direct** for each package (`grep -rn '"<pkg>"' --include=package.json . | grep -v node_modules`). Transitive → override floor. Direct → bump the manifest to the patched range (the override still helps if other transitives pull an older copy — e.g. `sharp` is direct in `apps/web` yet Next.js ships a bundled optional `sharp`, so a global override is still needed).

3. **Add / raise the override** in `pnpm-workspace.yaml`. Use a range selector for scoped floors (`'pkg@<X': '^X'`). **Every security floor MUST carry a comment** naming the `GHSA-…` and `Dependabot #NN` — the Override Provenance Guard (`scripts/check-override-comments.mjs`) enforces this and the stale-override audit relies on it. Match the existing comment style in the file.

4. **Regenerate the lockfile the right way.** `node scripts/regen-lockfile.mjs --expect <comma,list,of,changed,packages>`. It resolves against a fresh empty store (fresh metadata), reports the changed set, checks it against `--expect`, and proves a second resolve is a stable no-op. **Never** just run `pnpm install` — it will corrupt the lockfile with offline-stale downgrades.

5. **Verify the fix functionally.** Confirm every vulnerable version is gone and only patched versions resolve: `grep -oE '<pkg>@[0-9.]+' pnpm-lock.yaml | sort -u`. Confirm the diff is scoped to the intended packages + their direct fallout (dropped old platform binaries, etc.) with no unrelated drift.

6. **Ship via `dpf-pr-with-dco`.** DCO-sign every commit (`-s`), reference the GHSA/Dependabot numbers in the body, and batch the bumps that revert together rather than opening one PR per advisory. Let CI (including the OSV scan, SBOM Divergence Guard, and Override Provenance Guard) confirm.

## Guardrails

- **Never fabricate a GHSA/CVE id.** If you can't confirm the advisory id, say so and grandfather the floor in the guard's list rather than inventing a tag.
- **Structural pass is not verification.** Grep the lockfile for the vulnerable versions being gone — don't assume the override worked.
- **Scoped diff only.** If `regen-lockfile.mjs` reports DRIFT (packages outside `--expect`), stop — your metadata was stale or the override cascaded; do not commit a drifted lockfile.
- **`@hono/node-server`-style major bumps:** when a floor crosses a major, check the consumers' declared ranges and the actual API used (see the PR #3357 write-up); flag the residual risk in the PR.

## See also

- Posture / vendoring strategy: `docs/superpowers/specs/2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md` (`EP-DEP-SOVEREIGNTY`).
- Detection side (SBOM/SCA): `docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md` (`EP-ASSURANCE-LEDGER`).
- The regen gotcha in full: `scripts/regen-lockfile.mjs` header + `docs/superpowers/specs/2026-07-21-agent-process-efficiency-hardening-design.md`.
- Ship step: `dpf-pr-with-dco`.
