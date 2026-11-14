---
status: active
---

# Saved Build Studio proof without an execution provider

BI-9F057CA8 · WC-9E4DD327 · Small, one atomic revert.

This extends the existing native verification-truth design and preparation
DOC-C9353C77. Saved evidence is information; reading it must not depend on
having an AI runner available. Execution capability, access and readiness still
govern every action that starts or changes work.

## Reproduction and existing substrate

On f56fcf7541479a7706d2d551986543fbc8775ddb, `/build` returns from the
capability check before loading saved builds. The page regression executes all
three unavailable capability reasons: the saved reader is never called despite
an authenticated owner and a retained record. The unauthenticated control passes.
This is a reproduced failure, not a passing implementation or live fixture test.

Reuse `/build`, BuildStudio's saved selection, ReviewPanel's
existing verification projection and raw output, and native saved-data readers.
Keep organization-scoped reads and existing mutation-specific authority.
The missing PlatformDevConfig setup case remains unchanged.

## Ordered atomic repair

1. Keep authentication first. Load saved data even when execution capability is
   unavailable; distinguish capability observation failure from empty history.
   Retain the existing provider setup guidance alongside saved records.
2. Carry explicit execution availability through the existing UI. In unavailable
   mode retain saved selection, recorded documents, proof/raw output and reload.
   Do not mount intake, promote, workflow, resume/repair, release, deletion,
   brief-edit, decomposition or formatting actions and effects. Gate nested
   ReviewPanel formatting/decomposition too. UI state never grants server access.
3. Test page loading and real component interactions, including existing server
   authorization and dispatch boundaries. Preserve draft creation versus
   execution approval distinctions; do not claim all server writes share a
   provider check. Keep qualified counts, unknown and conflicting proof truthful.
4. Verify normally admitted disposable saved fixtures with no configured runner,
   exact source and lease. Exercise saved selection/proof/raw output, reload,
   replacement and empty/error states without inference or production fixtures.
5. Run affected tests/typechecks and applicable UX review, independent source
   review and governed delivery through `pnpm land`. Canonical deployment remains
   with its existing owner; served acceptance requires CAN-TEST.

These steps are not independently shippable: exposing history without preserving
its execution boundary is incomplete. No new route, provider, credential,
capability floor, budget, table or role is introduced.

## Acceptance and recovery

Existing authorized saved results remain readable with zero providers,
insufficient local capability or temporary capability unavailability. Empty
history, failed reads and unavailable capability have distinct truthful states.
An inaccessible explicit buildId cannot be presented as another build's result.
Unauthorized visitors receive no saved data. Existing organization-scoped read
and creator-specific mutation rules are retained.

Unavailable mode must not invoke inference, dispatch or mutations, including
hidden child controls. Raw retained reports remain available; missing execution
and conflicting evidence never become success. A2A attribution, standing-history
fixtures and the separately tracked reload cause are outside this repair.

No migration or data rewrite is required. Revert this atomic presentation change
through protected delivery if acceptance fails; preserve existing saved records.

## Design choice

DI-A96411492A3F compared propagating an unavailable-execution flag through the
full studio with an isolated reader composed from native reporting and proof
components. The latter was autonomy-eligible with high confidence; the agent
recorded that choice. This decision is not a rendered UX measurement or critique.
The reader shares the existing proof module; no existing copy ceilings or
route budget limits are increased.

## Rendered composition correction

The admitted ee2a3a02 contributor preview rendered retained proof without a
runner, including raw output and unresolved earlier failures. At a visible
390×844 viewport, the canvas drawer measured 156 pixels wide, making the
saved evidence difficult to read. This is a measured failure of that composition,
not a release acceptance pass. The nine-row cloned fleet did not establish the
separately reported 76-row case.

Keep the isolated reader choice, but compose ReviewPanel directly in the page
through an accessible disclosure. Put the selected result before the fleet so
its proof control does not depend on history length. Reuse Button, ReviewPanel
and DataTable; leave shared canvas geometry and every numeric UX limit alone.
The 76-row disclosure-order regression first failed against ee2a3a02; after the
repair all 28 affected tests passed. Final rendered measurement remains required.

The b203de74 preview then measured 229 arrival words at 1728×962 with nine
fleet rows, exceeding the existing 152-word ceiling. Keep the selected proof
control first and disclose fleet history through native `details`/`summary`.
The visibility regression failed with the original visible table and passed
after the disclosure change; no copy or route threshold is raised.

That preview admitted a full tracked-file source proof for 19,775 files before
creating six labelled abandoned display fixtures, then verified a fresh proof
before removing all six. These are fixture setup and cleanup observations,
not six successful UI cases or real test/repair executions. Browser proof
activation did not persist during repeated navigation/refresh activity; its
cause remains unqualified. Final proof interaction, mobile width, arrival
measurement, replacement and critique still require served verification.

## Surface convergence

The host preflight found that a standalone reader would exceed Build Studio's
frozen component and aggregate line budgets. Export the isolated reader from
the existing ReviewPanel module instead, and remove its redundant five-dot
summary band. Detailed design, plan, task, verification and acceptance sections
retain the actual evidence in both normal and saved-reader views. This is an
explicit presentation change to normal proof too; its execution controls still
use the existing default availability setting.

Share repeated UX section titles and keep equivalent empty/error wording concise.
Delete the unused new-module copy-baseline entry without increasing any existing
ceiling. The result is 70 components and 16,286 non-test lines, eight fewer than
the previous frozen ceiling; retighten that ceiling rather than raise it.

The saved-reader copy uses the existing `workrooms` message catalog. The page
provides that namespace for both successful reads and read failures. Proof, fleet
and setup disclosures use native HTML; no extra execution shell mounts. A real
catalog/pseudo-locale regression fails with hardcoded heading copy and passes
with the viewer catalog. ReviewPanel copy tightens from 71 to 52 words and its
unlocalized fragments tighten from 16 to 12; neither allowance grows.

## Served acceptance at 3f1d3beba29f

The admitted contributor preview NPEL-FB1FB82DD9 served this exact source after
all 85 host checks, 30 affected tests and both web typechecks passed. Arrival
showed 22 main-content words at 1728x962, with fleet and setup closed. At
390x844, expanded proof used 358 pixels and document scrollWidth was 390.

Independent E9 browser observations covered six synthetic saved records:
missing proof, observed counts, unknown execution, an applicability exemption,
conflicting retained QA, and interrupted results. The owner then replaced only
the interrupted saved record under a fresh full-tree proof. Reloading that same
record showed its replacement counts and explicit synthetic replacement marker.
No test command or actual repair ran. Conflict raw output retained the earlier
QA sentinel and unresolved-failure warning. Some immediate post-reload clicks
stayed collapsed; fresh observation and reopening worked. No cause or universal
persistence verdict is inferred.

Fresh 19,810-file source proofs guarded fixture creation, replacement and removal.
All six records were removed before the owner stopped the preview. Four actual
captures are retained in DOC-5AADC6C4, version cmwfab2db0taq0eohk3cx6167.
The original advisory engagement CE-8C8F5950 refused its first artifact/capture
binding with `engagement_room_access_refused:not-admitted`. That operation
stopped without retry or grant workaround; native UX critique remains unrun.
The separately attributed source assessment was CLEAR at this source. Full
integration verification, protected publication and canonical live acceptance
remain separate delivery obligations.
