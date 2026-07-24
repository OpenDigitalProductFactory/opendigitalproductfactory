---
title: Tool Evaluation Pipeline Before Adoption
pageKind: principle
status: published
abstract: External MCP servers, npm packages, and APIs pass the six-agent Tool Evaluation Pipeline before adoption. Approved tools are version-pinned.
principleTier: core
principleDirection: Run external dependencies through the evaluation pipeline; pin the approved version; schedule re-evaluation.
principleDimensionVector: {"governance_compliance": 0.8, "public_safety": 0.7, "blast_radius": -0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Documents DPF's external-dependency vetting posture — adopters depend on it for security and supply-chain auditability.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

External MCP servers, npm packages, and APIs must pass the Tool Evaluation Pipeline (EP-GOVERN-002) before adoption: six agents covering security, architecture, compliance, and integration sign off in sequence. Approved tools land in `packages/db/data/approved_tools_registry.json` with a pinned version and a re-evaluation schedule.

## Why

Adding a dependency expands the platform's attack surface, license-compliance footprint, and integration debt at the same time. Each of those costs is bounded only if the dependency has been vetted upfront and the version is pinned (so the vetting result remains valid until the next re-evaluation). Skipping the pipeline is how silent supply-chain incidents happen: a tool gets pulled in for a quick task, never re-evaluated, and three months later it ships a compromised release that propagates through DPF's installs before anyone notices.

## Applies To

In-platform coworkers proposing tool additions, external coding agents writing dependency-adding code, and humans approving merge requests. Symmetric. Applies to MCP servers, npm packages, container images, APIs, and any external integration. Does NOT apply to first-party DPF packages or workspace-local code — those have a different evidence chain.

## How To Apply

Before adding a dependency, run `/project:tool-evaluation` (slash command for the pipeline) or open the eval flow at the platform UI. The six agents (security, architecture, compliance, integration, and two cross-checks) produce a signed evidence bundle; approval pins the version in the approved-tools registry with a re-eval schedule. When an existing dependency needs an update, re-run the pipeline against the new version — the previous approval covers the previous version only.

## Decision Dimensions

- `governance_compliance: 0.8` — the pipeline is the platform's primary dependency-governance gate.
- `public_safety: 0.7` — vetted dependencies are safer for adopters to inherit through a fresh install.
- `blast_radius: -0.5` — version-pinning + scheduled re-eval bounds the propagation window for a compromised upstream.

## Examples

- **Positive:** A new wiki feature needs YAML frontmatter parsing. The dependency candidate is run through the pipeline; the security agent flags one CVE in the candidate but clears the alternative; the alternative is pinned in the registry; the feature ships against the vetted version.
- **Counterexample:** The same need is solved by `npm install yaml-parser-v2` mid-PR without running the pipeline. Three weeks later the maintainer ships a compromised release; DPF's installs pick it up on the next deploy because nothing was pinned; the incident retro asks "how did this get in?" and the answer is "we skipped the pipeline."

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
