---
title: Pin CI runtimes to the exact qualified version
pageKind: principle
status: published
abstract: A floating runtime selector in CI, such as node-version 24, silently changes the toolchain under every open change when the vendor ships a patch. If any artifact pins its engines or was qualified against an exact version, every PR fails at once for reasons unrelated to its diff. Pin CI to the same exact version the repository qualifies against, and move it forward deliberately.
principleTier: core
principleDirection: Resolve CI runtimes from the repository's single qualified version file, never a floating major, and advance it in its own change with qualification evidence.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleDimensionVector: {"reversibility": 0.7, "long_term_maintainability": 0.7, "speed_to_value": 0.6, "blast_radius": -0.7}
professionCompetencyLevel: practitioner
sources:
  - opengitops/principles
  - dpf/agents-rulebook
---

## Rule

CI must run the exact runtime version the repository declares and qualifies against, read from one source of truth such as `.node-version`. Never use a floating selector such as `node-version: 24` or `latest`. A runtime upgrade is its own change, with qualification evidence and a canary, not a side effect of a hosted-runner image update.

## Why

GitOps holds that desired state is declared and versioned. A floating selector is undeclared state that a vendor changes for you. When the runner moves a patch release, every open PR runs on a toolchain nobody approved. Any artifact with an engines pin, a native module or a recorded qualification fails together. The failures look like product defects in unrelated PRs, cost each author a diagnosis, and block merges until someone pins the version.

## Observed failure (DPF, 2026-11-03)

CI's `node-version: 24` moved from v24.22.1 to v24.22.2. A vendored workroom package qualified for `24.16.0 || 24.22.0 || 24.22.1` refused to install (EBADENGINE). "Unit Tests (packages)", "Unit Tests" and "Merge Readiness" failed on every PR tested afterwards, independent of its diff. The fix pins CI to the qualified `.node-version`.

## How To Apply

1. **Point every `setup-*` action at the repository's version file,** not a literal major.
2. **Keep runtime, lockfile and vendored qualification records in one change** when moving the version forward. Run a canary job on the new version before switching.
3. **When many unrelated PRs fail the same check at once,** compare the toolchain versions in their logs before diagnosing code.

## See Also

- [[professions/software-engineer/mandatory-gate-readiness]]
- [[professions/devops-platform/upgrade-the-fleet-forward-only]]
