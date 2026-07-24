---
title: External and internal work share gates; only entry doors differ
pageKind: principle
status: draft
abstract: A PR clears the same phase gates regardless of who wrote it — maintainer, autonomous coworker, external contributor, or bot. Provenance is recorded for credit and learning, never for shortcutting approval.
principleTier: core
principleDirection: Prefer one gate set with multiple entry doors over per-provenance approval paths.
principleDimensionVector: {"governance_compliance": 0.9, "long_term_maintainability": 0.6, "blast_radius": -0.7, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - build-studio
principlePublic: true
principlePublicRationale: This is a contributor guarantee. External contributors should know that their work will be judged by the same criteria the maintainers hold themselves to — no special path, no extra friction. Operators should know that no path bypasses governance.
sources: []
---

## Rule

The phase gates that approve a change (typecheck, tests, security audits, CodeQL diff, design review, kernel-principle alignment, etc.) are the same gates regardless of who authored the change. Internal Build Studio work, autonomous coworker output, external fork PRs, and maintainer hotfixes enter through different doors but pass the same gates. Provenance is metadata; approval is evidence.

## Why

If a "trusted contributor" path exists that skips gates, the trusted contributor becomes the single point of compromise. A maintainer account takeover, a leaked SSH key, a careless autonomous agent — any of these can ship code that the gate set would have caught.

The DPF substrate already operationalizes this in spirit through the operator-ratified stance that "governance approves evidence, not provenance" — Build Studio phase gates judge evidence quality regardless of who produced it. This principle is the operational corollary: what that stance requires of the entry doors.

A second-order benefit: external contributors get a predictable, fair experience. There's no "we'll be more careful with your PR because you're new" friction tax; the gate set is the contract. The bot reviewer for external PRs (under BI-860603DA) applies the same checklist a maintainer would apply to their own work.

A third-order benefit: maintainers earn the same scrutiny they impose. A maintainer cannot bypass a check that an external contributor must clear. This is what keeps the gates honest over time — they have to be actually useful, not ceremonial.

## Applies To

Every change-approval flow:

- **Code changes** — typecheck, lint, unit tests, integration tests, production build, security inflow gate, audit-* invariants, CodeQL.
- **Architectural changes** — design review, kernel-principle alignment, spec compliance.
- **Governance changes** — CODEOWNERS, branch protection rules, kernel principles themselves, security baselines.

The principle does NOT mean every PR runs every gate — paths can be filtered (`release-gates.yml` only runs on installer changes), and conditional checks can skip when irrelevant. But the *gate set per file class* is uniform across provenance.

The principle ALSO does NOT mean the bar is identical regardless of risk. Trust-boundary paths (CODEOWNERS-listed files: workflows, security substrate, kernel principles, decision substrate) require *more* review than ordinary application code. Everyone — maintainer, coworker, external contributor — clears that higher bar on those paths.

## How To Apply

1. **Define gates at the file-class level**, not the contributor level. A workflow change runs the actions-injection audit no matter who wrote it.
2. **Never offer "skip CI on owner approval"** as a shortcut. If a check is slow or flaky, fix the check. If a check is bypassable, it's not a gate.
3. **Apply trust-boundary carve-outs uniformly.** Files listed in [`.github/CODEOWNERS`](../../../../.github/CODEOWNERS) require owner review regardless of provenance — including when the maintainer themselves opens the PR.
4. **Bot review counts.** The bot reviewer described in BI-860603DA runs the same pr-review-toolkit agents on external PRs that BS uses on internal work. The bot's pass is evidence; the human review is the second signal, not a replacement.
5. **Record provenance for learning, not for routing.** Track who authored what so the hive can attribute contributions and so kernel updates can credit sources. Never route approval decisions through that metadata.

## Decision Dimensions

- `governance_compliance: 0.9` — the audit trail is uniform. SOC 2, ISO 27001, and similar frameworks ask "show me the controls that gate every change." A single answer is defensible; multiple answers per contributor class are not.
- `long_term_maintainability: 0.6` — one gate set is easier to evolve than N parallel sets. When the gate set tightens (e.g. adding the security inflow gate), it tightens everywhere at once.
- `blast_radius: -0.7` — strongly reduces blast radius from any single point of trust compromise. No maintainer account, no autonomous agent, no contractor relationship is a single point of failure if every PR clears the gates.
- `speed_to_value: -0.3` — slower than a trusted-fast-path for the maintainer who knows the codebase. The cost is paid in marginal seconds per PR; the protection covers every contributor for the life of the project.

## Examples

- **Positive:** PR [#936](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/936) (security inflow gate) was opened by an autonomous agent. It cleared the same DCO check, typecheck, CodeQL analysis on four languages, audit invariants, and production build that an external contributor PR would clear. The agent's provenance was logged; it did not exempt the PR from any gate.
- **Counterexample:** Allowing the autonomous agent to mark a security finding "dismissed - false positive" without the dismissal-justification field that an external contributor would have to fill in. The agent's trust earns it speed of action; it does not earn it a skipped justification.

## Related principles

- [`structural-verification-is-not-functional`](structural-verification-is-not-functional.md) — gates check structure (compile, lint, test); the operator-level functional check is still required after gates pass.
- [`destructive-actions-require-explicit-go`](destructive-actions-require-explicit-go.md) — gates don't replace explicit-go for the small class of actions that require it. The two layers compose.

Candidate for kernel promotion: "governance approves evidence, not provenance" — the operator-ratified stance this principle operationalizes is not yet a published kernel page. When it ships, link it here.

## Sources

Rendered from the `sources:` frontmatter array via `WikiSourceCitations`.
