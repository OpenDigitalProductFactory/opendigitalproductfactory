---
status: draft
---

# Reviewer source-search recovery

Backlog: BI-CAP-3E6EC8AE. Workroom: WC-99368F81.

## Problem and evidence

At served commit `18a6520aba5aa2005d2d4d70501b69f2bc8b4c7a`, searching
`terminalWriterDispatchContract` in the exact source path
`apps/web/lib/routing/execution-adapter-types.ts` fails with
`Git history is not available.` The handler exits before searching when
`isGitAvailable` is false. Reading immutable source through
`read_source_at_version` succeeds through the existing provider fallback.
PR #5210 repaired that reader; this work must preserve it.

This is a bounded extension of the existing
[immutable source traversal design](2026-08-25-immutable-source-review-traversal-design.md),
not a new source store, search service, receipt type, or reviewer engine.

## Options and chosen approach

Restoring a runtime Git checkout would make review depend on install-local
history and checkout freshness. A repository-wide provider crawl would introduce
unbounded request fan-out. Instead, extend the existing immutable provider reader
for exact-path searches at a full commit SHA. Retain Git-backed search for its
existing broader pathspec and pattern support.

The provider path must use `readRepositoryProviderBlob`, canonical repository
configuration, existing credentials and transport, the 1 MiB content ceiling,
UTF-8 validation, and optional blob verification. Add repository identity to the
search input and output as needed, matching the immutable reader. No new token,
mount, database table, migration, or install setting is required.

Provider search supports literal text only. Make this distinction explicit in
the tool schema rather than silently interpreting Git regular expressions as
JavaScript regular expressions. Preserve legacy Git pattern behavior when the
new literal-search option is absent. Unsupported patterns, wildcard paths, or
mutable refs without local Git must return a clear capability error, never an
empty successful search.

Search lines in order, return one result per matching line, and apply the
existing bounded offset/page-size contract with lookahead. Every page returns
the same commit, path, and provider blob identity. Reject invalid identity,
inaccessible content, invalid UTF-8, oversized content, and blob mismatch.

## Research and benchmarking

- [Git grep](https://git-scm.com/docs/git-grep) distinguishes fixed strings
  from regular expressions. Keep that distinction explicit; do not emulate
  its full pattern language in a second engine.
- [GitHub repository contents](https://docs.github.com/en/rest/repos/contents)
  accepts a commit ref. Reuse DPF's existing authenticated reader rather than
  GitHub's default-branch code-search index for immutable evidence.
- The parent design's MCP pagination and LangGraph comparison still apply;
  no additional runtime or external tool is adopted.

## Architecture and scope

The owning code remains `apps/web/lib/mcp/packs/version-history-pack.ts`,
`apps/web/lib/build/git-utils.ts`, and
`apps/web/lib/backlog/initiative-readiness/repository-artifact.ts`.
The current source-search tool's authority and audit path remain unchanged.
Provider work is bounded to one artifact per call, with the existing transport
retry ceiling. Repository-wide provider search is outside this BI; no epic is
claimed to own that expansion without a live backlog check.

Project-file visibility is separately tracked as BI-CAP-EB412C95. Its observed
file-not-found result is not yet proof of the same cause. No repair to that
tool, model discovery, approval handling, or terminal-writer policy is included.

## Acceptance and delivery

1. Search a known exact-path artifact at an immutable commit without local Git;
   return a real match and verified source identity.
2. Page multiple matching lines without duplicates, gaps, or identity drift.
3. Distinguish unsupported queries and read failures from a genuine zero-match
   result. Test absent and mismatching supplied blob identities.
4. Preserve legacy Git-backed behavior with regression tests and test the
   explicit literal option on both paths.
5. Run affected Vitest suites and the required production build, publish with
   DCO through a PR, then verify canonical live MCP searching and reviewer
   evidence traversal before marking the BI complete.

Rollback removes the provider-search branch and its additive input; no stored
data changes. The tool description is the contributor-facing documentation.

## Execution state

Design claim allowed by IRD-512A2A2DE45A. Implementation remains gated on a
research receipt. An earlier unbound coworker handoff completed with zero tool
executions and produced no receipt; it is not acceptance evidence. Publish this
artifact, synchronize the workroom head, and use the server-issued review
packet. Code, tests, build, PR, deployment, and live acceptance remain unrun.
