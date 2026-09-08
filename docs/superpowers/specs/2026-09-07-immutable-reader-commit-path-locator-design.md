---
status: draft
---

# Immutable reader serves a commit + path locator

**Backlog item:** `BI-331F527B`  
**Workroom:** `WC-7EBCC298`  
**Readiness profile:** `fix`  
**Follow-up:** `BI-907D6878` (loop blindness to natively executed MCP calls)

## Problem and evidence

Initiative-readiness reviewer coworkers dispatched through the Claude CLI in
native-MCP mode call `read_source_at_version` themselves against `/api/mcp/v1`.
The bound input schema produced by `narrowInitiativeReviewTools` — which pins
`expectedBlobId` to the packet's blob — is applied only to the loop-side tool
list and never reaches the CLI's native `tools/list`. The packet objective named
the commit and path but not the blob. So every reviewer called the reader with
`repositoryFullName`, `version` (commit sha) and `path`, and without
`expectedBlobId`.

`readSourceAtVersionHandler` treated that locator as incomplete: its provider
fallback required a blob id, so when the install's read-only git volume lacked
the branch commit the reader answered "Git history is not available in this
deployment". Each reviewer repeated that sentence as its blocker and ended
`input-required / missing-terminal-writer`. Four gates on `BI-8CF5A51D` failed
this way on 2026-09-07 (`ToolExecution` rows with
`executionMode=internal-mcp-session`, `success=false`, threads
`cmtqlqxbl0y4701riqztfgfu1`, `cmtqlqspe0y3m01ripvp3vny2`,
`cmtqlq08n0y2b01ri2a3v37mz`).

Reproduction on the named ref: `read_source_at_version(path, version=b74573ad…,
repositoryFullName)` → "Git not available."; the same call plus
`expectedBlobId=5a80cf56…` → success through the provider.

## Research

A commit sha + path is already an immutable locator: the provider's contents
API at `?ref=<sha>` returns the blob and its sha. The blob id adds verification
(fail closed on mismatch), not identity. Requiring it as a precondition only
excluded the caller that cannot know it.

Compared implementations: GitHub's contents API and `git show <sha>:<path>`
both resolve by commit + path and report the blob; `git cat-file` by blob id is
the verification form. DPF keeps both: serve by commit + path, verify by blob
when supplied.

## Decision

1. `readRepositoryProviderBlob` takes an optional `expectedBlobId`; success
   returns the provider's `blobId`; a supplied mismatching id still fails closed
   with `IMMUTABLE_BLOB_MISMATCH`.
2. `read_source_at_version` engages the provider fallback on
   `repositoryFullName` + 40-hex commit; the page's `blobId` is the provider's
   sha. When the locator is incomplete the message names the missing inputs
   rather than asserting git is unavailable.
3. The reviewer packet objective states `repositoryFullName`, `version` and
   `expectedBlobId`, so a native-MCP reviewer can pass them and the bound
   schema's guarantee is carried in prose where the schema cannot travel.

Out of scope, filed as `BI-907D6878`: reconciling natively executed MCP calls
into the loop's executed-tool records, and serving the bound schema on the
internal session's `tools/list`.

## Acceptance

- AC-1: reader with repository + commit + path, no blob id → page served via
  provider, `blobId` = provider sha.
- AC-2: blob id supplied and mismatched → `immutable_blob_mismatch`.
- AC-3: repository missing or version not a commit → message names the missing
  input and never says git is unavailable.
- AC-4: packet objective contains the `providerBlobId`.
- AC-5: affected vitest suites pass; local-CI gate (typecheck, tests, build)
  passes for the branch head.

## Verification

Red-to-green: seven assertions failed before the change and pass after
(`version-history-pack.test.ts`, `repository-artifact.test.ts`,
`initiative-readiness-tool-grants.test.ts`). Local-CI gate evidence
`cmtqnwp6k09wt01rixk5haqz0` on `3fd82d15`.
