# Handoff prompt — continue hardening DPF portal toward enterprise class

Context: this is the continuation of the 2026-05-20 session where Claude
landed PRs #847 #848 #849 #850 #851 #854 #855 #856 #857 #859. Portal is
currently running on commit `8d15dbed` (top of `origin/main` at handoff).
The Build Studio dispatch pipeline is now functional end-to-end at the
process level: it runs, doesn't crash on null briefs, doesn't get stuck
in contradictory checkpoint states, and produces real sandbox commits.

What Mark wants next is **enterprise-class IT**:
- Reliability: a pipeline that finishes the job (not just the steps)
- Observability: visible into the hive (GI) contribution flow
- Safety: production promotion with rollback + troubleshooting
- Meta-recovery: the portal can't troubleshoot itself when broken, so a
  host-level safe-restore-to-known-good path is needed

He has not yet seen these end to end:
- A successful GI / hive-mind contribution from this install
- A production promotion that he could confidently roll back

This prompt is the standing brief for the next session.

---

## 1. Plug the diff-extraction gap (highest leverage)

**Observed 2026-05-20 on FB-F0476EF3 (BI-COST-P1-01):** the build
pipeline completed cleanly (`step=complete`, `error=NULL`,
`failedAt=NULL`) and the sandbox has 5 commits ahead of its base. But
`FeatureBuild.diffPatch` is still `NULL` and `gitCommitHashes` is still
`[]`. That means the next gate — Run Verification Review (PR #850's
`listReleasableSandboxFiles` check) — still rejects the build, even
though the work is genuinely done.

There is a missing step (or a broken one) between "sandbox has commits"
and "FB row has diffPatch + gitCommitHashes." Find it. Likely
candidates:
- `apps/web/lib/build/build-pipeline.ts` step ordering
- `apps/web/lib/build/coding-agent.ts` finalization
- `apps/web/lib/build/sandbox/sandbox.ts` (the `listReleasableSandboxFiles`
  cousin)
- Maybe a step that exists only on the OLD `autoExecuteBuild` path and
  was lost in the checkpoint-pipeline refactor

When you find it, write the diff-extraction inline at the end of
`runBuildPipeline` and persist it to FB.diffPatch + FB.gitCommitHashes.
Add a vitest. Then RESUME FB-F0476EF3 once more and confirm the build
can go build→review→ship→complete with a real diff.

## 2. Exercise the hive contribution end to end

PR #856 fixed the 256-char title truncation that was blocking the
GitHub createPullRequest call. The next click of "Submit Upstream PR"
SHOULD succeed cleanly. But we have not actually watched this happen.

Pick **the cleanest build with a real diff** (probably FB-F0476EF3 once
§1 is done, or a synthetic test build you create just for this) and
walk through:

1. Build phase → review → ship
2. Click Submit Upstream PR
3. **A PR is created on `OpenDigitalProductFactory` upstream**
4. The hive sees it (whatever signal the platform uses for "hive saw
   a contribution")
5. The build's `contribution.*` evidence on FB is populated and matches
   the actual GitHub state

If any step in 1–5 fails silently, that's the next bug to file +
fix. The session's standing pattern: each layer's fix exposes the
next bug. Treat that as a feature.

## 3. Production promotion with rollback + troubleshooting

This is the enterprise piece. Today a build that ships goes through
the self-upgrade runtime (PR #830, FB-7A21E1F6) which is mostly
working but has gaps:

- **Apply step**: the "Platform update detected" banner says "Review
  in Admin → Platform Development" but during this session I observed
  the workspace getting auto-synced. Confirm: is auto-apply actually
  intended, and if so, document it; if not, gate it behind explicit
  operator approval (the banner already implies that).
- **Rollback path**: if a deployed update breaks the portal, the only
  way to roll back is host-level (rebuild a previous image, restart).
  There is no in-portal "roll back to vN-1" button. Either build that
  affordance OR document the host-level fallback as a runbook with
  the exact commands.
- **Pre-flight check**: before applying, run the same Tier 0 checks
  the build's release gate runs (typecheck, unit tests, production
  build) against the candidate. If they fail, refuse to apply.
- **Smoke check post-apply**: hit a known healthy endpoint (e.g. the
  /api/platform/image-version we used today) after restart. If it
  doesn't respond healthy within ~60s, automatically restore the
  previous image.

## 4. Meta-recovery: when the portal can't fix itself

Mark's exact framing: "The portal can't troubleshoot its own problems
if not functional, so worse case we would need to restore to get back
to a working state then troubleshoot after the fact."

This is the hard one. The portal is the troubleshooting surface, so
if it's down, there is no UX path.

Concrete asks:
- **Known-good image tag rotation**: every time the self-upgrade
  applies a new image and the post-apply smoke check passes, tag the
  previous image as `dpf-portal:last-known-good`. Then a host-level
  one-liner (or systemd target / docker compose alias) can restore
  it without git/repo access.
- **External health probe**: a tiny status endpoint that doesn't go
  through the Next.js app router (so it works even when the app router
  is broken). Could be a static HTML served by nginx in front of
  portal, or a separate sidecar service. The probe answers: "is the
  current image alive enough to log into the admin panel?"
- **Recovery runbook**: a markdown doc at `docs/runbooks/portal-down.md`
  with verbatim host-level commands for: tail the last 1k portal log
  lines, restore last-known-good image, dump postgres backup, etc.
  Tested commands, not generic guidance.
- **Backup snapshot before apply**: before the self-upgrade applies,
  trigger a postgres dump to a local volume. Document where it lands
  and how to restore. (The DB has the survival-critical state — code
  rolls back via image swap, but data is precious.)

Each of these is its own BI. File them through the Build Studio UX
("Describe a new feature → New") with acceptance criteria. Then drive
the most leveraged one (most likely #1 known-good rotation + the
runbook) end-to-end through the BS lifecycle. If the BS substrate
itself fails, that's tier-0 signal — file another BI for THAT and
keep going.

---

## Standing rules from earlier sessions (still in force)

- **UX-first.** Drive everything through the portal UX (Claude-in-Chrome
  → HTTP route → MCP tool → SQL, in that order of preference). The
  absence of a UX path is the dogfooding signal — don't bypass with
  SQL. See memory `feedback_dont_bypass_ux_with_sql`.
- **Build Studio for ALL features.** File BI → promote → approve
  Ideate → let BS run. Claude only opens maintenance PRs directly
  (deps, governance, urgent hotfixes, doc).
- **Sweep main before pushing.** Multiple sibling Claude sessions
  land PRs concurrently; rebase on origin/main before every push.
  See memory `feedback_continuous_overlap_check`.
- **DCO sign-off required** on every commit.
- **Drive 100% means don't ask** — autonomous directives are blanket
  approval. End every turn with one concrete proposed next step.
- **End with a next-step proposal**, not "what do you want to do."

## Open artifacts at handoff

- 10 PRs merged this session (see triage docs #848 #849, and the PR
  list in main since `068f1c68`)
- New BIs filed and sitting in ideate, waiting for the dispatch
  substrate to mature: FB-7F8C7368, FB-D3A746B3, FB-5D6F7000,
  FB-78E967D4
- FB-F0476EF3 is closest to "fully through BS" — 5 sandbox commits,
  clean buildExecState, blocked only on the diff-extraction gap from §1
- Portal version `8d15dbed`, image rebuilt 4× during the prior session

## How to start

Sweep `git log origin/main --oneline -20` first. Concurrent sessions
will have landed more PRs. Reconcile state with `docker ps` + `psql`
checks on FB-F0476EF3's buildExecState before assuming anything in
this brief is still current. Then pick §1 (diff extraction) and run
it through to PR like the prior session ran #859.
