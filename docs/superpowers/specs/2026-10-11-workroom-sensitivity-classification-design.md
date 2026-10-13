---
status: active
---

# Workroom sensitivity classification correction

Backlog: BI-CAP-1774FB7A. Workroom: WC-EEF1CFD8.

## Problem and evidence

At source 693c942504577ae97e7462473c6cf8db274bc12a the boundary form and writer accept arbitrary sensitivity text. Executing the actual writer with `engineering-only` persists that value; room admission then denies even restricted-cleared agents. The live WC-9CECAF46 read returns workroom_data_access_required. Its stored value and actual information classification have NOT been read or inferred.

## Design grounding

Extend the July 26 Work Rooms collaboration design, sections 7.1 and 7.2. Reuse PRINCIPAL_SENSITIVITIES/isPrincipalSensitivity, WorkroomBoundaryClaim, the themed SelectField, existing governed MCP dispatch, and WorkroomActivity audit records. The free-text boundary intent fields remain prose; sensitivity is an existing closed classification axis. Room admission, case-policy intersection and coworker clearance are unchanged. No role, grant, table, global clearance or automatic historical backfill is introduced.

## Ordered implementation

1. Separate typed new input from tolerant historical reads. Validate new sensitivity values against the canonical four levels; reject unknown values. Preserve an unchanged unknown historical declaration during ordinary intent edits; refuse silent clearing or replacement of it.
2. Replace the sensitivity text input with the shared SelectField. Existing unknown values are visibly unresolved and retained, rather than defaulted to public/internal. Ordinary saving cannot classify historical prose.
3. Add a narrowly scoped administrator classification-review/correction operation to the existing Workroom tool pack. Read only a classification status and exact current revision/digest, never room title, content, evidence or unknown prose. Correction requires exact prior revision/digest, one canonical classification, explicit reviewed-classification confirmation and a substantive rationale. The action declares authority consequence, so the normal exact employee approval mechanism applies. An agent cannot self-attest review of contents it is not permitted to read.
4. In one transaction, refuse stale changes, change only the invalid boundary sensitivity, and append an audit record retaining the original declaration, new classification, actor and rationale. Original room, activities, acceptance results, memberships and policies remain; valid existing classifications cannot be lowered through this recovery operation. Unknown classification continues to fail closed until an approved correction commits.
5. Exercise writer, action and component tests; verify authorization, stale revision, invalid classification and rollback cases. Run typecheck, applicable UI/style/prose gates, canonical local-CI, independent review, DCO PR and governed deployment. Target-room acceptance is separate: an authorized administrator must verify actual information classification before applying its correction, and the original reliability owner then reruns its acceptance scenarios.

## Acceptance

- AC-1: New inputs are canonical classification values or explicitly unset; unknown writes fail.
- AC-2: Existing unknown declarations survive ordinary edits and keep denying content access.
- AC-3: Administrator recovery is exact-room, governed and audited, with original declaration retained and concurrent changes refused.
- AC-4: UI uses the shared accessible themed selector and does not convert an unknown value into a permissive default.
- AC-5: No broad clearance or denied-room data-reading workaround occurs; target-room correction needs actual authorized classification review.

## Risk and rollback

Classification correction can widen room access, so it remains an authority-consequential operation requiring exact approval. Server validation is mandatory independently of the UI. Rollback reverts the code; audited correction history remains and may support a separate authorized reversal. Never erase history, fabricate target classification, or claim target acceptance from source-local tests.

## Administrator dispatch recovery

Follow-up for the same BI: native OAuth `review_workroom_sensitivity` succeeds on the admitted implementation room but returns `workroom_data_access_required` for WC-9CECAF46 before its masked handler runs. The target's actual classification remains unknown. At source 8156f50dc5b1670f2e5405aeee6a5eb309ac25fa, `workroomTargetAccessRefusal` applies content admission to the two administrative recovery tools. An invalid historical label cannot satisfy that admission, so the repair can be unreachable.

WWMD DI-0CED98BA4777 selected the narrow administrative control-plane route. Its feature scores are comparative design judgments, not measured risk probabilities. The earlier DI-F7A41D44EF89 lacked scoreable features and supplied no decision.

Ordered follow-up plan (one atomic correction of AC-3):

1. Reuse the existing Workroom and normal exclusive claims for the OAuth room-access module, its tests and the governed dispatch integration tests. Preserve the current tool registry, grants, roles, data clearance and approval policy.
2. Add failing regressions showing that a current platform administrator can reach only `review_workroom_sensitivity` and `correct_workroom_sensitivity` without content admission. Prove that nonadministrators, revoked administrators, forged parameter tool names and ordinary reads/evidence writes remain denied.
3. Authorize those two exact tool names through the current human's `manage_platform` check. The masked reader's transaction repeats that check; the correction retains trusted exact approval, verified classification, invalid-only input, revision/JSON compare-and-swap and audit. Never return room contents or confer room admission.
4. Verify governed execution still requires approval for correction and allows only the read-shaped metadata call without another approval. Run the existing correction permission, forged approval, stale revision and rollback tests alongside the access regressions and both TypeScript programs.
5. Freeze the assembled change, run the canonical shared gate, obtain independent review, and publish through DCO and the protected merge queue. Coordinate the canonical release with its existing owner. After deployment, exercise the masked review through the same OAuth assistant, confirm ordinary room content remains denied where appropriate, then determine the supported remedy from the actual classification state. Do not infer or mutate WC-9CECAF46's classification from its title, DEV posture or this source diagnosis.

Coverage: BI-CAP-1774FB7A AC-3, quoted from the live item: "A supported exact-room administrator review/correction path records the original declaration, reviewed classification, actor and rationale with concurrency protection, without global clearance changes." AC-4 remains the regression contract; AC-5 still requires actual authorized classification review before any historical correction. Dispatch and its negative controls cannot ship independently; they form one revertible fix. No new UI control, schema, tool or automatic backfill is introduced.
