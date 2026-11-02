---
status: draft
backlog: BI-7906C73E
---

# Bounded consent review recovery

Implement the consent-specific amendment in
[the existing recovery design](../specs/2026-10-16-original-initiative-review-settlement-design.md#consent-specific-amendment--november-2).
This draft grants no implementation admission or policy authority. Record the
genuine approved amendment baseline, immutable plan coverage and independent plan
review before executable changes.

The user expressly authorized a separate recovery branch while the consent
branch remains frozen. Use WC-EE03C388, `codex/consent-recovery-amendment`, base
`36b46866870694dab1763e691862da38dc577e76`. Do not edit the archived recovery
owner's tree or `/Users/markbodman/dpf-worktrees/oauth-single-account-confirmation`.

## Delivery boundaries

| Deliverable | Carrier | Boundary |
|---|---|---|
| Strict named-subject framework amendment and regression verification | BI-7906C73E | One protected source PR; atomic policy decoder/reader/admission compatibility. It may prepare an inactive policy candidate. |
| Independently approved retained consent policy | BI-9D3A6DB7 | Separate genuine policy approval/baseline. Source delivery or a parent baseline cannot activate it. |
| Genuine consent design/spec verdicts and original consent acceptance | BI-05E0EA33 | Existing frozen room/branch. Not completed by either preceding deliverable. |

Source framework changes are atomic internal steps. No independently shippable
new ledger, scheduler, grant or capture subsystem is proposed. Policy approval is
separately tracked because replacing BI-7906C73E's BI-285EF102 policy baseline
would revoke or alter that other subject's authority.

## 1. Approve the existing design amendment

- Preserve the exact consent task/digest/artifact bindings and operator evidence
  from the design. Obtain real design/spec and required architecture receipts for
  the recovery amendment; do not treat the author's advisory as independent.
- Bind the approved amendment baseline to this immutable plan, mapping all
  objective and acceptance references. Resolve the full start-of-work impact
  contract, including guard obligations and related tests before Red.
- Source bootstrap is compile-ready; normal permission bootstrap reported an
  unrelated malformed Grok configuration. Do not report that as a product test
  failure or bypass a managed refusal.

## 2. Implement only the named-subject extension

- `apps/web/lib/mcp-task-reassessment-policy.ts`: keep strict v1 bytes, shape,
  two/one limits and existing BI-285EF102 behavior. Add only BI-05E0EA33 and require
  the two exact consent original digests. No arbitrary subject allowlist input.
- `apps/web/lib/mcp-task-reassessment-policy.test.ts`: first prove consent is
  rejected before the extension. Then prove correct consent/old policy accepted,
  changed/swapped/duplicate consent digests, unknown subjects, multiple blocks,
  expanded limits and missing operator evidence rejected.
- Reuse the approved policy reader and existing lineage/admission machinery;
  change those only if tests demonstrate a subject-specific assumption. Preserve
  immutable baseline/pin/receipt/operator checks and all-family consumption.
- Add reader/admission regression cases proving consent uses its own authority
  carrier and cannot borrow BI-285EF102's policy. Current source limits and
  publication controls remain in effect. No live token/DB changes.

Traceability: OBJ-CONSENT, OBJ-HISTORY, OBJ-PRESENT, OBJ-CONTAIN, OBJ-FENCE;
AC-CR-1, AC-CR-2, AC-CR-3, AC-CR-4, AC-CR-6;
contract named-subject-policy; flow independent-policy-to-bound-assessment;
verification strict-policy-and-cross-subject-regressions.

## 3. Verify and publish the framework

- Run the affected policy, approved-reader, lineage, admission, qualification and
  native-composition tests; web production/test typechecks and required host
  guards. Run PostgreSQL/runtime-bound checks only under the shared governed CI
  lease. Reuse valid unchanged evidence; unrun infrastructure checks are unrun.
- Obtain genuine independent committed source review, exact merged-tree CI and
  normal DCO/protected PR checks. No local hand-built live image, draft PR, direct
  main push or bypass flag. Run `pnpm pr:health` before merge claims.
- Deploy through `request_self_upgrade`; reuse an existing scheduled request only
  if its immutable target includes the protected merge. Verify served bytes.

Traceability: OBJ-CONSENT, OBJ-PRESENT, OBJ-CONTAIN; AC-CR-5, AC-CR-6;
contract canonical-recovery-compatibility; flow protected-release-to-live-issuer;
verification canonical-policy-positive-and-refusal.

## 4. Approve the isolated policy and resume consent

- For BI-9D3A6DB7 obtain independent approval of
  `docs/superpowers/specs/2026-11-02-consent-review-reassessment-policy.md` and its
  own retained immutable baseline. Never substitute the parent baseline.
- Call the existing subject recovery issuer with that actual authorization item.
  Submit its complete exact packet unchanged once per named requirement; accepted
  uncertain/failed/pending allocation still spends the allowance. No original
  replay or new request key. A missing issuer/qualification/allowed-model proof
  is a concrete blocker, not permission to use another lane.
- Obtain genuine consent design/spec receipts, normal consent plan admission and
  served acceptance. Then ready PR, protected merge, canonical upgrade and actual
  personal first-connect/reconnect measurements remain in the consent workroom.

Traceability: BI-9D3A6DB7; OBJ-POLICY; AC-CP-1, AC-CP-2, AC-CP-3, AC-CP-4,
AC-CP-5, AC-CP-6; contract separate-retained-consent-authority;
flow approved-policy-to-genuine-consent-verdict;
verification canonical-issuer-and-consent-planning-admission.

## Risk and rollback

The change reaches policy decoding and its approved-policy consumers. A parser
acceptance is never authority. Regression proof must preserve old policy digests,
current writer/approval fences, subject isolation and all-family limits. Public
source access is distinct from private data; Workroom assignment and allowed LLM
constraints remain unchanged.

On refusal or failure, disable new admission through the existing supported
boundary, retaining spent allowances, original unknown effects and compatible
fences/readers. Do not erase histories, extend a deadline, replenish an allowance
or downgrade into a pre-fence owner. Source or policy rollback cannot create a
third assessment.
