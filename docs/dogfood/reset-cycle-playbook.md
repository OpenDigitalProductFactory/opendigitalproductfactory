# Reset-cycle playbook

Take a machine to zero DPF footprint, install from scratch, and drive the result
as a real business until something breaks. Repeat until it stops breaking.

This is the **full-cycle** protocol. For a single install attempt on macOS or
Linux, the [Install verification report](../../.github/ISSUE_TEMPLATE/install_verification.md)
template is lighter and is the right thing to use. Come here when you are testing
the whole lifecycle: teardown, install, onboarding, archetype fit, and estate.

## Who this is for

Anyone testing the platform end to end, including people who were not present for
earlier cycles. Every trap below cost somebody real time; none of them are
hypothetical.

## Before you start

You will need, and should gather up front rather than discover mid-run:

- An operator account for the machine (installs touch Docker, PATH, scheduled tasks).
- **A network gateway credential**, if you intend to run Phase 5. An agent cannot
  and should not invent this — ask the operator at that step.
- Somewhere outside the wipe zone to write findings. Not the install directory.

## The phases

| # | Phase | Destroys anything? |
|---|---|---|
| 0.1 | Salvage sweep — find work that exists on no remote | no |
| 0.15 | Back up backlog + work capsules, and **verify the dump restores** | no |
| 0.2 | Drain backlog to version-controlled recovery bundles | no |
| 1 | Teardown to zero footprint | **yes** |
| 2 | Install from the documented path, as a non-technical operator would | no |
| 3 | Onboarding, end to end | no |
| 4 | Archetype operating-model audit | no |
| 5 | Estate discovery | no |

Phases 0.1 through 0.2 are not optional. They are the only thing standing between
a cycle and lost work, and every one of them has caught something real.

## What to look for

This is the part that matters. The defects that survive testing are **not** the
ones that look broken — those get found immediately. They are the ones where
every human-visible signal reads correct.

Learn these shapes:

**Silent skips.** A step that does nothing and says nothing. An installer skipped
two agent-wiring scripts for months; the skips became visible only when warnings
were added. If a step can be skipped, check that it *announces* the skip.

**Green that means nothing ran.** A passing check and an unexecuted check look
identical from outside. When something passes, ask what would have had to happen
for it to fail, and whether that thing actually ran.

**Seeded data indistinguishable from real data.** A fresh install showed a
completed discovery run with 23 items and **zero connections**. Nothing had been
discovered. Ask of any populated surface: could this have been produced by the
work it claims to represent?

**"Ready" is not "enabled".** An installer reported `[OK] AI Coworker is ready`
for a provider it had shipped switched off. Two different claims, one word.

**Merged is not published is not deployed is not working.** Four distinct states.
A fix on `main` may not be in the published image; a published image may not be
pulled; a pulled image may still not work. Check the one you actually mean.

**Stale artifacts look like coverage.** A recovery bundle that captured 8 of 13
items is more dangerous than no bundle, because it reads as protected. Anything
that is a snapshot goes stale — re-verify it against live state, do not trust its
existence.

**A rehearsal that skips the expensive step is not a rehearsal.** An uninstaller's
`-DryRun` printed a clean plan; the real run aborted immediately, every time, on
the default configuration. The dry run printed intentions without invoking the
thing that failed, so it never exercised the failing path. When a dry run passes,
ask which parts it did not execute.

**Your tooling can hold a resource the thing under test needs.** A monitor
tailing an installer's log held the file open; the installer then died with
*"cannot access the file ... used by another process"* — an error that names the
installer and blames the wrong component. Before filing a defect against
something you are watching, check whether watching it is the cause.

**Your own verification is a prime suspect.** In one cycle the checking code was
wrong four separate times: a regex that threw on every path, a column-offset read
that misparsed a filename with a space, a three-dot git diff that reported every
branch unmerged, and an identifier that Postgres silently lower-cased. Each
produced a confident, wrong statement. **When a measurement is surprising,
re-measure a different way before believing it.**

**A passing UX pass is not a working product.** An archetype completed onboarding
11/11, published a correct public site, and had no operating model at all behind
it. See the
[Archetype Operating-Model Audit](../architecture/archetype-operating-model-audit.md).

### Budget for the model download

A zero-footprint teardown clears the Docker Model Runner store, so the next
install re-downloads the whole local model — roughly 20 GB, and the longest
single step in the cycle. Plan for it, or decide deliberately to retain the model
between cycles and say so in your report.

Check `docker model ls` afterwards for stub entries: a partial pull can leave a
row that looks like an installed model but has no size, no parameters, and a
1970-epoch creation date rendered as "56 years ago". `docker model inspect` shows
`"created": 0` and an empty config.

## What to record

Findings are only useful if they are comparable across testers. Use this shape —
one per finding, in a file outside the wipe zone:

```markdown
### <short imperative title: what is wrong, not what you were doing>
*Severity: P1|P2|P3 · Phase: <n> · <date>*

**What I did.**        The action, precisely enough to repeat.
**What I expected.**   Say this even when it feels obvious.
**What happened.**     Verbatim output. Not a paraphrase.
**Evidence.**          Command + result, or the exact UI text.
**Baseline check.**    Did this also happen on a clean/unmodified state?
                       If you did not check, say so.
**Why it survived.**   Which checks passed while this was broken?
```

Two rules that make the difference between a report and an anecdote:

1. **Quote, do not summarise.** `no eligible endpoints task=reasoning
   minDims={"reasoning":85} excluded=3` is actionable. "Routing seemed broken" is
   not.
2. **Say what you did not verify.** An unverified claim labelled as such is
   useful. An unverified claim presented as fact costs the next person hours.

Record **positives** too, in the same file. Knowing that donation semantics render
correctly for a nonprofit archetype is what stops someone "fixing" it later.

### Where findings go

- **During a cycle**, while backlog sync may be down: a local log file.
- **Once the platform is reachable**: file each as a backlog item. Group related
  findings under an epic.
- **Before the next teardown**: make sure they are in a recovery bundle under
  `packages/db/recovery/backlog/`, or they die with the database.

Do not put backlog ids in PR *prose* — each install mints its own, so they are
unresolvable to anyone else. See
[Keep internal identifiers out of the PR body](../testing/pre-pr-gate.md).

## Augmenting this playbook

This document is meant to grow. If you find something the protocol missed:

**Add a trap** to *What to look for* only if it is a *shape* — a class of failure
that will recur — not a single defect. Single defects are backlog items. The test:
could this catch something in a part of the product you have never opened?

**Add or amend a phase** when a whole area is untested. Phase 5 exists because
three cycles ran without anyone touching estate discovery. State plainly what the
phase is for and what a clean result looks like.

**Cite evidence, not memory.** Every trap above names the concrete thing that
happened. A trap without an incident behind it is a guess, and guesses accumulate
until nobody reads the list.

**Keep it honest about cost.** If a step takes an hour, say so. A playbook that
underestimates effort gets abandoned mid-cycle, which is worse than one nobody
starts.

Open a PR against this file. Cycle write-ups belong beside it in `docs/dogfood/`
as dated documents.

## Automation

Scripted so far:

- **Salvage sweep** — enumerates trees from the filesystem, not the worktree
  registry, and classifies by whether commits exist on any remote.
- **Backlog backup / restore** — dumps `Epic`, `BacklogItem`, `WorkCapsule`,
  `WorkCapsuleActivity`; verifies counts against live; refuses to report success
  on a mismatch. Restore defaults to dry run.

Deliberately not automated: the teardown confirmation, provider credentials, the
gateway key. Those are operator decisions, and a script that performs them
removes the judgement the gate exists to apply.

## Known-manual steps

Ask for these at the phase that needs them, not at the start, and not by
improvising around them:

| Step | Phase | Why manual |
|---|---|---|
| Teardown confirmation | 1 | Destructive; deliberately not automatable |
| Build Studio coding provider | 3 | Operator OAuth against a third party |
| Provider trust attestation | 3 | A legal/contractual assertion by the operator |
| Network gateway credential | 5 | Operator secret; agents must not hold or invent it |
