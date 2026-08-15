# Plan — Catch private-identity leaks at commit time, not just the merge gate (BI-C9E5E7D9)

**BI:** BI-C9E5E7D9 · **Type:** tool · **Priority:** P3 · **Triage:** build · **Size:** small

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Problem

`check-no-private-identity` (required merge check inside Policy Guards (source)) blocks real operator/customer/person identity from the OSS repo — but only at **CI/merge time**. A dogfood/operator spec naturally names the real operator, goes fully green on functional checks, then sits BLOCKED solely on the identity leak, forcing a late scrub commit + full CI re-run. Observed this session: the WWWD-embedding plan doc tripped it at pregate after a green local run. The guard catches the leak *last*; it should catch it *first*.

## Approach (BI recommendation #1 + #2)

1. **Pre-commit staged tripwire** — add a `--staged` mode to `scripts/check-no-private-identity.mjs` that scans ONLY the staged snapshot of this commit's files and diffs against the SAME baseline, then wire it into `.githooks/pre-commit` as a new guard (staged-only → sub-second). Same ratchet semantics: legitimate baselined occurrences never block.
2. **Placeholder convention** — document the approved generic placeholder set (`operator`, `operator/owner`, `customer 0`, `this operator install`, `the publishing entity`) in `docs/operations/oss-repo-identity-hygiene.md` so authors write the placeholder from the first draft.

The required CI gate is unchanged — this is an earlier tripwire, not a replacement backstop.

## Phases (atomic)

- **Guard `--staged` mode** — `scanStaged(regex, {files, readBlob})` reuses the existing `buildTokenRegex` / baseline / `diff`; reads staged blobs via `git show :<file>`; applies the same SCAN_EXT / SCAN_DIRS / SELF_EXCLUDE inclusion rules; `--staged` branch in `main` blocks with file + token named. Verify: unit tests (synthetic token, injected reader) for counting, inclusion filters, new-file block, baselined-allow, grown-count block.
- **Hook wiring** — Guard 3b in `.githooks/pre-commit` runs `--staged` on staged files, with `DPF_SKIP_PRIVATE_IDENTITY_SCAN=1` escape hatch. Verify: committing a clean change passes the hook (this PR's own commit is the functional proof).
- **Docs** — placeholder convention + pre-commit tripwire section in the hygiene doc; enforcement table updated to "pre-commit (staged) + CI".

## Acceptance criteria

- [ ] A NEW private-identity token in a staged file is caught locally before push, naming file + token.
- [ ] Staged-only scan (no full-repo walk on every commit; sub-second).
- [ ] Placeholder convention documented in `oss-repo-identity-hygiene.md`.
- [ ] Legitimate baseline occurrences do NOT block commits (respects the ratchet).
- [ ] The required merge-gate guard is unchanged — earlier tripwire, not a replacement.

## Backlog coverage

- **Decision:** `atomic` — the `--staged` guard mode, the hook wiring, and the placeholder doc are one small tripwire; no phase is independently useful (the mode without the hook never runs; the hook without the mode has nothing to call; the doc without the mechanism is aspiration).
- **Receipt:** `cmstsh4wc05by01qx1xh6xnd7` (atomic; recorded 2026-08-15).

## Risks & rollback

- **False block** at commit time on a legitimate baselined name → mitigated: staged diff respects the baseline, and `DPF_SKIP_PRIVATE_IDENTITY_SCAN=1` is the escape hatch; CI remains authoritative.
- **Rollback:** remove the Guard 3b block from `.githooks/pre-commit` (the `--staged` mode is inert unless invoked). No baseline or CI change.
