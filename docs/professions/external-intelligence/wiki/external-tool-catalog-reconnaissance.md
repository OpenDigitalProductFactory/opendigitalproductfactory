---
title: External agent/tool catalog reconnaissance
pageKind: summary
status: published
abstract: Scout the external capability landscape through registries — the Smithery MCP-server registry and the public npm registry — capturing machine-readable provenance per candidate. Reconnaissance produces candidates, never adoptions.
professionCompetencyLevel: practitioner
sources:
  - smithery/registry-docs
  - npm/registry-docs
---

## What This Covers

The external-intelligence coworker reconnoiters the capability landscape through registries:

- The **Smithery registry** is "a list of MCP servers that are available to use," searchable by name, description, or tags, with "full-text and semantic search" and filters for deployment status, verification, and ownership.
- The **public npm registry** is "a database of JavaScript packages, each comprised of software and metadata" — the second primary catalog to reconnoiter.

## How To Reconnoiter

1. **Search by capability need**, using full-text and semantic search.
2. **Distinguish server type** — remote (URL-accessed) vs local (stdio); deployment shape changes the adoption and risk profile.
3. **Capture provenance per candidate** — namespace, owner, GitHub repo, and the registration timestamp ("ISO 8601 timestamp of when the server was registered").
4. **Produce candidates, not adoptions.** Recon output is a shortlist; every candidate goes through vetting before any suggestion.

## How DPF Coworkers Use It

- Treat recon as the funnel's top: surface candidates, then hand each to [[professions/external-intelligence/vet-before-adopting-external-tools]].
- Assess each candidate's health — see [[professions/external-intelligence/server-health-assessment]].
- A confirmed gap becomes a governed suggestion — see [[professions/external-intelligence/capability-gap-to-governed-suggestion]].

## See Also

- [[professions/external-intelligence/mcp-what-it-is]]
- [[professions/external-intelligence/server-health-assessment]]
- [[professions/external-intelligence/capability-gap-to-governed-suggestion]]
