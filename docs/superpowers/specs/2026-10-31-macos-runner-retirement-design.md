# Preserve Apple Silicon installer verification after runner retirement

Backlog: BI-83786CD7. Workroom: WC-E697132E.
Status: design preparation; implementation and hosted execution not yet admitted.

## Problem and existing contract

The `apple-silicon-dry-run` job in `.github/workflows/release-gates.yml`
uses `macos-14`. GitHub's scheduled retirement brownout canceled PR6788's
job 124681651204 before logs were available. This is infrastructure
unavailability, not an installer test failure or pass.

The existing job exercises both development and release installer dry-runs
on real Apple Silicon with BSD userland and stock Bash 3.2. The existing
Ubuntu Compose-render matrix remains responsible for YAML rendering.
BI-58C58CB6 already delivered installer test-suite inclusion; this change
addresses the distinct hosted image retirement and does not reopen it.

## Research

- [GitHub retirement notice](https://github.com/actions/runner-images/issues/13518):
  macOS 14 brownout October 31 14:00 UTC through November 1 00:00 UTC;
  retirement November 2, 2026. Supported recommended successors include macOS 15.
- [Official macOS 15 arm64 image inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md):
  observed October 31, image 20261028.0489.1 lists Bash 3.2.57 and BSD tar.
  Inventory is evidence of available software, not proof that this repository's
  job selected that architecture or executed successfully.

## Proposed change and boundary

Use `macos-15`, the standard Apple Silicon runner. The official
[runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
lists both macos-14 and macos-15 in the same standard arm64 M1 class.
This is not a larger-runner selection or a new runner tier. Keep a single ten-minute Mac job, path filters, concurrency,
permissions, checkout/setup actions and existing installer assertions.
Invoke `/bin/bash` explicitly for stock-shell compatibility rather than
depending on a PATH-resolved Homebrew shell. Log and assert Darwin/arm64
and Bash 3.2 before the two dry-runs.

The October 31 GitHub branch protection read lists DCO, Merge Readiness and
UX Route Budget Sweep; no direct Apple Silicon display-name binding was returned.
Repository aggregate checks still apply. Inspect their source before changing
the job's display name.
Preserve the existing required-check identity if it is bound; explain its
legacy label in a comment while the actual `runs-on` value carries runtime
truth. Do not edit branch protection or fabricate a passing result.

This is source-only CI maintenance. It changes no production runtime,
credentials, grants, schema, inference provider, endpoint repair or review
policy. No new runner tier, extra matrix, purchase or provider-review budget
is authorized by this design. The current workroom funding allocation remains
unresolved and must not be inferred from administrator or coordinator status.

## Objectives and acceptance

**OBJ-MACCI1:** Retain meaningful real-Mac installer coverage on supported infrastructure.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-MACCI1 | OBJ-MACCI1 | The selected standard runner is supported and demonstrably Darwin arm64 with stock Bash 3.2. |
| AC-MACCI2 | OBJ-MACCI1 | Both existing development and release dry-runs pass on the actual hosted target; unavailable execution remains unrun. |
| AC-MACCI3 | OBJ-MACCI1 | Existing path filters, concurrency, ten-minute timeout, permissions and required-check protection remain effective. |
| AC-MACCI4 | OBJ-MACCI1 | Source checks and ordinary independent review/protected publication qualify the exact change; no CI or review bypass is used. |

## Verification and rollback

Before implementation, bind the immutable design/plan, record research and
obtain the actual effective-shape admission. Validate workflow structure and
affected source guards. Hosted execution is the acceptance evidence for the
Mac environment; Linux or local compilation cannot substitute for it.
Retain exact head, job identity, selected image and complete dry-run logs.

Reverting restores source configuration only and does not restore a retired
runner. A failed successor requires another qualified supported standard
image through the same process, not suppressing the Mac check. No live
installation rollback or host operation is part of this change.

## Ordered implementation plan

1. Record immutable research and exact item-body acceptance through the existing
   proportional readiness route; obtain implementation admission for the effective
   Medium shape before changing the workflow.
2. Inspect aggregate check matching, then migrate only the runner, accurate
   descriptions and explicit stock-shell/host assertions. Keep limits and filters.
3. Run affected workflow/source guards and documentation checks. Use ordinary
   exact-source review and protected publication; report unavailable checks honestly.
4. Verify actual hosted Mac identity and both dry-run outcomes, then record delivery.

The four acceptance rows AC-MACCI1 through AC-MACCI4 form one atomic deliverable:
label migration without preserved real-host verification is not independently useful.

## Item-body acceptance contract

- AC-MACCI1: The selected standard runner is supported and demonstrably Darwin arm64 with stock Bash 3.2.
- AC-MACCI2: Both existing development and release dry-runs pass on the actual hosted target; unavailable execution remains unrun.
- AC-MACCI3: Existing path filters, concurrency, ten-minute timeout, permissions and required-check protection remain effective.
- AC-MACCI4: Source checks and ordinary independent review/protected publication qualify the exact change; no CI or review bypass is used.
