# PR origin tracing + merged-PR build identity

| | |
| --- | --- |
| Date | 2026-07-29 |
| Backlog items | BI-3A34D7A9 (PR origin tracing) · BI-5B1FDA09 (self-upgrade merged-PR identity) |
| Status | Implemented |
| Related | `docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md` (§1.1, §2.1 — "still SHA-oriented") · `docs/superpowers/specs/2026-07-06-self-upgrade-release-batching-design.md` (§ pending tally: one commit ≈ one merged PR) · `docs/operations/local-ci-sandbox-slots.md` · `docs/testing/pre-pr-gate.md` |

Both items answer the same founder question from two directions: **the pull
request number is the identifier a human actually works with, and the platform
was using it for nothing.** Builds were labelled by SHA pairs that never
matched, and PRs were attributed to whichever client the gate happened to
default to.

---

## Design grounding

**Source of truth.** The governed-upgrade-lifecycle spec already ratified that
"version identity is baked, not committed" and recorded the remaining gap
plainly: target resolution and the operator surface are **"still SHA-oriented"**
(§2.1, §1.1 item 5). The release-batching spec already treats **one upstream
commit as one merged PR** ("committer-epoch line per pending commit (≈ merged
PR, since the queue squashes)"). So PR-as-unit-of-change is existing, ratified
doctrine — this work applies it to the operator surface rather than inventing a
new identity scheme.

**Decision.** Extending existing specs; no new contract. No new Prisma column,
no new lease field, no new dashboard. Every fact these features surface was
already being written; it was either unused (`prNumber` in the impact analyzer)
or written untruthfully (`ownerProvider` defaulted to a constant).

---

## Part 1 — BI-5B1FDA09: label builds by their last merged PR

### The problem

`/ops/self-upgrade` showed three identifiers, none of which an operator can act
on:

```
Platform version: v204ff1cf8
Deployed:         204ff1cf8ffbf03eec41beffcc239399635bd60e
Target:           59f8826e448bdb85580633cdc2ad21fb05bfafd1
```

The deployed id is a **local merge commit**; the target is an **upstream
commit**. They can never be equal, so the UI carried an apology: *"the running
build already contains the target; the Deployed id is the merge build that
absorbed it, so the two SHAs differ by design."* DPF does not tag releases, so
there was no semantic version to fall back on.

### What shipped

`apps/web/lib/self-upgrade/merge-point.ts` resolves a SHA to the merged PR its
commit subject names, reusing the Conventional Commit parser the impact
analyzer already depends on (`impact/conventional.ts`) rather than a second
regex. One `git log -1 --format=%s <sha>` per endpoint.

- **Running** resolves from the **upstream lineage marker**, not `deployedSha`
  — a merge commit's subject carries no `(#N)`. `resolveCurrentLineageSha` is
  now exported from `impact/index.ts` so the banner compares the same "running"
  end the analyzer does.
- **Behind by N** comes from the commit walk that already exists
  (`releaseBatch.pendingCount`), never from PR-number arithmetic.
- SHAs, build stamp, and image source move behind a **Build details**
  disclosure. The merge-SHA explainer is deleted outright: with PR identity the
  divergence is no longer visible, so there is nothing to explain.
- `owner-summary.ts` (the plain-language card) prefers the PR label too.

### Load-bearing constraint

**PR numbers are labels, not ordinals.** Merge order is a race — #3750 can land
before #3748 — so `merge-point.ts` exports equality (`mergePointsMatch`) and
deliberately **no comparator**. A test asserts no `compareMergePoints` /
`isNewerMergePoint` export exists, so a future contributor cannot casually add
ordering that would be wrong.

### Degradation

A subject with no trailing `(#N)` (direct push, non-squash merge), a shallow
clone, an unfetched commit, or a missing host mount all yield `null`, and the
short SHA carries the identity as before. `resolveMergePoint` never throws.

---

## Part 2 — BI-3A34D7A9: honest origin, traceable by PR number

### The problem

Three defects, all in the writers rather than the schema:

1. `scripts/gate-worktree.mjs:118` defaulted `ownerProvider` to `"codex"` and
   nothing ever set it. Live evidence: branch
   `claude/review-decision-button-issue-a95327` recorded as `codex`; 670 codex
   leases vs 23 claude across all history.
2. Session id defaulted to `gate-<pid>` — a per-invocation throwaway that
   *looks* like a real id. Result: **610 distinct "sessions" across 178
   branches**, no thread rollup, sub-threads invisible.
3. **Zero of 434** evidence records in three days carried a `workCapsuleId`.
   The intended fix was referenced in code as "Phase 2 / BI-5FDBF786" — a BI
   that was never filed.

### What shipped

`scripts/lib/agent-identity.mjs` resolves provider + thread from the calling
client's own environment. Verified markers for Claude Code:
`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_HOST_SESSION_ID` (the
parent thread — this is what makes sub-threads roll up),
`CLAUDE_CODE_CHILD_SESSION`.

Two rules the module enforces:

- **Never fabricate a provider.** The provider vocabulary is a closed enum with
  no "unknown" member, so an unresolved provider is `null` and the gate stops
  with a message naming the flag to pass. A record that admits ignorance is
  useful; one that says "codex" when it was Claude is worse than nothing,
  because it reads as authoritative.
- **Session identity is the thread, not the process.** When the thread cannot
  be resolved the fallback is `unattributed-<pid>`, not `gate-<pid>`, so every
  such record is self-labelling and the fleet's real attribution coverage is
  measurable instead of assumed.

The attribution block (`attribution`, `providerSource`, `sessionSource`,
`rootSessionId`, `isChildThread`) rides in the evidence `details` JSON — free-form
provenance, so no migration and no change to the lease contract.

### Tracing without publishing anything

`pnpm pr:origin <number>` → `gh` resolves the PR to its head plus every commit
SHA → the read-only `lookup_change_origin` MCP tool matches those SHAs against
the install's own gate records → prints client, thread, parent thread.

**Matching is by SHA, not branch**, because branch names are reused across
threads (`fix/local-ci-dead-waiter-reconciliation`: 3 sessions;
`feat/product-management-playbooks`: 4) and deleted on merge, while commits are
permanent. Branch is a fallback for work that never reached the gate.

`/platform/development/change-lanes` gains the client and PR-number columns; the
lane projection already joined PRs, leases, capsules and worktrees by branch.

### PR bodies get quieter, not louder

Verified that `pr-health.mjs` needs a `Local-CI-Evidence:` /
`Local-CI-Override:` trailer **only as a fallback** when no push-time gate
record matches the head SHA. A normally-gated PR satisfies the gate silently,
so the lease id / evidence cuid / candidate SHA / accepted base that convention
had been printing into public PR bodies are **not contract** and come out. One
non-identifying verification line replaces them.

This also scales correctly to outside contributors: their PRs have no local
lease, `lookup_change_origin` returns no origin, and that absence is the correct
signal rather than a defaulted guess.

### Fixed in passing

`record_local_integration_result` advertised `grok` in its input schema but
omitted it from the handler's validation list, and `antigravity` was in neither
— so a client reporting itself honestly could be rejected as
`invalid_provider`. All three sites now derive from one
`LOCAL_INTEGRATION_PROVIDERS` constant.

---

## Follow-ups (not in this change)

1. **Ratchet the identity requirement.** Once every client passes identity and
   `unattributed-` records stop appearing, make an unresolved *thread* a hard
   failure too (provider already is). Query to check coverage:
   `details->'evidence'->'origin'->>'attribution'` on
   `ExternalEvidenceRecord`.
2. **File the missing capsule auto-claim** (the never-filed "BI-5FDBF786") so
   PR → capsule → BI is one hop rather than a SHA join.
3. **Backfill is not attempted.** Existing `gate-<pid>` records cannot be
   re-attributed after the fact; `isUnattributedSession` recognises the legacy
   shape so they read as unknown rather than as real threads.
