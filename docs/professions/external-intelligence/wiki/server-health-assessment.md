---
title: Package / MCP-server health assessment
pageKind: heuristic
status: published
abstract: Assess an external server or package by adoption signals, trust signals, maintenance freshness, semantic-version change risk, and provenance — cross-checked against vulnerability intelligence. Health numbers are only trustworthy once provenance is traced.
professionCompetencyLevel: practitioner
sources:
  - smithery/registry-docs
  - owasp/component-analysis
  - npm/semver
---

## Heuristic

Score a candidate external server or package across five signals before trusting it:

1. **Adoption** — Smithery exposes the "total number of times this server has been connected to"; usage is a (weak) health signal.
2. **Trust** — the verified-status badge and whether the registry operator maintains the server.
3. **Maintenance freshness** — keeping components current "reduces remediation time during security incidents"; stale or end-of-life components fail the check.
4. **Change risk via SemVer** — read the version: major = "changes that break backward compatibility," minor = backward-compatible features, patch = bug fixes.
5. **Provenance** — owner, GitHub repo, and registration timestamp. **Trace provenance before trusting health numbers** — popularity on an unknown-origin package is not safety.

Cross-check **vulnerability intelligence** from multiple sources beyond the National Vulnerability Database (defect trackers, release notes).

## How DPF Coworkers Use It

- Run this assessment on every candidate from [[professions/external-intelligence/external-tool-catalog-reconnaissance]].
- Health is necessary but not sufficient — it feeds, but does not replace, [[professions/external-intelligence/vet-before-adopting-external-tools]].

## See Also

- [[professions/external-intelligence/external-tool-catalog-reconnaissance]]
- [[professions/external-intelligence/mcp-what-it-is]]
