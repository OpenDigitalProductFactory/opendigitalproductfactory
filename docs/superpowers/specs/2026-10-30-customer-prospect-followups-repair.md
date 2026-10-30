# Customer follow-up: show recorded sales next steps

Backlog and implementation parent: **BI-3C34D453**. Workroom: **WC-7DCAB9F6**.
Delivery: existing Small bug repair, not a new CRM or outreach workflow.

## Existing design and defect

Reuse the [CRM pipeline design](2026-03-20-crm-sales-pipeline-design.md),
Opportunity.nextActivityAt, open-stage registry, PipelineStageInspector,
NextStepControl and OwnerFirstSummaryBand. The canonical pipeline inspector
already provides Set next step and Customer Advisor draft-for-review work.

At commit 641248e9e8e4999c369c1c85792918f9d521f91b,
apps/web/app/(shell)/customer/(crm)/page.tsx passes no opportunity next-step
records into buildCustomerOwnerSummary. The builder in
apps/web/lib/owner-first/domain-summary.ts receives only storefront, engagement,
invoice and renewal counts. CRM detail containing the revenue cockpit is behind
OwnerFirstDisclosure. The primary reply-only empty state therefore omits
recorded sales work; it does not prove conversations have stopped.

## Ordered repair and verification

All steps belong to this implementation parent; none is independently shippable.

1. **REPRODUCE:** run owner-summary regressions with no inbound work, one missing
   next step and one overdue next step. On the named base the builder produces
   zero actions rather than two; its clear message mentions only replies.
2. **PROJECT:** extend the existing summary input with a bounded list of existing
   open opportunities having a missing or overdue nextActivityAt. Use the same
   closed-stage exclusion as the pipeline; exclude tombstoned customer accounts.
   Query at most three, overdue first, then oldest missing steps. Do not call
   inbound replies stalled or create new work records.
3. **LINK:** render those records through the existing summary band before CRM
   disclosure in Simple and Full modes. Each action names the opportunity and
   links directly to its existing pipeline inspector and Set next step control.
   That inspector retains Customer Advisor draft review and existing send gates.
   Reuse archetype surface policy so rescue relationship views do not gain
   commercial pipeline actions. No new controls or new styling primitives.
4. **VERIFY:** run pure summary regressions and page rendering tests with seeded
   fixtures, including inbox-empty/sales-busy, future-only, closed-only and truly
   clear cases, exact deep links and archetype suppression. Run related summary,
   pipeline, inspector and archetype tests, both web typechecks, affected guards,
   required measured UX review, exact merged-code gate and protected PR health.
5. **ACCEPT:** after canonical deployment, exercise the served Customer route in
   both navigation modes with authorized data and verify the destination and
   existing next-step save/readback. Rendered fixtures and a merged PR alone do
   not establish this acceptance.

## Acceptance and boundaries

- **AC1:** No inbound replies is distinguished from no recorded sales work.
- **AC2:** Missing and overdue open opportunity next steps appear in primary
  Customer follow-up, ordered and bounded to three; pipeline contains the rest.
- **AC3:** Each affected deal links to its existing Set next step and draft review
  workflow. No mail is sent and no draft is presented as delivered outreach.
- **AC4:** Truly clear state describes both reply work and recorded sales steps;
  closed and future-scheduled opportunities are not labelled overdue or missing.
- **AC5:** Existing archetype disclosure, tombstone policy and owner-first shell
  remain intact. No schema, credential, provider access or permission change.

The current BI supplies the recorded served symptom. Pure regression fixtures
are source evidence, not a claim to have read live private CRM data. Any live
verification still requires its existing authorized DPF surface.
